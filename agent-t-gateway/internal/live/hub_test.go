package live

import (
	"encoding/json"
	"runtime"
	"testing"
	"time"
)

func jsonUnmarshal(b []byte, v any) error { return json.Unmarshal(b, v) }

func TestSlowSubscriberDoesNotBlock(t *testing.T) {
	h := NewHub()
	slow := h.Subscribe(nil) // never read
	good := h.Subscribe(nil)
	const total = 10000
	got := make(chan int, 1)
	go func() {
		n := 0
		for range good.C {
			n++
			if n == total {
				break
			}
		}
		got <- n
	}()
	start := time.Now()
	for i := 0; i < total; i++ {
		for len(good.C) > SubBuffer/2 { // keep the healthy consumer within its buffer
			runtime.Gosched()
		}
		h.Publish(Event{Name: "agg", Data: []byte("{}")})
	}
	if d := time.Since(start); d > 100*time.Millisecond {
		t.Fatalf("publish took %v", d)
	}
	select {
	case n := <-got:
		if n != total {
			t.Fatalf("good got %d", n)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("healthy subscriber starved")
	}
	if slow.Dropped.Load() != total-SubBuffer || good.Dropped.Load() != 0 {
		t.Fatalf("dropped slow=%d good=%d", slow.Dropped.Load(), good.Dropped.Load())
	}
}

func TestHubSystemFilter(t *testing.T) {
	h := NewHub()
	a := h.Subscribe([]int64{1})
	h.Publish(Event{Name: "agg", SystemID: 2})
	h.Publish(Event{Name: "agg", SystemID: 1})
	h.Publish(Event{Name: "ping"}) // broadcast
	if len(a.C) != 2 {
		t.Fatalf("len=%d", len(a.C))
	}
}
