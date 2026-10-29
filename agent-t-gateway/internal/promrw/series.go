// Package promrw converts 5s aggregates into Prometheus remote write requests.
// The WriteRequest protobuf is hand-encoded with protowire (3 tiny messages) so the
// gateway does not pull in the prometheus/prometheus dependency tree.
package promrw

import (
	"math"
	"sort"
	"sync"

	"google.golang.org/protobuf/encoding/protowire"

	"synapse/agent-t-gateway/internal/live"
)

type Label struct{ Name, Value string }

// TimeSeries holds one sample (timestamp in ms) with labels sorted by name.
type TimeSeries struct {
	Labels []Label
	Value  float64
	TsMs   int64
}

// Builder turns AggEvents into series. It keeps cumulative dropped counters per instance
// because AggEvent.Dropped is per 5s window while Prometheus counters must be cumulative.
type Builder struct {
	mu      sync.Mutex
	dropped map[int64][3]int64
}

func NewBuilder() *Builder { return &Builder{dropped: map[int64][3]int64{}} }

func series(ts int64, v float64, base []Label, name string, extra ...Label) TimeSeries {
	ls := make([]Label, 0, len(base)+len(extra)+1)
	ls = append(ls, Label{"__name__", name})
	ls = append(ls, base...)
	ls = append(ls, extra...)
	sort.Slice(ls, func(i, j int) bool { return ls[i].Name < ls[j].Name })
	return TimeSeries{Labels: ls, Value: v, TsMs: ts}
}

// Build returns all series for one event. Every series carries system_name, display_name,
// instance_role and host (same base labels as agent/src/metrics/mod.rs).
func (b *Builder) Build(ev live.AggEvent) []TimeSeries {
	base := []Label{{"system_name", ev.Inst.SystemName}, {"display_name", ev.Inst.DisplayName},
		{"instance_role", ev.Inst.InstanceRole}, {"host", ev.Inst.Host}}
	ts, c := ev.Ts, ev.Counters
	f := func(name string, v float64, extra ...Label) TimeSeries { return series(ts, v, base, name, extra...) }

	b.mu.Lock()
	d := b.dropped[ev.Inst.AgentID]
	d[0] += ev.Dropped.Detail
	d[1] += ev.Dropped.SQL
	d[2] += ev.Dropped.Tx
	b.dropped[ev.Inst.AgentID] = d
	b.mu.Unlock()

	out := []TimeSeries{
		f("agent_t_tx_total", float64(c.TxTotal)),
		f("agent_t_tx_error_total", float64(c.ErrTotal)),
		f("agent_t_tx_slow_total", float64(c.SlowTotal)),
		f("agent_t_tx_elapsed_ms_sum", c.ElapsedSumMs),
		f("agent_t_active", float64(ev.Active[0]), Label{"bucket", "normal"}),
		f("agent_t_active", float64(ev.Active[1]), Label{"bucket", "warning"}),
		f("agent_t_active", float64(ev.Active[2]), Label{"bucket", "critical"}),
		f("agent_t_dropped_total", float64(d[0]), Label{"kind", "detail"}),
		f("agent_t_dropped_total", float64(d[1]), Label{"kind", "sql"}),
		f("agent_t_dropped_total", float64(d[2]), Label{"kind", "tx"}),
	}
	if j := ev.Jvm; j != nil {
		out = append(out,
			f("agent_t_jvm_heap_used_bytes", float64(j.HeapUsed)),
			f("agent_t_jvm_heap_max_bytes", float64(j.HeapMax)),
			f("agent_t_jvm_nonheap_used_bytes", float64(j.NonheapUsed)),
			f("agent_t_jvm_gc_count_total", float64(j.GCCount)),
			f("agent_t_jvm_gc_time_ms_total", float64(j.GCMs)),
			f("agent_t_jvm_threads", float64(j.Threads)),
			f("agent_t_jvm_cpu_ratio", j.CPURatio))
	}
	for uri, u := range c.UriTotals {
		l := Label{"uri", uri}
		out = append(out,
			f("agent_t_uri_tx_total", float64(u.Cnt), l),
			f("agent_t_uri_error_total", float64(u.Err), l),
			f("agent_t_uri_elapsed_ms_sum", u.Ms, l))
	}
	return out
}

// Encode serializes series as a prometheus.WriteRequest protobuf message.
func Encode(all []TimeSeries) []byte {
	var req []byte
	for _, s := range all {
		var tsb []byte
		for _, l := range s.Labels {
			var lb []byte
			lb = protowire.AppendTag(lb, 1, protowire.BytesType)
			lb = protowire.AppendString(lb, l.Name)
			lb = protowire.AppendTag(lb, 2, protowire.BytesType)
			lb = protowire.AppendString(lb, l.Value)
			tsb = protowire.AppendTag(tsb, 1, protowire.BytesType)
			tsb = protowire.AppendBytes(tsb, lb)
		}
		var sb []byte
		sb = protowire.AppendTag(sb, 1, protowire.Fixed64Type)
		sb = protowire.AppendFixed64(sb, math.Float64bits(s.Value))
		sb = protowire.AppendTag(sb, 2, protowire.VarintType)
		sb = protowire.AppendVarint(sb, uint64(s.TsMs))
		tsb = protowire.AppendTag(tsb, 2, protowire.BytesType)
		tsb = protowire.AppendBytes(tsb, sb)
		req = protowire.AppendTag(req, 1, protowire.BytesType)
		req = protowire.AppendBytes(req, tsb)
	}
	return req
}
