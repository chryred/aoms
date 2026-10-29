package store

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"sync"
	"sync/atomic"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

const (
	tblSummary = "tx_summary"
	tblSQL     = "tx_sql"
	tblDetail  = "tx_detail"
	tblDump    = "jvm_thread_dump"
	tblDictSQL = "dict_sql"
	tblDictURI = "dict_uri"

	pressureBackoffMs = 2000
)

var allTables = []string{tblSummary, tblSQL, tblDetail, tblDump, tblDictSQL, tblDictURI}

// dropOrder is the overload shedding order: detail, then SQL aggregates, then summary.
var dropOrder = []string{tblDetail, tblSQL, tblSummary}

type Config struct {
	URL           string // ClickHouse HTTP endpoint, e.g. http://clickhouse:8123
	DB            string
	User          string
	Password      string
	FlushInterval time.Duration
	FlushRows     int
	MaxQueueBytes int64
}

// DumpAcker is told when a thread-dump result has been received (CommandSource.Done fits).
type DumpAcker interface {
	Done(cmdID int64, ok bool)
}

// DropStats counts rows discarded under queue pressure.
type DropStats struct{ Detail, SQL, Summary, Dict int64 }

type buffer struct{ lines [][]byte }

// Writer batches rows per table and inserts them into ClickHouse over HTTP.
// It implements ingest.Sink and ingest.Backpressure.
type Writer struct {
	cfg    Config
	client *http.Client
	Dumps  DumpAcker // optional

	mu     sync.Mutex
	bufs   map[string]*buffer
	queued int64 // bytes held in buffers or in flight
	// dumpAcks are cmd ids whose thread-dump rows are queued; acked once the insert resolves.
	dumpAcks []int64
	kick     chan struct{}

	flushMu sync.Mutex // serialises flushes

	droppedDetail, droppedSQL, droppedSummary, droppedDict atomic.Int64
}

func NewWriter(cfg Config, client *http.Client) *Writer {
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	if cfg.FlushInterval <= 0 {
		cfg.FlushInterval = time.Second
	}
	if cfg.FlushRows <= 0 {
		cfg.FlushRows = 10000
	}
	w := &Writer{cfg: cfg, client: client, bufs: map[string]*buffer{}, kick: make(chan struct{}, 1)}
	for _, t := range allTables {
		w.bufs[t] = &buffer{}
	}
	return w
}

// Accept converts a batch to rows and queues them. It never blocks on ClickHouse.
func (w *Writer) Accept(inst registry.Instance, b *protocol.Batch, offsetMs int64) {
	type item struct {
		table string
		row   map[string]any
	}
	var items []item
	for _, tx := range b.Tx {
		if !validTx(tx) {
			continue
		}
		items = append(items, item{tblSummary, SummaryRow(inst, tx, offsetMs)})
		for _, r := range SqlRows(inst, tx, offsetMs) {
			items = append(items, item{tblSQL, r})
		}
		if tx.Detail != nil {
			items = append(items, item{tblDetail, DetailRow(inst, tx, offsetMs)})
		}
	}
	for _, d := range b.Dumps {
		items = append(items, item{tblDump, DumpRow(inst, d, offsetMs)})
	}
	if len(items) == 0 {
		return
	}
	lines := make([][]byte, len(items))
	for i, it := range items {
		lines[i], _ = json.Marshal(it.row)
	}

	w.mu.Lock()
	full := false
	for i, it := range items {
		buf := w.bufs[it.table]
		buf.lines = append(buf.lines, lines[i])
		w.queued += int64(len(lines[i]))
		if len(buf.lines) >= w.cfg.FlushRows {
			full = true
		}
	}
	for _, d := range b.Dumps {
		w.dumpAcks = append(w.dumpAcks, d.CmdID)
	}
	w.shedLocked()
	w.mu.Unlock()
	if full {
		w.kickFlush()
	}
}

// PutDict queues a dict_sql / dict_uri row (kind "sql" or "uri").
func (w *Writer) PutDict(kind, id, text string) {
	table := tblDictURI
	if kind == "sql" {
		table = tblDictSQL
	}
	line, _ := json.Marshal(map[string]any{
		"id": hexID(id), "text": text, "last_seen": fmtSeconds(time.Now()),
	})
	w.mu.Lock()
	buf := w.bufs[table]
	buf.lines = append(buf.lines, line)
	w.queued += int64(len(line))
	full := len(buf.lines) >= w.cfg.FlushRows
	w.shedLocked()
	w.mu.Unlock()
	if full {
		w.kickFlush()
	}
}

// shedLocked drops the oldest rows (detail, then SQL, then summary, then dict) until under the limit.
func (w *Writer) shedLocked() {
	for w.queued > w.cfg.MaxQueueBytes {
		dropped := false
		for _, t := range dropOrder {
			buf := w.bufs[t]
			if len(buf.lines) == 0 {
				continue
			}
			w.queued -= int64(len(buf.lines[0]))
			buf.lines[0] = nil
			buf.lines = buf.lines[1:]
			switch t {
			case tblDetail:
				w.droppedDetail.Add(1)
			case tblSQL:
				w.droppedSQL.Add(1)
			default:
				w.droppedSummary.Add(1)
			}
			dropped = true
			break
		}
		if dropped {
			continue
		}
		// Hard ceiling: only dict rows may still be shed. Dump rows are never dropped.
		for _, t := range []string{tblDictSQL, tblDictURI} {
			buf := w.bufs[t]
			if len(buf.lines) == 0 {
				continue
			}
			w.queued -= int64(len(buf.lines[0]))
			buf.lines[0] = nil
			buf.lines = buf.lines[1:]
			w.droppedDict.Add(1)
			dropped = true
			break
		}
		if !dropped {
			return
		}
	}
}

