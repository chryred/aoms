// Package store writes gateway rows to ClickHouse and manages dictionary/command state.
package store

import (
	"encoding/json"
	"strconv"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

const (
	tsLayout     = "2006-01-02 15:04:05.000" // DateTime64(3, 'UTC')
	expireLayout = "2006-01-02 15:04:05"     // DateTime('UTC')
)

func fmtTs(ms int64) string         { return time.UnixMilli(ms).UTC().Format(tsLayout) }
func fmtExpire(ms int64) string     { return time.UnixMilli(ms).UTC().Format(expireLayout) }
func fmtSeconds(t time.Time) string { return t.UTC().Format(expireLayout) }

// expireAt returns start (already skew-corrected, ms) + retention days as a DateTime string.
func expireAt(inst registry.Instance, correctedStartMs int64) string {
	days := inst.RetentionDays
	if days <= 0 {
		days = registry.DefaultRetentionDays
	}
	return fmtExpire(correctedStartMs + days*24*3600*1000)
}

// hexID converts a 16-hex FNV id into UInt64 (0 when malformed).
func hexID(h string) uint64 {
	v, err := strconv.ParseUint(h, 16, 64)
	if err != nil {
		return 0
	}
	return v
}

// clamp keeps agent-supplied values inside the unsigned ClickHouse column range.
func clamp(v, max int64) uint64 {
	if v < 0 {
		return 0
	}
	if v > max {
		return uint64(max)
	}
	return uint64(v)
}

const (
	max16 = 0xffff
	max32 = 0xffffffff
)

// validTx rejects rows whose FixedString ids would make ClickHouse reject the whole insert.
func validTx(t protocol.Tx) bool { return len(t.TraceID) == 32 && len(t.SpanID) == 16 }

func b2i(b bool) int {
	if b {
		return 1
	}
	return 0
}

func SummaryRow(inst registry.Instance, t protocol.Tx, offsetMs int64) map[string]any {
	start := t.StartTs + offsetMs
	return map[string]any{
		"system_id": inst.SystemID, "instance_role": inst.InstanceRole, "host": inst.Host,
		"start_ts": fmtTs(start), "trace_id": t.TraceID, "span_id": t.SpanID, "parent_span": t.ParentSpan,
		"uri_id": hexID(t.URIID), "method": t.Method, "status": clamp(int64(t.Status), max16),
		"error": b2i(t.Error), "exc_class": t.Exc,
		"elapsed_ms": clamp(t.ElapsedMs, max32), "cpu_ms": clamp(t.CPUMs, max32),
		"sql_ms": clamp(t.SQLMs, max32), "sql_cnt": clamp(t.SQLCnt, max32),
		"fetch_cnt": clamp(t.FetchCnt, max32), "fetch_ms": clamp(t.FetchMs, max32),
		"ext_ms": clamp(t.ExtMs, max32), "ext_cnt": clamp(t.ExtCnt, max16),
		"conn_open": clamp(t.ConnOpen, max16), "conn_close": clamp(t.ConnClose, max16),
		"conn_leak": clamp(t.ConnLeak, max16), "conn_uncommit": clamp(t.ConnUncommit, max16),
		"user_ip": t.UserIP, "user_id": t.UserID, "biz_key": t.BizKey,
		"has_detail": b2i(t.Detail != nil), "expire_at": expireAt(inst, start),
	}
}

func SqlRows(inst registry.Instance, t protocol.Tx, offsetMs int64) []map[string]any {
	start := t.StartTs + offsetMs
	out := make([]map[string]any, 0, len(t.SQL))
	for _, s := range t.SQL {
		out = append(out, map[string]any{
			"system_id": inst.SystemID, "start_ts": fmtTs(start), "trace_id": t.TraceID, "span_id": t.SpanID,
			"sql_id": hexID(s.SQLID), "cnt": clamp(s.Cnt, max32), "ms": clamp(s.Ms, max32),
			"max_ms": clamp(s.MaxMs, max32), "fetch_cnt": clamp(s.FetchCnt, max32),
			"fetch_ms": clamp(s.FetchMs, max32), "err": clamp(s.Err, max16),
			"db": truncRunes(s.DB, maxDBLen), "expire_at": expireAt(inst, start),
		})
	}
	return out
}

// DetailRow stores nodes/stacks as JSON text. Caller guarantees t.Detail != nil.
func DetailRow(inst registry.Instance, t protocol.Tx, offsetMs int64) map[string]any {
	start := t.StartTs + offsetMs
	nodes, stacks := t.Detail.Nodes, t.Detail.Stacks
	if nodes == nil {
		nodes = []protocol.Node{}
	}
	if stacks == nil {
		stacks = []protocol.Stack{}
	}
	nb, _ := json.Marshal(nodes)
	sb, _ := json.Marshal(stacks)
	return map[string]any{
		"system_id": inst.SystemID, "start_ts": fmtTs(start), "trace_id": t.TraceID, "span_id": t.SpanID,
		"nodes": string(nb), "stacks": string(sb), "params": paramsJSON(t.Detail.Params),
		"expire_at": expireAt(inst, start),
	}
}

const (
	maxParamPairs = 50
	maxParamName  = 64
	maxParamValue = 256
	maxParamQuery = 1024
)

// paramsJSON re-bounds the agent's masked params (the agent already caps; this guards the column against a
// misbehaving sender) and stores them as the {"q","p","t"} JSON text. "" = none.
func paramsJSON(p *protocol.Params) string {
	if p == nil || (p.Q == "" && len(p.P) == 0) {
		return ""
	}
	out := protocol.Params{Q: truncRunes(p.Q, maxParamQuery), P: make([][]string, 0, len(p.P)), T: p.T}
	for _, kv := range p.P {
		if len(kv) != 2 {
			continue
		}
		if len(out.P) >= maxParamPairs {
			out.T = true
			break
		}
		out.P = append(out.P, []string{truncRunes(kv[0], maxParamName), truncRunes(kv[1], maxParamValue)})
	}
	b, _ := json.Marshal(out)
	return string(b)
}

func DumpRow(inst registry.Instance, d protocol.Dump, offsetMs int64) map[string]any {
	ts := d.Ts + offsetMs
	return map[string]any{
		"system_id": inst.SystemID, "instance_role": inst.InstanceRole, "ts": fmtTs(ts),
		"cmd_id": clamp(d.CmdID, 1<<62), "text": d.Text, "truncated": b2i(d.Truncated),
		"expire_at": expireAt(inst, ts),
	}
}

const maxDBLen = 128

// truncRunes caps s at n runes (the agent already caps; this guards the column against a misbehaving sender).
func truncRunes(s string, n int) string {
	if len(s) <= n {
		return s
	}
	r := []rune(s)
	if len(r) <= n {
		return s
	}
	return string(r[:n])
}
