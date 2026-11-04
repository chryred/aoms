// Package live keeps per-instance in-memory state, 5s aggregation and the SSE fan-out.
package live

import (
	"context"
	"encoding/json"
	"sort"
	"sync"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

const (
	RingSize         = 120 // 10 minutes of 5s aggregates
	MaxPointsPerSec  = 200
	resolverCapacity = 200000
)

type activeTop struct {
	TraceID   string   `json:"trace_id"`
	SpanID    string   `json:"span_id"`
	Thread    string   `json:"thread"`
	URI       string   `json:"uri"`
	StartTs   int64    `json:"start_ts"`
	ElapsedMs int64    `json:"elapsed_ms"`
	Phase     string   `json:"phase"`
	SQL       *string  `json:"sql"`
	Stack     []string `json:"stack"`
}

type activePayload struct {
	SystemID     int64       `json:"system_id"`
	InstanceRole string      `json:"instance_role"`
	Ts           int64       `json:"ts"`
	SlowMs       int64       `json:"slow_ms"`
	Buckets      [3]int64    `json:"buckets"`
	Top          []activeTop `json:"top"`
}

type point struct {
	Ts        int64  `json:"ts"`
	ElapsedMs int64  `json:"elapsed_ms"`
	Error     bool   `json:"error"`
	TraceID   string `json:"trace_id"`
	SpanID    string `json:"span_id"`
}

type pointsPayload struct {
	SystemID     int64   `json:"system_id"`
	InstanceRole string  `json:"instance_role"`
	Points       []point `json:"points"`
}

type uriItem struct {
	URI string  `json:"uri"`
	Cnt int64   `json:"cnt"`
	Ms  float64 `json:"ms"`
}
type sqlItem struct {
	SQL string  `json:"sql"`
	Cnt int64   `json:"cnt"`
	Ms  float64 `json:"ms"`
}

type aggPayload struct {
	SystemID     int64            `json:"system_id"`
	InstanceRole string           `json:"instance_role"`
	Ts           int64            `json:"ts"`
	Tps          float64          `json:"tps"`
	AvgMs        float64          `json:"avg_ms"`
	ErrRate      float64          `json:"err_rate"`
	SlowCnt      int              `json:"slow_cnt"`
	UriTop       []uriItem        `json:"uri_top"`
	SqlTop       []sqlItem        `json:"sql_top"`
	Jvm          *protocol.JVM    `json:"jvm"`
	Dropped      protocol.Dropped `json:"dropped"`
	// Users5m = distinct users (user_id, else user_ip) seen in the last 5 minutes on this
	// instance. UsersCapped = the per-instance key cap (UsersMaxKeys) was hit, so it is a lower bound.
	Users5m     int  `json:"users_5m"`
	UsersCapped bool `json:"users_capped,omitempty"`
}

type instState struct {
	inst     registry.Instance
	lastSeen int64
	active   []byte // latest active payload JSON
	ring     []aggPayload
	win      *window
	users    *userSet
	cum      Counters
	buckets  [3]int64
	sampSec  int64
	sampUsed int
}

// State implements ingest.Sink for the live path.
type State struct {
	Hub   *Hub
	Now   func() time.Time
	OnAgg func([]AggEvent) // called by Run after each aggregation (Prometheus writer hook)

	mu    sync.Mutex
	insts map[int64]*instState

	rmu      sync.Mutex
	resolved map[string]string // "uri:id" / "sql:id" -> text, learned from batch dicts
}

func NewState(hub *Hub) *State {
	return &State{Hub: hub, Now: time.Now, insts: map[int64]*instState{}, resolved: map[string]string{}}
}

func (s *State) learn(b *protocol.Batch) {
	if len(b.Dict.SQL) == 0 && len(b.Dict.URI) == 0 {
		return
	}
	s.rmu.Lock()
	defer s.rmu.Unlock()
	put := func(k, v string) {
		if len(s.resolved) >= resolverCapacity {
			for old := range s.resolved { // evict an arbitrary entry
				delete(s.resolved, old)
				break
			}
		}
		s.resolved[k] = v
	}
	for id, t := range b.Dict.URI {
		put("uri:"+id, t)
	}
	for id, t := range b.Dict.SQL {
		put("sql:"+id, t)
	}
}

// name resolves a dictionary id to text, falling back to the id itself.
func (s *State) name(kind, id string) string {
	s.rmu.Lock()
	defer s.rmu.Unlock()
	if t, ok := s.resolved[kind+":"+id]; ok {
		return t
	}
	return id
}

func (s *State) get(inst registry.Instance) *instState {
	is := s.insts[inst.AgentID]
	if is == nil {
		is = &instState{win: newWindow(), users: newUserSet(), cum: Counters{UriTotals: map[string]UriCounter{}}}
		s.insts[inst.AgentID] = is
	}
	is.inst = inst
	return is
}

// Accept ingests one batch: accumulates the aggregation window and publishes active/points.
func (s *State) Accept(inst registry.Instance, b *protocol.Batch, offsetMs int64) {
	s.learn(b)
	now := s.Now().UnixMilli()

	pts := make([]point, 0, len(b.Tx))
	uris := make([]string, len(b.Tx))
	sqlNames := make([][]string, len(b.Tx))
	for i, t := range b.Tx {
		uris[i] = s.name("uri", t.URIID)
		sqlNames[i] = make([]string, len(t.SQL))
		for j, q := range t.SQL {
			sqlNames[i][j] = s.name("sql", q.SQLID)
		}
	}
	ap := activePayload{SystemID: inst.SystemID, InstanceRole: inst.InstanceRole, Ts: now,
		SlowMs: inst.SlowMs, Buckets: b.Active.Buckets, Top: make([]activeTop, 0, len(b.Active.Top))}
	for _, t := range b.Active.Top {
		at := activeTop{TraceID: t.TraceID, SpanID: t.SpanID, Thread: t.Thread, URI: s.name("uri", t.URIID),
			StartTs: t.StartTs + offsetMs, Phase: t.Phase, Stack: t.Stack}
		if at.Stack == nil {
			at.Stack = []string{}
		}
		at.ElapsedMs = now - at.StartTs
		if t.SQLID != nil {
			q := s.name("sql", *t.SQLID)
			at.SQL = &q
		}
		ap.Top = append(ap.Top, at)
	}
	activeJSON, _ := json.Marshal(ap)

	s.mu.Lock()
	is := s.get(inst)
	is.lastSeen = now
	is.active = activeJSON
	is.buckets = b.Active.Buckets
	w := is.win
	slowTx := make([]point, 0)
	rest := make([]point, 0, len(b.Tx))
	for i, t := range b.Tx {
		ms := float64(t.ElapsedMs)
		w.tx++
		w.sumMs += ms
		is.cum.TxTotal++
		is.cum.ElapsedSumMs += ms
		if t.Error {
			w.errs++
			is.cum.ErrTotal++
		}
		isSlow := t.ElapsedMs >= inst.SlowMs
		if isSlow {
			w.slow++
			is.cum.SlowTotal++
		}
		is.users.add(userKey(t.UserID, t.UserIP), now)
		bump(w.uri, uris[i], 1, ms)
		is.cum.addURI(uris[i], ms, t.Error)
		for j, q := range t.SQL {
			bump(w.sql, sqlNames[i][j], q.Cnt, float64(q.Ms))
		}
		p := point{Ts: t.StartTs + offsetMs + t.ElapsedMs, ElapsedMs: t.ElapsedMs, Error: t.Error, TraceID: t.TraceID, SpanID: t.SpanID}
		if isSlow || t.Error {
			slowTx = append(slowTx, p)
		} else {
			rest = append(rest, p)
		}
	}
	if b.JVM != nil {
		j := *b.JVM
		w.jvm = &j
	}
	w.dropped.Detail += b.Dropped.Detail
	w.dropped.SQL += b.Dropped.SQL
	w.dropped.Tx += b.Dropped.Tx

	sec := now / 1000
	if sec != is.sampSec {
		is.sampSec, is.sampUsed = sec, 0
	}
	pts = samplePoints(slowTx, rest, MaxPointsPerSec-is.sampUsed)
	is.sampUsed += len(pts)
	s.mu.Unlock()

	if s.Hub == nil {
		return
	}
	s.Hub.Publish(Event{Name: "active", SystemID: inst.SystemID, Data: activeJSON})
	if len(pts) > 0 {
		d, _ := json.Marshal(pointsPayload{SystemID: inst.SystemID, InstanceRole: inst.InstanceRole, Points: pts})
		s.Hub.Publish(Event{Name: "points", SystemID: inst.SystemID, Data: d})
	}
}

// samplePoints keeps slow/error points first (up to budget), then a uniform sample of the rest.
func samplePoints(priority, rest []point, budget int) []point {
	if budget <= 0 {
		return nil
	}
	if len(priority) >= budget {
		return append([]point(nil), priority[:budget]...)
	}
	out := append([]point(nil), priority...)
	room := budget - len(out)
	if len(rest) <= room {
		return append(out, rest...)
	}
	// even stride across the batch
	for i := 0; i < room; i++ {
		out = append(out, rest[i*len(rest)/room])
	}
	return out
}

// Aggregate closes the current 5s window of every recently seen instance, appends it to the
// 10 minute ring and returns the events (same values feed Prometheus remote write).
func (s *State) Aggregate() []AggEvent {
	now := s.Now().UnixMilli()
	s.mu.Lock()
	defer s.mu.Unlock()
	var out []AggEvent
	for _, is := range s.insts {
		w := is.win
		users, capped := is.users.count(now) // also frees expired keys of idle instances
		if w.tx == 0 && w.jvm == nil && now-is.lastSeen > 60000 {
			continue
		}
		ev := AggEvent{Inst: is.inst, Ts: now, Tps: float64(w.tx) / AggWindowSec, SlowCnt: w.slow,
			UriTop: topOf(w.uri), SqlTop: topOf(w.sql), Jvm: w.jvm, Dropped: w.dropped, Active: is.buckets, Counters: is.cum.clone(),
			Users5m: users, UsersCapped: capped}
		if w.tx > 0 {
			ev.AvgMs = w.sumMs / float64(w.tx)
			ev.ErrRate = float64(w.errs) / float64(w.tx)
		}
		ap := aggPayload{SystemID: is.inst.SystemID, InstanceRole: is.inst.InstanceRole, Ts: now,
			Tps: ev.Tps, AvgMs: ev.AvgMs, ErrRate: ev.ErrRate, SlowCnt: ev.SlowCnt,
			UriTop: make([]uriItem, 0, len(ev.UriTop)), SqlTop: make([]sqlItem, 0, len(ev.SqlTop)),
			Jvm: ev.Jvm, Dropped: ev.Dropped, Users5m: users, UsersCapped: capped}
		for _, t := range ev.UriTop {
			ap.UriTop = append(ap.UriTop, uriItem{URI: t.Name, Cnt: t.Cnt, Ms: t.Ms})
		}
		for _, t := range ev.SqlTop {
			ap.SqlTop = append(ap.SqlTop, sqlItem{SQL: t.Name, Cnt: t.Cnt, Ms: t.Ms})
		}
		is.ring = append(is.ring, ap)
		if len(is.ring) > RingSize {
			is.ring = append([]aggPayload(nil), is.ring[len(is.ring)-RingSize:]...)
		}
		is.win = newWindow()
		out = append(out, ev)
		if s.Hub != nil {
			d, _ := json.Marshal(ap)
			s.Hub.Publish(Event{Name: "agg", SystemID: is.inst.SystemID, Data: d})
		}
	}
	return out
}

func (c Counters) clone() Counters {
	m := make(map[string]UriCounter, len(c.UriTotals))
	for k, v := range c.UriTotals {
		m[k] = v
	}
	c.UriTotals = m
	return c
}

// Run aggregates every 5s until ctx is done.
func (s *State) Run(ctx context.Context) {
	t := time.NewTicker(AggWindowSec * time.Second)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			evs := s.Aggregate()
			if s.OnAgg != nil && len(evs) > 0 {
				s.OnAgg(evs)
			}
		}
	}
}