func (w *Writer) Dropped() DropStats {
	return DropStats{Detail: w.droppedDetail.Load(), SQL: w.droppedSQL.Load(), Summary: w.droppedSummary.Load(), Dict: w.droppedDict.Load()}
}

// BackoffMs asks agents to pause when the queue is at or above 80% of its limit.
func (w *Writer) BackoffMs() int {
	if w.queuedBytes()*10 >= w.cfg.MaxQueueBytes*8 {
		return pressureBackoffMs
	}
	return 0
}

func (w *Writer) queuedBytes() int64 {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.queued
}

func (w *Writer) kickFlush() {
	select {
	case w.kick <- struct{}{}:
	default:
	}
}

// Run flushes on the interval, when a table reaches FlushRows, and once more on shutdown.
func (w *Writer) Run(ctx context.Context) {
	t := time.NewTicker(w.cfg.FlushInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			sc, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			if err := w.Flush(sc); err != nil {
				log.Printf("clickhouse final flush: %v", err)
			}
			cancel()
			return
		case <-t.C:
			if err := w.Flush(ctx); err != nil {
				log.Printf("clickhouse flush: %v", err)
			}
		case <-w.kick:
			if err := w.flush(ctx, w.cfg.FlushRows); err != nil {
				log.Printf("clickhouse flush: %v", err)
			}
		}
	}
}

// Flush inserts every non-empty table buffer.
func (w *Writer) Flush(ctx context.Context) error { return w.flush(ctx, 1) }

// flush inserts tables holding at least minRows rows. Returns the first error.
func (w *Writer) flush(ctx context.Context, minRows int) error {
	w.flushMu.Lock()
	defer w.flushMu.Unlock()
	var first error
	for _, t := range allTables {
		w.mu.Lock()
		buf := w.bufs[t]
		if len(buf.lines) == 0 || len(buf.lines) < minRows {
			w.mu.Unlock()
			continue
		}
		lines := buf.lines
		buf.lines = nil
		var acks []int64
		if t == tblDump {
			acks, w.dumpAcks = w.dumpAcks, nil
		}
		w.mu.Unlock()

		// Insert in chunks of at most FlushRows so a backlog after an outage drains in
		// bounded requests. On a transient failure only the unsent remainder is re-queued.
		for off := 0; off < len(lines); {
			end := off + w.cfg.FlushRows
			if end > len(lines) {
				end = len(lines)
			}
			chunk := lines[off:end]
			var size int64
			for _, l := range chunk {
				size += int64(len(l))
			}
			retry, err := w.insert(ctx, t, chunk)
			if err != nil && retry {
				// Put the unsent rows back in front of anything queued meanwhile; still counted in w.queued.
				w.mu.Lock()
				w.bufs[t].lines = append(lines[off:len(lines):len(lines)], w.bufs[t].lines...)
				if t == tblDump {
					w.dumpAcks = append(acks[off:len(acks):len(acks)], w.dumpAcks...)
				}
				w.mu.Unlock()
				if first == nil {
					first = err
				}
				break
			}
			w.mu.Lock()
			w.queued -= size
			w.mu.Unlock()
			if t == tblDump && w.Dumps != nil {
				for _, id := range acks[off:end] {
					w.Dumps.Done(id, err == nil)
				}
			}
			if err != nil {
				log.Printf("clickhouse %s: discarding %d rows: %v", t, len(chunk), err)
				if first == nil {
					first = err
				}
			}
			off = end
		}
	}
	return first
}

// insert posts one JSONEachRow body. retry=true for transient failures (network, 5xx, 429).
func (w *Writer) insert(ctx context.Context, table string, lines [][]byte) (retry bool, err error) {
	var body bytes.Buffer
	zw := gzip.NewWriter(&body)
	for i, l := range lines {
		if i > 0 {
			zw.Write([]byte{'\n'})
		}
		zw.Write(l)
	}
	if err := zw.Close(); err != nil {
		return false, err
	}
	q := url.Values{"query": {fmt.Sprintf("INSERT INTO %s.%s FORMAT JSONEachRow", w.cfg.DB, table)}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.cfg.URL+"/?"+q.Encode(), &body)
	if err != nil {
		return false, err
	}
	req.Header.Set("Content-Encoding", "gzip")
	if w.cfg.User != "" {
		req.Header.Set("X-ClickHouse-User", w.cfg.User)
		req.Header.Set("X-ClickHouse-Key", w.cfg.Password)
	}
	resp, err := w.client.Do(req)
	if err != nil {
		return true, err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 == 2 {
		io.Copy(io.Discard, resp.Body)
		return false, nil
	}
	msg, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	err = fmt.Errorf("insert %s: HTTP %d: %s", table, resp.StatusCode, msg)
	return resp.StatusCode >= 500 || resp.StatusCode == 429, err
}
