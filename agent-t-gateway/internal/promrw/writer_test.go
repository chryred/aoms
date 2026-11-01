package promrw

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang/snappy"
	"google.golang.org/protobuf/encoding/protowire"

	"synapse/agent-t-gateway/internal/live"
)

// countSeries decodes a WriteRequest and returns the number of TimeSeries, checking sample layout.
func countSeries(t *testing.T, b []byte) int {
	n := 0
	for len(b) > 0 {
		num, typ, l := protowire.ConsumeTag(b)
		if l < 0 || num != 1 || typ != protowire.BytesType {
			t.Fatalf("bad WriteRequest tag")
		}
		b = b[l:]
		ts, l := protowire.ConsumeBytes(b)
		if l < 0 {
			t.Fatalf("bad bytes")
		}
		b = b[l:]
		n++
		hasLabel, hasSample := false, false
		for len(ts) > 0 {
			f, ty, l := protowire.ConsumeTag(ts)
			ts = ts[l:]
			_, l = protowire.ConsumeBytes(ts)
			if l < 0 || ty != protowire.BytesType {
				t.Fatalf("bad TimeSeries field")
			}
			ts = ts[l:]
			hasLabel = hasLabel || f == 1
			hasSample = hasSample || f == 2
		}
		if !hasLabel || !hasSample {
			t.Fatalf("series without label/sample")
		}
	}
	return n
}

func TestWriterPostsSnappy(t *testing.T) {
	type got struct {
		hdr  http.Header
		body []byte
	}
	ch := make(chan got, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		ch <- got{r.Header.Clone(), b}
		w.WriteHeader(http.StatusNoContent)
	}))
	defer srv.Close()

	w := NewWriter(srv.URL)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go w.Run(ctx)
	w.Hook([]live.AggEvent{testEvent(2)})

	select {
	case g := <-ch:
		if g.hdr.Get("Content-Encoding") != "snappy" || g.hdr.Get("Content-Type") != "application/x-protobuf" ||
			g.hdr.Get("X-Prometheus-Remote-Write-Version") != "0.1.0" {
			t.Fatalf("headers %v", g.hdr)
		}
		raw, err := snappy.Decode(nil, g.body)
		if err != nil {
			t.Fatal(err)
		}
		// 4 counters + 3 active + 3 dropped + 7 jvm + 2 uris*3
		if n := countSeries(t, raw); n != 23 {
			t.Fatalf("series = %d, want 23", n)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("no request")
	}
}

func TestQueueDropsOldestWithoutBlocking(t *testing.T) {
	w := NewWriter("http://127.0.0.1:1") // Run is not started: queue fills
	done := make(chan struct{})
	go func() {
		for i := 0; i < QueueSize+10; i++ {
			w.Hook([]live.AggEvent{testEvent(0)})
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("Hook blocked")
	}
	if w.Dropped.Load() != 10 || len(w.q) != QueueSize {
		t.Fatalf("dropped=%d queued=%d", w.Dropped.Load(), len(w.q))
	}
}
