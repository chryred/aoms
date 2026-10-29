package promrw

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"sync/atomic"
	"time"

	"github.com/golang/snappy"

	"synapse/agent-t-gateway/internal/live"
)

const (
	QueueSize   = 32 // pending 5s payloads; oldest is dropped beyond this
	HTTPTimeout = 5 * time.Second
)

// Writer posts aggregates to a Prometheus remote write endpoint through a bounded queue,
// so a slow Prometheus never blocks aggregation (Enqueue never blocks).
type Writer struct {
	URL     string
	Client  *http.Client
	Builder *Builder

	Dropped atomic.Int64 // payloads dropped because the queue was full
	Failed  atomic.Int64 // payloads that failed to send

	q chan []byte
}

func NewWriter(url string) *Writer {
	return &Writer{URL: url, Client: &http.Client{Timeout: HTTPTimeout}, Builder: NewBuilder(), q: make(chan []byte, QueueSize)}
}

// Hook is assigned to live.State.OnAgg.
func (w *Writer) Hook(evs []live.AggEvent) {
	var all []TimeSeries
	for _, ev := range evs {
		all = append(all, w.Builder.Build(ev)...)
	}
	if len(all) > 0 {
		w.enqueue(snappy.Encode(nil, Encode(all)))
	}
}

func (w *Writer) enqueue(p []byte) {
	for {
		select {
		case w.q <- p:
			return
		default:
		}
		select { // full: drop the oldest
		case <-w.q:
			w.Dropped.Add(1)
		default:
		}
	}
}

// Run sends queued payloads until ctx is done.
func (w *Writer) Run(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case p := <-w.q:
			if err := w.post(ctx, p); err != nil && ctx.Err() == nil {
				if w.Failed.Add(1)%12 == 1 { // log first failure, then about once a minute
					log.Printf("promrw: remote write failed: %v", err)
				}
			}
		}
	}
}

func (w *Writer) post(ctx context.Context, body []byte) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Encoding", "snappy")
	req.Header.Set("Content-Type", "application/x-protobuf")
	req.Header.Set("X-Prometheus-Remote-Write-Version", "0.1.0")
	resp, err := w.Client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return &statusError{resp.StatusCode}
	}
	return nil
}

type statusError struct{ code int }

func (e *statusError) Error() string { return "unexpected status " + http.StatusText(e.code) }