type snapInstance struct {
	SystemID     int64           `json:"system_id"`
	InstanceRole string          `json:"instance_role"`
	Host         string          `json:"host"`
	LastSeen     int64           `json:"last_seen"`
	Active       json.RawMessage `json:"active"`
	Agg          []aggPayload    `json:"agg"`
}

// Snapshot returns the polling/initial-load view, filtered by system ids (empty = all).
func (s *State) Snapshot(systemIDs map[int64]bool) any {
	s.mu.Lock()
	defer s.mu.Unlock()
	list := make([]snapInstance, 0, len(s.insts))
	for _, is := range s.insts {
		if len(systemIDs) > 0 && !systemIDs[is.inst.SystemID] {
			continue
		}
		agg := append([]aggPayload{}, is.ring...)
		var active json.RawMessage = json.RawMessage("null")
		if is.active != nil {
			active = json.RawMessage(is.active)
		}
		list = append(list, snapInstance{SystemID: is.inst.SystemID, InstanceRole: is.inst.InstanceRole,
			Host: is.inst.Host, LastSeen: is.lastSeen, Active: active, Agg: agg})
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].SystemID != list[j].SystemID {
			return list[i].SystemID < list[j].SystemID
		}
		return list[i].InstanceRole < list[j].InstanceRole
	})
	return map[string]any{"instances": list}
}
