package ingest_test

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"sync"
	"testing"
	"time"

	"context"

	"synapse/agent-t-gateway/internal/ingest"
	"synapse/agent-t-gateway/internal/live"
	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
	"synapse/agent-t-gateway/internal/store"
)

type stallReg struct{ inst registry.Instance }

func (s stallReg) Lookup(string) (registry.Instance, bool) { return s.inst, true }

type stallCmds struct{}

func (stallCmds) Pending(int64) []protocol.Command { return nil }
func (stallCmds) Done(int64, bool)                 {}

func stallBody(i, seq, nTx int) []byte {
	tx := make([]protocol.Tx, nTx)
	for k := range tx {
		tx[k] = protocol.Tx{TraceID: fmt.Sprintf("%032x", i*1000000+seq*1000+k), SpanID: fmt.Sprintf("%016x", k),
			StartTs: time.Now().UnixMilli() - 100, ElapsedMs: 50, Method: "GET", URIID: "0000000000000001", Status: 200,
			SQL: []protocol.TxSQL{{SQLID: "0000000000000002", Cnt: 1, Ms: 5}}}
	}
	b := protocol.Batch{V: 1, Seq: int64(seq), Ts: time.Now().UnixMilli(), Tx: tx,
		Dict:  protocol.Dict{SQL: map[string]string{"0000000000000002": "select 1"}, URI: map[string]string{"0000000000000001": "/x"}},
		Dumps: []protocol.Dump{}}
	raw, _ := json.Marshal(b)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(raw)
	zw.Close()
	return buf.Bytes()
}

// ClickHouse accepts connections but never answers. Ingest latency must stay low and, once
// the queue passes 80% of its limit, responses must be 429.
func TestIngestUnaffectedByHangingClickHouse(t *testing.T) {
	release := make(chan struct{})
	ch := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer ch.Close()
	defer close(release)

	w := store.NewWriter(store.Config{URL: ch.URL, DB: "agent_t", FlushInterval: 200 * time.Millisecond,
		FlushRows: 10000, MaxQueueBytes: 8 << 20}, nil) // default 30s client timeout, like production
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)

	inst := registry.Instance{AgentID: 1, SystemID: 1, InstanceRole: "was1", Enabled: true, RetentionDays: 7}
	ls := live.NewState(live.NewHub())
	h := &ingest.Handler{Registry: stallReg{inst}, Sink: ingest.MultiSink{w, ls}, Commands: stallCmds{},
		Dict: store.NewDict(w, store.DefaultDictCapacity), Back: w, Skew: ingest.NewSkew(), Now: time.Now}
	gw := httptest.NewServer(h)
	defer gw.Close()

	var mu sync.Mutex
	var lat []time.Duration
	codes := map[int]int{}
	var wg sync.WaitGroup
	stop := time.Now().Add(6 * time.Second)
	for i := 0; i < 49; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := &http.Client{Timeout: 10 * time.Second}
			for seq := 0; time.Now().Before(stop); seq++ {
				body := stallBody(i, seq, 41)
				req, _ := http.NewRequest(http.MethodPost, gw.URL, bytes.NewReader(body))
				req.Header.Set("Authorization", "Bearer x")
				req.Header.Set("Content-Encoding", "gzip")
				t0 := time.Now()
				resp, err := c.Do(req)
				d := time.Since(t0)
				code := -1
				if err == nil {
					code = resp.StatusCode
					resp.Body.Close()
				}
				mu.Lock()
				lat = append(lat, d)
				codes[code]++
				mu.Unlock()
				time.Sleep(time.Second)
			}
		}(i)
	}
	wg.Wait()
	sort.Slice(lat, func(a, b int) bool { return lat[a] < lat[b] })
	p99 := lat[len(lat)*99/100]
	t.Logf("n=%d p99=%v max=%v codes=%v dropped=%+v backoff=%d", len(lat), p99, lat[len(lat)-1], codes, w.Dropped(), w.BackoffMs())
	if codes[-1] != 0 {
		t.Fatalf("client errors: %v", codes)
	}
	if p99 > 200*time.Millisecond {
		t.Fatalf("p99=%v", p99)
	}
	if codes[429] == 0 || w.BackoffMs() != 2000 {
		t.Fatalf("expected 429 once queue passed 80%%: codes=%v", codes)
	}
}
