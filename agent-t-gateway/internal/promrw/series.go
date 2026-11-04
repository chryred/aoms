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
	"synapse/agent-t-gateway/internal/protocol"
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
		for _, c := range []struct {
			name string
			v    *int64
		}{{"agent_t_jvm_conn_active", j.ConnActive}, {"agent_t_jvm_conn_idle", j.ConnIdle},
			{"agent_t_jvm_conn_max", j.ConnMax}, {"agent_t_jvm_conn_wait", j.ConnWait}} {
			if c.v != nil {
				out = append(out, f(c.name, float64(*c.v)))
			}
		}
		out = appendPoolSeries(out, j.Pools, f)
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

// MaxPoolSeries caps per-pool series per instance (label cardinality guard); the agent already
// sends at most 64 pools sorted by utilization, so the busiest pools win.
const MaxPoolSeries = 64

const maxPoolNameLen = 128

// appendPoolSeries adds agent_t_db_pool_{active,idle,max,wait}{pool,kind}. Duplicate (pool, kind)
// pairs are dropped: a remote write request must not carry the same label set twice.
func appendPoolSeries(out []TimeSeries, pools []protocol.PoolStat, f func(string, float64, ...Label) TimeSeries) []TimeSeries {
	seen := map[[2]string]bool{}
	for _, p := range pools {
		if len(seen) >= MaxPoolSeries {
			break
		}
		name := p.Name
		if name == "" {
			continue
		}
		if len(name) > maxPoolNameLen {
			name = name[:maxPoolNameLen]
		}
		k := [2]string{name, p.Kind}
		if seen[k] {
			continue
		}
		seen[k] = true
		ls := []Label{{"pool", name}, {"kind", p.Kind}}
		out = append(out,
			f("agent_t_db_pool_active", float64(p.Active), ls...),
			f("agent_t_db_pool_idle", float64(p.Idle), ls...),
			f("agent_t_db_pool_max", float64(p.Max), ls...),
			f("agent_t_db_pool_wait", float64(p.Wait), ls...))
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
