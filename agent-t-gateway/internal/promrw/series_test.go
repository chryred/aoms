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
