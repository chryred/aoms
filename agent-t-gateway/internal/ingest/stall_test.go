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
	"sync/atomic"
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
	sqlID := fmt.Sprintf("%016x", 0x100+seq) // dictionary ids vary per batch
	for k := range tx {
		tx[k] = protocol.Tx{TraceID: fmt.Sprintf("%032x", i*1000000+seq*1000+k), SpanID: fmt.Sprintf("%016x", k),
			StartTs: time.Now().UnixMilli() - 100, ElapsedMs: 50, Method: "GET", URIID: "0000000000000001", Status: 200,
			SQL: []protocol.TxSQL{{SQLID: sqlID, Cnt: 1, Ms: 5}}}
	}
	dumps := []protocol.Dump{}
	if seq%5 == 0 { // exercise the dump insert/ack path in some batches
		dumps = append(dumps, protocol.Dump{CmdID: int64(i*1000 + seq), Ts: time.Now().UnixMilli(), Text: "dump"})
	}
	b := protocol.Batch{V: 1, Seq: int64(seq), Ts: time.Now().UnixMilli(), Tx: tx,
		Dict:  protocol.Dict{SQL: map[string]string{sqlID: "select " + sqlID}, URI: map[string]string{"0000000000000001": "/x"}},
		Dumps: dumps}
	raw, _ := json.Marshal(b)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(raw)
	zw.Close()
	return buf.Bytes()
}

func post(c *http.Client, url string, body []byte) (int, time.Duration) {
	req, _ := http.NewRequest(http.MethodPost, url, bytes.NewReader(body))
	req.Header.Set("Authorization", "Bearer x")
	req.Header.Set("Content-Encoding", "gzip")
	t0 := time.Now()
	resp, err := c.Do(req)
	d := time.Since(t0)
	if err != nil {
		return -1, d
	}
	resp.Body.Close()
	return resp.StatusCode, d
}

// ClickHouse accepts connections but never answers. Ingest must keep answering 200 quickly
// while the queue is under 80% of its limit, and answer 429 once it crosses.
func TestIngestUnaffectedByHangingClickHouse(t *testing.T) {
	if testing.Short() {
		t.Skip("stall test takes several seconds")
	}
	var hits atomic.Int64
	release := make(chan struct{})
	ch := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		<-release
	}))
	defer ch.Close()

	const limit = 64 << 20
	w := store.NewWriter(store.Config{URL: ch.URL, DB: "agent_t", FlushInterval: 200 * time.Millisecond,
		FlushRows: 10000, MaxQueueBytes: limit}, nil) // default 30s client timeout, like production
	ctx, cancel := context.WithCancel(context.Background())
	runDone := make(chan struct{})
	go func() { w.Run(ctx); close(runDone) }()
	defer func() { // free the hung handlers so the final flush succeeds, then join Run
		close(release)
		cancel()
		<-runDone
	}()

	inst := registry.Instance{AgentID: 1, SystemID: 1, InstanceRole: "was1", Enabled: true, RetentionDays: 7}
	ls := live.NewState(live.NewHub())
	h := &ingest.Handler{Registry: stallReg{inst}, Sink: ingest.MultiSink{w, ls}, Commands: stallCmds{},
		Dict: store.NewDict(w, store.DefaultDictCapacity), Back: w, Skew: ingest.NewSkew(), Now: time.Now}
	gw := httptest.NewServer(h)
	defer gw.Close()

	// Phase A: 49 JVMs x 41 tx/s (~2,000 TPS) while ClickHouse hangs; queue stays under 80%.
	var mu sync.Mutex
	var lat []time.Duration
	codes := map[int]int{}
	var wg sync.WaitGroup
	stop := time.Now().Add(4 * time.Second)
	for i := 0; i < 49; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			c := &http.Client{Timeout: 10 * time.Second}
			for seq := 0; time.Now().Before(stop); seq++ {
				code, d := post(c, gw.URL, stallBody(i, seq, 41))
				mu.Lock()
				lat = append(lat, d)
				codes[code]++
				mu.Unlock()
				time.Sleep(time.Second)
			}
		}(i)
	}
	wg.Wait()
	if hits.Load() == 0 {
		t.Fatal("stall never engaged: the fake ClickHouse received no insert")
	}
	sort.Slice(lat, func(a, b int) bool { return lat[a] < lat[b] })
	p99, max := lat[len(lat)*99/100], lat[len(lat)-1]
	t.Logf("phase A: n=%d p99=%v max=%v codes=%v hits=%d", len(lat), p99, max, codes, hits.Load())
	if len(codes) != 1 || codes[200] != len(lat) {
		t.Fatalf("only 200s expected below 80%% of the queue: %v", codes)
	}
	if !raceEnabled && !testing.Short() { // latency under -race/1 CPU is too noisy to assert tightly
		if max > 2*time.Second || p99 > 500*time.Millisecond {
			t.Fatalf("ingest latency p99=%v max=%v while ClickHouse hangs", p99, max)
		}
	}

	// Phase B: sequential, so the queue state before each request is known exactly.
	c := &http.Client{Timeout: 10 * time.Second}
	saw429 := false
	for seq := 1000; seq < 4000 && !saw429; seq++ {
		before := w.BackoffMs()
		code, _ := post(c, gw.URL, stallBody(0, seq, 400))
		switch {
		case before == 0 && code != 200:
			t.Fatalf("seq %d: BackoffMs()==0 but got %d", seq, code)
		case before == 2000 && code != 429:
			t.Fatalf("seq %d: BackoffMs()==2000 but got %d", seq, code)
		case code == 429:
			saw429 = true
		}
	}
	if !saw429 || w.BackoffMs() != 2000 {
		t.Fatalf("queue never crossed 80%%: saw429=%v backoff=%d", saw429, w.BackoffMs())
	}
}
