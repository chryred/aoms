package store

import (
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

var testInst = registry.Instance{SystemID: 1, InstanceRole: "was1", Host: "h", RetentionDays: 7}

func txs(n int, detailNodes int) []protocol.Tx {
	out := make([]protocol.Tx, n)
	for i := range out {
		out[i] = protocol.Tx{TraceID: tid, SpanID: sid, StartTs: 1761800000000, URIID: "0000000000000001"}
		if detailNodes > 0 {
			nodes := make([]protocol.Node, detailNodes)
			for j := range nodes {
				nodes[j] = protocol.Node{I: j, P: j - 1, K: "sql", N: strings.Repeat("x", 100)}
			}
			out[i].Detail = &protocol.Detail{Nodes: nodes}
		}
	}
	return out
}

func TestDropOrderUnderPressure(t *testing.T) {
	// ClickHouse never answers; nothing is flushed (no Run), so everything stays queued.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", FlushInterval: time.Hour,
		FlushRows: 1 << 30, MaxQueueBytes: 1 << 20}, srv.Client())

	// ~20KB detail per tx, ~500B summary: 100 tx ≈ 2MB > 1MB limit.
	for i := 0; i < 5; i++ {
		w.Accept(testInst, &protocol.Batch{Tx: txs(20, 200)}, 0)
	}
	d := w.Dropped()
	if d.Detail == 0 {
		t.Fatalf("expected detail drops, got %+v", d)
	}
	if d.Summary != 0 || d.SQL != 0 {
		t.Fatalf("summary/sql must be dropped after detail: %+v", d)
	}
	if got := w.BackoffMs(); got != 2000 {
		t.Fatalf("BackoffMs=%d", got)
	}
}

func TestAcceptNeverBlocksOnUnresponsiveClickHouse(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer srv.Close()
	defer close(release)
	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", FlushInterval: 10 * time.Millisecond,
		FlushRows: 100, MaxQueueBytes: 1 << 20}, &http.Client{Timeout: 100 * time.Millisecond})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)
	done := make(chan struct{})
	go func() {
		for i := 0; i < 20; i++ {
			w.Accept(testInst, &protocol.Batch{Tx: txs(20, 200)}, 0)
			time.Sleep(5 * time.Millisecond)
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("Accept blocked while ClickHouse is unresponsive")
	}
	if w.Dropped().Detail == 0 {
		t.Fatal("expected shedding")
	}
}

func TestFlushByRows(t *testing.T) {
	var inserts int32
	var mu sync.Mutex
	var queries []string
	var lines int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		zr, err := gzip.NewReader(r.Body)
		if err != nil {
			t.Errorf("gzip: %v", err)
			return
		}
		b, _ := io.ReadAll(zr)
		mu.Lock()
		queries = append(queries, r.URL.Query().Get("query"))
		lines = strings.Count(string(b), "\n") + 1
		mu.Unlock()
		atomic.AddInt32(&inserts, 1)
	}))
	defer srv.Close()

	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", User: "u", FlushInterval: time.Hour,
		FlushRows: 10000, MaxQueueBytes: 1 << 30}, srv.Client())
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)

	w.Accept(testInst, &protocol.Batch{Tx: txs(9999, 0)}, 0)
	time.Sleep(100 * time.Millisecond)
	if n := atomic.LoadInt32(&inserts); n != 0 {
		t.Fatalf("flushed before reaching rows: %d", n)
	}
	w.Accept(testInst, &protocol.Batch{Tx: txs(1, 0)}, 0)
	deadline := time.Now().Add(3 * time.Second)
	for atomic.LoadInt32(&inserts) == 0 && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	time.Sleep(100 * time.Millisecond)
	if n := atomic.LoadInt32(&inserts); n != 1 {
		t.Fatalf("inserts=%d want 1", n)
	}
	mu.Lock()
	defer mu.Unlock()
	if queries[0] != "INSERT INTO agent_t.tx_summary FORMAT JSONEachRow" || lines != 10000 {
		t.Fatalf("query=%q lines=%d", queries[0], lines)
	}
}

func TestRetryableFailureKeepsRowsClientErrorDrops(t *testing.T) {
	var status int32 = 500
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(int(atomic.LoadInt32(&status)))
	}))
	defer srv.Close()
	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", FlushInterval: time.Hour, FlushRows: 1 << 30,
		MaxQueueBytes: 1 << 30}, srv.Client())
	w.Accept(testInst, &protocol.Batch{Tx: txs(3, 0)}, 0)
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("expected error on 500")
	}
	if w.queuedBytes() == 0 {
		t.Fatal("rows must be retained after 5xx")
	}
	atomic.StoreInt32(&status, 200)
	if err := w.Flush(context.Background()); err != nil || w.queuedBytes() != 0 {
		t.Fatalf("err=%v queued=%d", err, w.queuedBytes())
	}
	w.Accept(testInst, &protocol.Batch{Tx: txs(3, 0)}, 0)
	atomic.StoreInt32(&status, 400)
	_ = w.Flush(context.Background())
	if w.queuedBytes() != 0 {
		t.Fatal("4xx (poison) rows must be discarded")
	}
}

