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

type buffer struct {
	lines [][]byte
	ids   []string // dict tables only: agent-side ids parallel to lines (for cache eviction)
}

// chunk is one ClickHouse insert unit. Its token is fixed at creation so a retry of the
// exact same body (e.g. after a timeout that actually committed) is deduplicated by
// ClickHouse; a failed chunk is re-queued whole and never re-chunked with newer rows.
type chunk struct {
	lines [][]byte
	size  int64
	acks  []int64  // thread-dump command ids, parallel to lines (dump table only)
	ids   []string // dict ids, parallel to lines (dict tables only)
	token string
}

// Writer batches rows per table and inserts them into ClickHouse over HTTP.
// It implements ingest.Sink and ingest.Backpressure.
type Writer struct {
	cfg    Config
	client *http.Client
	Dumps  DumpAcker // optional
	// OnDictLost is told when a dict row is shed or permanently rejected, so the
	// in-memory cache forgets the id and agents are asked for the text again (need_dict).
	OnDictLost func(kind, id string)

	mu     sync.Mutex
	bufs   map[string]*buffer
	retry  map[string][]*chunk // failed chunks awaiting re-insert, oldest first
	seq    uint64              // chunk token counter
	queued int64               // bytes held in buffers or in flight
	// dumpAcks are cmd ids whose thread-dump rows are queued; acked once the insert resolves.
	dumpAcks []int64
	kick     chan struct{}

	flushMu sync.Mutex // serialises flushes
	epoch   int64      // makes tokens unique across gateway restarts

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
	w := &Writer{cfg: cfg, client: client, bufs: map[string]*buffer{}, retry: map[string][]*chunk{},
		kick: make(chan struct{}, 1), epoch: time.Now().UnixNano()}
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
	buf.ids = append(buf.ids, id)
	w.queued += int64(len(line))
	full := len(buf.lines) >= w.cfg.FlushRows
	w.shedLocked()
	w.mu.Unlock()
	if full {
		w.kickFlush()
	}
}

// shedLocked drops the oldest rows (detail, then SQL, then summary, then dict) until under the limit.
// Chunks waiting for a retry are older than buffered rows and go first, as a whole.
func (w *Writer) shedLocked() {
	for w.queued > w.cfg.MaxQueueBytes {
		dropped := false
		for _, t := range dropOrder {
			if w.shedOneLocked(t) {
				dropped = true
				break
			}
		}
		if dropped {
			continue
		}
		// Hard ceiling: only dict rows may still be shed. Dump rows are never dropped.
		for _, t := range []string{tblDictSQL, tblDictURI} {
			if w.shedOneLocked(t) {
				dropped = true
				break
			}
		}
		if !dropped {
			return
		}
	}
}

func (w *Writer) shedOneLocked(t string) bool {
	if rc := w.retry[t]; len(rc) > 0 {
		c := rc[0]
		w.retry[t] = rc[1:]
		w.queued -= c.size
		w.countDropped(t, int64(len(c.lines)))
		w.dictLost(t, c.ids)
		return true
	}
	buf := w.bufs[t]
	if len(buf.lines) == 0 {
		return false
	}
	w.queued -= int64(len(buf.lines[0]))
	buf.lines[0] = nil
	buf.lines = buf.lines[1:]
	if len(buf.ids) > 0 {
		w.dictLost(t, buf.ids[:1])
		buf.ids = buf.ids[1:]
	}
	w.countDropped(t, 1)
	return true
}

func (w *Writer) countDropped(t string, n int64) {
	switch t {
	case tblDetail:
		w.droppedDetail.Add(n)
	case tblSQL:
		w.droppedSQL.Add(n)
	case tblDictSQL, tblDictURI:
		w.droppedDict.Add(n)
	default:
		w.droppedSummary.Add(n)
	}
}

func (w *Writer) dictLost(t string, ids []string) {
	if w.OnDictLost == nil || len(ids) == 0 {
		return
	}
	kind := "uri"
	if t == tblDictSQL {
		kind = "sql"
	}
	for _, id := range ids {
		w.OnDictLost(kind, id)
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

// flush inserts tables holding at least minRows rows, plus any chunks awaiting a retry.
// Returns the first error.
func (w *Writer) flush(ctx context.Context, minRows int) error {
	w.flushMu.Lock()
	defer w.flushMu.Unlock()
	var first error
	for _, t := range allTables {
		w.mu.Lock()
		chunks := w.retry[t]
		w.retry[t] = nil
		buf := w.bufs[t]
		if len(buf.lines) > 0 && len(buf.lines) >= minRows {
			lines, ids := buf.lines, buf.ids
			buf.lines, buf.ids = nil, nil
			var acks []int64
			if t == tblDump {
				acks, w.dumpAcks = w.dumpAcks, nil
			}
			// Split into chunks of at most FlushRows so a backlog after an outage drains in
			// bounded requests. Each chunk gets its dedup token once, here.
			for off := 0; off < len(lines); off += w.cfg.FlushRows {
				end := off + w.cfg.FlushRows
				if end > len(lines) {
					end = len(lines)
				}
				c := &chunk{lines: lines[off:end:end]}
				for _, l := range c.lines {
					c.size += int64(len(l))
				}
				if acks != nil {
					c.acks = acks[off:end:end]
				}
				if len(ids) > 0 {
					c.ids = ids[off:end:end]
				}
				w.seq++
				c.token = fmt.Sprintf("%s-%x-%d", t, w.epoch, w.seq)
				chunks = append(chunks, c)
			}
		}
		w.mu.Unlock()

		for i, c := range chunks {
			retry, err := w.insert(ctx, t, c)
			if err != nil && retry {
				// Re-queue this chunk and everything after it, whole and in order. They stay
				// counted in w.queued and may be shed (as units) under pressure.
				w.mu.Lock()
				w.retry[t] = append(chunks[i:len(chunks):len(chunks)], w.retry[t]...)
				w.mu.Unlock()
				if first == nil {
					first = err
				}
				break
			}
			w.mu.Lock()
			w.queued -= c.size
			if err != nil {
				w.dictLost(t, c.ids)
			}
			w.mu.Unlock()
			if t == tblDump && w.Dumps != nil {
				for _, id := range c.acks {
					w.Dumps.Done(id, err == nil)
				}
			}
			if err != nil {
				log.Printf("clickhouse %s: discarding %d rows: %v", t, len(c.lines), err)
				if first == nil {
					first = err
				}
			}
		}
	}
	return first
}

// insert posts one JSONEachRow body, tagged with the chunk's deduplication token. retry=true for transient failures (network, 5xx, 429).
func (w *Writer) insert(ctx context.Context, table string, c *chunk) (retry bool, err error) {
	lines := c.lines
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
	q := url.Values{
		"query":                      {fmt.Sprintf("INSERT INTO %s.%s FORMAT JSONEachRow", w.cfg.DB, table)},
		"insert_deduplication_token": {c.token},
	}
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
