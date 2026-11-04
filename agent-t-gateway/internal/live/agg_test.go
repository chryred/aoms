package live

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
)

func TestAggWindow(t *testing.T) {
	s := NewState(nil)
	s.Accept(testInst, batchWith(50, 5, 2), 0)
	evs := s.Aggregate()
	if len(evs) != 1 {
		t.Fatalf("events=%d", len(evs))
	}
	e := evs[0]
	if e.Tps != 10 || e.ErrRate != 0.1 || e.SlowCnt != 2 {
		t.Fatalf("tps=%v err=%v slow=%v", e.Tps, e.ErrRate, e.SlowCnt)
	}
	if e.Counters.TxTotal != 50 || e.Counters.ErrTotal != 5 || e.Counters.SlowTotal != 2 {
		t.Fatalf("counters=%+v", e.Counters)
	}
	// next window starts empty but counters stay cumulative
	s.Accept(testInst, batchWith(10, 0, 0), 0)
	e = s.Aggregate()[0]
	if e.Tps != 2 || e.Counters.TxTotal != 60 {
		t.Fatalf("second window tps=%v total=%d", e.Tps, e.Counters.TxTotal)
	}
}

func TestUriTopCardinality(t *testing.T) {
	s := NewState(nil)
	b := &protocol.Batch{V: 1}
	for i := 0; i < 500; i++ {
		b.Tx = append(b.Tx, protocol.Tx{URIID: fmt.Sprintf("u%d", i), ElapsedMs: 10})
	}
	s.Accept(testInst, b, 0)
	e := s.Aggregate()[0]
	if n := len(e.Counters.UriTotals); n != 201 {
		t.Fatalf("UriTotals keys=%d want 201", n)
	}
	if e.Counters.UriTotals[OtherURI].Cnt != 300 {
		t.Fatalf("_other=%v", e.Counters.UriTotals[OtherURI])
	}
	if len(e.UriTop) != 10 {
		t.Fatalf("uri_top=%d", len(e.UriTop))
	}
}

func TestDictResolutionAndTop(t *testing.T) {
	s := NewState(nil)
	b := &protocol.Batch{V: 1, Dict: protocol.Dict{URI: map[string]string{"u1": "/order/list"}, SQL: map[string]string{"q1": "select 1"}}}
	b.Tx = []protocol.Tx{{URIID: "u1", ElapsedMs: 20, SQL: []protocol.TxSQL{{SQLID: "q1", Cnt: 2, Ms: 8}}}}
	s.Accept(testInst, b, 0)
	e := s.Aggregate()[0]
	if e.UriTop[0].Name != "/order/list" || e.SqlTop[0].Name != "select 1" || e.SqlTop[0].Cnt != 2 || e.SqlTop[0].Ms != 8 {
		t.Fatalf("uri=%+v sql=%+v", e.UriTop, e.SqlTop)
	}
}

func TestSamplerPrioritisesSlowAndError(t *testing.T) {
	s := NewState(nil)
	s.Now = func() time.Time { return time.UnixMilli(5_000_000) }
	hub := NewHub()
	s.Hub = hub
	sub := hub.Subscribe(nil)
	b := batchWith(1000, 0, 10) // 10 slow, 990 normal
	s.Accept(testInst, b, 0)
	var n, slow int
	for len(sub.C) > 0 {
		ev := <-sub.C
		if ev.Name != "points" {
			continue
		}
		var p pointsPayload
		if err := jsonUnmarshal(ev.Data, &p); err != nil {
			t.Fatal(err)
		}
		for _, pt := range p.Points {
			n++
			if pt.ElapsedMs >= 3000 {
				slow++
			}
		}
	}
	if n != MaxPointsPerSec || slow != 10 {
		t.Fatalf("points=%d slow=%d", n, slow)
	}
	// same wall-second: budget exhausted
	s.Accept(testInst, batchWith(100, 0, 0), 0)
	for len(sub.C) > 0 {
		if (<-sub.C).Name == "points" {
			t.Fatal("points emitted beyond per-second budget")
		}
	}
}

func TestJvmPoolFieldsReachAggEventAndSSEJSON(t *testing.T) {
	s := NewState(nil)
	a, i, m, w := int64(7), int64(3), int64(30), int64(0)
	b := &protocol.Batch{V: 1, JVM: &protocol.JVM{Ts: 1, ConnActive: &a, ConnIdle: &i, ConnMax: &m, ConnWait: &w,
		Pools: []protocol.PoolStat{{Name: "sic_DS", Kind: "jeus", Active: 7, Idle: 3, Max: 30}}}}
	s.Accept(testInst, b, 0)
	ev := s.Aggregate()[0]
	if ev.Jvm == nil || ev.Jvm.ConnActive == nil || *ev.Jvm.ConnActive != 7 || len(ev.Jvm.Pools) != 1 {
		t.Fatalf("jvm lost pool fields: %+v", ev.Jvm)
	}
	out, err := json.Marshal(aggPayload{Jvm: ev.Jvm})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{`"conn_active":7`, `"conn_wait":0`, `"pools":[{"name":"sic_DS","kind":"jeus","active":7,"idle":3,"max":30,"wait":0}]`} {
		if !strings.Contains(string(out), want) {
			t.Fatalf("missing %s in %s", want, out)
		}
	}
}