type fakeAcker struct {
	mu  sync.Mutex
	ids []int64
}

func (f *fakeAcker) Done(id int64, ok bool) { f.mu.Lock(); f.ids = append(f.ids, id); f.mu.Unlock() }

func TestDumpsInsertedAndAcked(t *testing.T) {
	var mu sync.Mutex
	var q []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		q = append(q, r.URL.Query().Get("query"))
		mu.Unlock()
	}))
	defer srv.Close()
	ack := &fakeAcker{}
	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", FlushInterval: time.Hour, FlushRows: 1 << 30,
		MaxQueueBytes: 1 << 30}, srv.Client())
	w.Dumps = ack
	w.Accept(testInst, &protocol.Batch{Dumps: []protocol.Dump{{CmdID: 7, Ts: 1761800000000, Text: "dump"}}}, 0)
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(ack.ids) != 1 || ack.ids[0] != 7 {
		t.Fatalf("acked=%v", ack.ids)
	}
	if len(q) != 1 || q[0] != "INSERT INTO agent_t.jvm_thread_dump FORMAT JSONEachRow" {
		t.Fatalf("q=%v", q)
	}
}

func TestBacklogDrainsInChunksAfterOutage(t *testing.T) {
	const flushRows = 1000
	var mu sync.Mutex
	var down int32 = 1
	var rows int
	maxChunk := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.LoadInt32(&down) == 1 {
			w.WriteHeader(500)
			return
		}
		zr, _ := gzip.NewReader(r.Body)
		b, _ := io.ReadAll(zr)
		n := strings.Count(string(b), "\n") + 1
		mu.Lock()
		rows += n
		if n > maxChunk {
			maxChunk = n
		}
		mu.Unlock()
	}))
	defer srv.Close()
	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", FlushInterval: time.Hour, FlushRows: flushRows,
		MaxQueueBytes: 1 << 30}, srv.Client())
	w.Accept(testInst, &protocol.Batch{Tx: txs(3500, 0)}, 0)
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("expected error during outage")
	}
	if w.queuedBytes() == 0 {
		t.Fatal("backlog must be retained")
	}
	atomic.StoreInt32(&down, 0)
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if rows != 3500 || maxChunk > flushRows || w.queuedBytes() != 0 {
		t.Fatalf("rows=%d maxChunk=%d queued=%d", rows, maxChunk, w.queuedBytes())
	}
}

func TestPartialFailureRequeuesOnlyRemainderInOrder(t *testing.T) {
	var calls int32
	var mu sync.Mutex
	var got []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		n := atomic.AddInt32(&calls, 1)
		if n == 2 {
			w.WriteHeader(503)
			return
		}
		zr, _ := gzip.NewReader(r.Body)
		b, _ := io.ReadAll(zr)
		mu.Lock()
		got = append(got, strings.Split(string(b), "\n")...)
		mu.Unlock()
	}))
	defer srv.Close()
	w := NewWriter(Config{URL: srv.URL, DB: "agent_t", FlushInterval: time.Hour, FlushRows: 2,
		MaxQueueBytes: 1 << 30}, srv.Client())
	for i := 0; i < 5; i++ {
		w.PutDict("sql", fmt.Sprintf("%016x", i), "t")
	}
	if err := w.Flush(context.Background()); err == nil {
		t.Fatal("expected failure on 2nd chunk")
	}
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(got) != 5 {
		t.Fatalf("got %d rows, want 5 (no dupes/loss)", len(got))
	}
	for i, l := range got {
		if !strings.Contains(l, fmt.Sprintf(`"id":%d,`, i)) {
			t.Fatalf("order broken at %d: %s", i, l)
		}
	}
}

func TestHardCeilingShedsDictButNeverDumps(t *testing.T) {
	w := NewWriter(Config{URL: "http://127.0.0.1:1", DB: "agent_t", FlushInterval: time.Hour,
		FlushRows: 1 << 30, MaxQueueBytes: 2000}, nil)
	w.Accept(testInst, &protocol.Batch{Dumps: []protocol.Dump{{CmdID: 1, Ts: 1761800000000, Text: "d"}}}, 0)
	for i := 0; i < 100; i++ {
		w.PutDict("sql", fmt.Sprintf("%016x", i), strings.Repeat("x", 100))
	}
	if q := w.queuedBytes(); q > 2000 {
		t.Fatalf("queued=%d exceeds hard ceiling", q)
	}
	if w.Dropped().Dict == 0 {
		t.Fatal("expected dict drops")
	}
	if n := len(w.bufs[tblDump].lines); n != 1 {
		t.Fatalf("dump rows must never be shed, have %d", n)
	}
}
