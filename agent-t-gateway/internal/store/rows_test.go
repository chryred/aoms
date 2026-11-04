package store

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

func TestExpireAtUsesRetention(t *testing.T) {
	inst := registry.Instance{SystemID: 1, RetentionDays: 7}
	start := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC).UnixMilli()
	row := SummaryRow(inst, protocol.Tx{TraceID: tid, SpanID: sid, StartTs: start}, 0)
	if got := row["expire_at"]; got != "2026-11-06 00:00:00" {
		t.Fatalf("expire_at=%v", got)
	}
	if got := row["start_ts"]; got != "2026-10-30 00:00:00.000" {
		t.Fatalf("start_ts=%v", got)
	}
}

func TestExpireAtUsesCorrectedStart(t *testing.T) {
	inst := registry.Instance{SystemID: 1, RetentionDays: 7}
	start := time.Date(2026, 10, 30, 0, 0, 0, 0, time.UTC).UnixMilli()
	// agent clock 1 day behind: offset +24h.
	row := SummaryRow(inst, protocol.Tx{TraceID: tid, SpanID: sid, StartTs: start}, 24*3600*1000)
	if row["expire_at"] != "2026-11-07 00:00:00" || row["start_ts"] != "2026-10-31 00:00:00.000" {
		t.Fatalf("row=%v", row)
	}
}

func TestHexToUInt64AndClamp(t *testing.T) {
	inst := registry.Instance{SystemID: 5, RetentionDays: 7, InstanceRole: "was1", Host: "h"}
	tx := protocol.Tx{TraceID: tid, SpanID: sid, URIID: "ffffffffffffffff", ElapsedMs: -5, ExtCnt: 1 << 20,
		Detail: &protocol.Detail{}}
	row := SummaryRow(inst, tx, 0)
	if row["uri_id"] != uint64(0xffffffffffffffff) {
		t.Fatalf("uri_id=%v", row["uri_id"])
	}
	if row["elapsed_ms"] != uint64(0) || row["ext_cnt"] != uint64(65535) {
		t.Fatalf("clamp: %v %v", row["elapsed_ms"], row["ext_cnt"])
	}
	if row["has_detail"] != 1 || row["system_id"] != int64(5) {
		t.Fatalf("row=%v", row)
	}
}

func TestSqlRowsAndDetailRow(t *testing.T) {
	inst := registry.Instance{SystemID: 5, RetentionDays: 7}
	tx := protocol.Tx{TraceID: tid, SpanID: sid, StartTs: 1761800000000,
		SQL:    []protocol.TxSQL{{SQLID: "1122334455667788", Cnt: 2, Ms: 30, DB: "10.103.1.61:1433/stap"}, {SQLID: "1122334455667788", Cnt: 1}},
		Detail: &protocol.Detail{Nodes: []protocol.Node{{I: 0, P: -1, K: "http", N: "GET /x"}}}}
	rows := SqlRows(inst, tx, 0)
	if len(rows) != 2 || rows[0]["db"] != "10.103.1.61:1433/stap" || rows[1]["db"] != "" {
		t.Fatalf("db column: %v", rows)
	}
	if got := truncRunes(strings.Repeat("가", 200), maxDBLen); len([]rune(got)) != maxDBLen {
		t.Fatalf("truncRunes len=%d", len([]rune(got)))
	}
	if len(rows) != 2 || rows[0]["sql_id"] != uint64(0x1122334455667788) || rows[0]["cnt"] != uint64(2) {
		t.Fatalf("rows=%v", rows)
	}
	d := DetailRow(inst, tx, 0)
	if d["nodes"] == "" || d["stacks"] != "[]" {
		t.Fatalf("detail=%v", d)
	}
}

func TestDetailRowParams(t *testing.T) {
	inst := registry.Instance{SystemID: 5, RetentionDays: 7}
	tx := protocol.Tx{TraceID: tid, SpanID: sid, StartTs: 1761800000000, Detail: &protocol.Detail{}}
	if d := DetailRow(inst, tx, 0); d["params"] != "" {
		t.Fatalf("absent params must be empty string: %v", d["params"])
	}
	tx.Detail.Params = &protocol.Params{Q: "a=1", P: [][]string{{"a", "1"}, {"bad"}, {"pw", "****"}}}
	if d := DetailRow(inst, tx, 0); d["params"] != `{"q":"a=1","p":[["a","1"],["pw","****"]],"t":false}` {
		t.Fatalf("params=%v", d["params"])
	}
	long := &protocol.Params{Q: strings.Repeat("q", 2000), P: [][]string{{"k", strings.Repeat("가", 400)}}}
	for i := 0; i < 60; i++ {
		long.P = append(long.P, []string{"n", "v"})
	}
	got := paramsJSON(long)
	var back protocol.Params
	if err := json.Unmarshal([]byte(got), &back); err != nil {
		t.Fatal(err)
	}
	if len(back.P) != maxParamPairs || !back.T || len([]rune(back.Q)) != maxParamQuery || len([]rune(back.P[0][1])) != maxParamValue {
		t.Fatalf("bounds: pairs=%d t=%v q=%d v=%d", len(back.P), back.T, len([]rune(back.Q)), len([]rune(back.P[0][1])))
	}
}

func TestValidIDs(t *testing.T) {
	if validTx(protocol.Tx{TraceID: "short", SpanID: sid}) {
		t.Fatal("short trace id must be invalid")
	}
	if !validTx(protocol.Tx{TraceID: tid, SpanID: sid}) {
		t.Fatal("valid tx rejected")
	}
}

const (
	tid = "0123456789abcdef0123456789abcdef"
	sid = "0123456789abcdef"
)
