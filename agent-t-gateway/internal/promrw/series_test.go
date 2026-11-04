package promrw

import (
	"testing"

	"synapse/agent-t-gateway/internal/live"
	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

func testEvent(nURI int) live.AggEvent {
	uris := map[string]live.UriCounter{}
	for i := 0; i < nURI; i++ {
		uris["/u"+string(rune('a'+i%26))+string(rune('a'+i/26))] = live.UriCounter{Cnt: 2, Err: 1, Ms: 30}
	}
	return live.AggEvent{
		Inst: registry.Instance{AgentID: 1, SystemName: "shop", DisplayName: "Shop", InstanceRole: "primary", Host: "h1"},
		Ts:   1700000000123, Active: [3]int64{5, 2, 1},
		Jvm:      &protocol.JVM{HeapUsed: 1, HeapMax: 2, NonheapUsed: 3, GCCount: 4, GCMs: 5, Threads: 6, CPURatio: 0.5},
		Dropped:  protocol.Dropped{Detail: 1, SQL: 2, Tx: 3},
		Counters: live.Counters{TxTotal: 10, ErrTotal: 2, SlowTotal: 1, ElapsedSumMs: 99, UriTotals: uris},
	}
}

func TestSeriesLabels(t *testing.T) {
	ss := NewBuilder().Build(testEvent(201))
	want := map[string]string{"system_name": "shop", "display_name": "Shop", "instance_role": "primary", "host": "h1"}
	active, uri := 0, 0
	for _, s := range ss {
		got := map[string]string{}
		for i, l := range s.Labels {
			got[l.Name] = l.Value
			if i > 0 && s.Labels[i-1].Name >= l.Name {
				t.Fatalf("labels not sorted: %v", s.Labels)
			}
		}
		for k, v := range want {
			if got[k] != v {
				t.Fatalf("series %s missing label %s=%s: %v", got["__name__"], k, v, s.Labels)
			}
		}
		if s.TsMs != 1700000000123 {
			t.Fatalf("ts %d", s.TsMs)
		}
		switch got["__name__"] {
		case "agent_t_active":
			active++
		case "agent_t_uri_tx_total", "agent_t_uri_error_total", "agent_t_uri_elapsed_ms_sum":
			uri++
		}
	}
	if active != 3 {
		t.Fatalf("active series = %d", active)
	}
	if uri != 201*3 {
		t.Fatalf("uri series = %d", uri)
	}
}

func TestDroppedIsCumulative(t *testing.T) {
	b := NewBuilder()
	b.Build(testEvent(0))
	var tx float64
	for _, s := range b.Build(testEvent(0)) {
		for _, l := range s.Labels {
			if l.Name == "kind" && l.Value == "tx" {
				tx = s.Value
			}
		}
	}
	if tx != 6 {
		t.Fatalf("cumulative dropped tx = %v, want 6", tx)
	}
}

func seriesByName(ss []TimeSeries, name string) []TimeSeries {
	var out []TimeSeries
	for _, s := range ss {
		for _, l := range s.Labels {
			if l.Name == "__name__" && l.Value == name {
				out = append(out, s)
			}
		}
	}
	return out
}

func labelOf(s TimeSeries, name string) string {
	for _, l := range s.Labels {
		if l.Name == name {
			return l.Value
		}
	}
	return ""
}

func i64(v int64) *int64 { return &v }

func TestPoolSeries(t *testing.T) {
	ev := testEvent(0)
	ev.Jvm.ConnActive, ev.Jvm.ConnIdle, ev.Jvm.ConnMax, ev.Jvm.ConnWait = i64(12), i64(3), i64(35), i64(2)
	ev.Jvm.Pools = []protocol.PoolStat{
		{Name: "sic_DS", Kind: "jeus", Active: 7, Idle: 3, Max: 30, Wait: 0},
		{Name: "sic_sso_DS", Kind: "jeus", Active: 5, Idle: 0, Max: 5, Wait: 2},
		{Name: "sic_DS", Kind: "jeus", Active: 99}, // 중복 레이블 세트는 버린다
		{Name: ""},
	}
	ss := NewBuilder().Build(ev)
	for name, want := range map[string]float64{"agent_t_jvm_conn_active": 12, "agent_t_jvm_conn_idle": 3,
		"agent_t_jvm_conn_max": 35, "agent_t_jvm_conn_wait": 2} {
		got := seriesByName(ss, name)
		if len(got) != 1 || got[0].Value != want {
			t.Fatalf("%s = %+v", name, got)
		}
		if labelOf(got[0], "host") != "h1" || labelOf(got[0], "system_name") != "shop" {
			t.Fatalf("%s missing base labels: %v", name, got[0].Labels)
		}
	}
	act := seriesByName(ss, "agent_t_db_pool_active")
	if len(act) != 2 {
		t.Fatalf("pool active series = %d", len(act))
	}
	for _, s := range act {
		if labelOf(s, "kind") != "jeus" || labelOf(s, "instance_role") != "primary" || labelOf(s, "display_name") != "Shop" {
			t.Fatalf("labels: %v", s.Labels)
		}
		if labelOf(s, "pool") == "sic_DS" && s.Value != 7 {
			t.Fatalf("dup should keep first: %v", s.Value)
		}
	}
	for _, n := range []string{"agent_t_db_pool_idle", "agent_t_db_pool_max", "agent_t_db_pool_wait"} {
		if len(seriesByName(ss, n)) != 2 {
			t.Fatalf("%s count", n)
		}
	}
}

func TestPoolSeriesAbsentAndCapped(t *testing.T) {
	ss := NewBuilder().Build(testEvent(0))
	for _, n := range []string{"agent_t_jvm_conn_active", "agent_t_jvm_conn_max", "agent_t_db_pool_active"} {
		if len(seriesByName(ss, n)) != 0 {
			t.Fatalf("%s should not exist without pool data", n)
		}
	}
	ev := testEvent(0)
	for i := 0; i < 100; i++ {
		ev.Jvm.Pools = append(ev.Jvm.Pools, protocol.PoolStat{Name: "p" + string(rune('a'+i%26)) + string(rune('a'+i/26)), Kind: "hikari"})
	}
	if got := len(seriesByName(NewBuilder().Build(ev), "agent_t_db_pool_max")); got != MaxPoolSeries {
		t.Fatalf("cap: %d", got)
	}
}
