// Package protocol holds the Agent-T batch wire contract (contracts/agent-t/protocol.md).
package protocol

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// MaxBodyBytes caps the (decompressed) request body.
const MaxBodyBytes = 32 << 20

type Batch struct {
	V       int       `json:"v"`
	Seq     int64     `json:"seq"`
	Ts      int64     `json:"ts"`
	CfgV    int64     `json:"cfg_v"`
	Agent   AgentInfo `json:"agent"`
	Active  Active    `json:"active"`
	Tx      []Tx      `json:"tx"`
	Dict    Dict      `json:"dict"`
	JVM     *JVM      `json:"jvm"`
	Dumps   []Dump    `json:"dumps"`
	Dropped Dropped   `json:"dropped"`
}

type AgentInfo struct {
	Version string `json:"version"`
	JVM     string `json:"jvm"`
	Pid     int64  `json:"pid"`
	Host    string `json:"host"`
	StartTs int64  `json:"start_ts"`
}

type Active struct {
	Buckets [3]int64    `json:"buckets"`
	Top     []ActiveTop `json:"top"`
}

type ActiveTop struct {
	TraceID string   `json:"trace_id"`
	SpanID  string   `json:"span_id"`
	Thread  string   `json:"thread"`
	URIID   string   `json:"uri_id"`
	StartTs int64    `json:"start_ts"`
	Phase   string   `json:"phase"`
	SQLID   *string  `json:"sql_id"`
	Stack   []string `json:"stack"`
}

type Tx struct {
	TraceID      string  `json:"trace_id"`
	SpanID       string  `json:"span_id"`
	ParentSpan   string  `json:"parent_span"`
	StartTs      int64   `json:"start_ts"`
	ElapsedMs    int64   `json:"elapsed_ms"`
	Method       string  `json:"method"`
	URIID        string  `json:"uri_id"`
	Status       int     `json:"status"`
	Error        bool    `json:"error"`
	Exc          string  `json:"exc"`
	CPUMs        int64   `json:"cpu_ms"`
	SQLMs        int64   `json:"sql_ms"`
	SQLCnt       int64   `json:"sql_cnt"`
	FetchCnt     int64   `json:"fetch_cnt"`
	FetchMs      int64   `json:"fetch_ms"`
	ExtMs        int64   `json:"ext_ms"`
	ExtCnt       int64   `json:"ext_cnt"`
	ConnOpen     int64   `json:"conn_open"`
	ConnClose    int64   `json:"conn_close"`
	ConnLeak     int64   `json:"conn_leak"`
	ConnUncommit int64   `json:"conn_uncommit"`
	UserIP       string  `json:"user_ip"`
	UserID       string  `json:"user_id"`
	BizKey       string  `json:"biz_key"`
	SQL          []TxSQL `json:"sql"`
	Detail       *Detail `json:"detail"`
}

type TxSQL struct {
	SQLID    string `json:"sql_id"`
	Cnt      int64  `json:"cnt"`
	Ms       int64  `json:"ms"`
	MaxMs    int64  `json:"max_ms"`
	FetchCnt int64  `json:"fetch_cnt"`
	FetchMs  int64  `json:"fetch_ms"`
	Err      int64  `json:"err"`
	// DB is the optional short DB connection name (host:port/db); absent in older agents -> "".
	DB string `json:"db"`
}

type Detail struct {
	Nodes  []Node  `json:"nodes"`
	Stacks []Stack `json:"stacks"`
	// Params is the optional masked request-parameter capture (agent opt-in); absent in older agents.
	Params *Params `json:"params,omitempty"`
}

// Params: q = masked query string, p = [name, value] pairs, t = agent truncated it.
type Params struct {
	Q string     `json:"q"`
	P [][]string `json:"p"`
	T bool       `json:"t"`
}

type Node struct {
	I     int    `json:"i"`
	P     int    `json:"p"`
	K     string `json:"k"`
	N     string `json:"n"`
	S     int64  `json:"s"`
	D     int64  `json:"d"`
	SQLID string `json:"sql_id"`
}

type Stack struct {
	F []string `json:"f"`
	C int64    `json:"c"`
}

type Dict struct {
	SQL map[string]string `json:"sql"`
	URI map[string]string `json:"uri"`
}

type JVM struct {
	Ts          int64   `json:"ts"`
	HeapUsed    int64   `json:"heap_used"`
	HeapMax     int64   `json:"heap_max"`
	NonheapUsed int64   `json:"nonheap_used"`
	GCCount     int64   `json:"gc_count"`
	GCMs        int64   `json:"gc_ms"`
	Threads     int64   `json:"threads"`
	CPURatio    float64 `json:"cpu_ratio"`
	Classes     int64   `json:"classes"`
	// Optional DB connection pool metrics (older agents / no pool found: absent -> nil).
	// Sums over Pools; pointers keep "absent" distinct from a real 0.
	ConnActive *int64     `json:"conn_active,omitempty"`
	ConnIdle   *int64     `json:"conn_idle,omitempty"`
	ConnMax    *int64     `json:"conn_max,omitempty"`
	ConnWait   *int64     `json:"conn_wait,omitempty"`
	ConnPeak   *int64     `json:"conn_peak,omitempty"` // sum of per-pool peaks: max active within the agent's last 5s window
	Pools      []PoolStat `json:"pools,omitempty"`
}

// PoolStat is one DB connection pool. Kind: jeus | hikari | tomcat | dbcp2. Max <= 0 means unknown/unbounded.
type PoolStat struct {
	Name   string `json:"name"`
	Kind   string `json:"kind"`
	Active int64  `json:"active"`
	Idle   int64  `json:"idle"`
	Max    int64  `json:"max"`
	Wait   int64  `json:"wait"`
	Peak   *int64 `json:"peak,omitempty"` // max active within the last 5s window (nil = old agent)
}

type Dump struct {
	CmdID     int64  `json:"cmd_id"`
	Ts        int64  `json:"ts"`
	Text      string `json:"text"`
	Truncated bool   `json:"truncated"`
}

type Dropped struct {
	Detail int64 `json:"detail"`
	SQL    int64 `json:"sql"`
	Tx     int64 `json:"tx"`
}

// Response types (200 body).

type Command struct {
	ID   int64  `json:"id"`
	Type string `json:"type"`
}

type Config struct {
	Version          int64    `json:"version"`
	Enabled          bool     `json:"enabled"`
	SlowMs           int64    `json:"slow_ms"`
	NormalDetailRate float64  `json:"normal_detail_rate"`
	StackIntervalMs  int64    `json:"stack_interval_ms"`
	Exclude          []string `json:"exclude"`
	URIRules         []string `json:"uri_rules"`
	LogLevel         string   `json:"log_level"`
}

type NeedDict struct {
	SQL []string `json:"sql"`
	URI []string `json:"uri"`
}

type Response struct {
	Config    *Config   `json:"config,omitempty"`
	Commands  []Command `json:"commands"`
	NeedDict  NeedDict  `json:"need_dict"`
	BackoffMs int       `json:"backoff_ms"`
}

var ErrSchema = errors.New("invalid batch")

// Decode reads a batch, optionally gzip-compressed. The decompressed size is capped at MaxBodyBytes.
func Decode(r io.Reader, isGzip bool) (*Batch, error) {
	if isGzip {
		zr, err := gzip.NewReader(r)
		if err != nil {
			return nil, fmt.Errorf("%w: gzip: %v", ErrSchema, err)
		}
		defer zr.Close()
		r = zr
	}
	lr := &io.LimitedReader{R: r, N: MaxBodyBytes + 1}
	var b Batch
	if err := json.NewDecoder(lr).Decode(&b); err != nil {
		if lr.N <= 0 {
			return nil, fmt.Errorf("%w: body exceeds %d bytes", ErrSchema, MaxBodyBytes)
		}
		return nil, fmt.Errorf("%w: %v", ErrSchema, err)
	}
	if lr.N <= 0 {
		return nil, fmt.Errorf("%w: body exceeds %d bytes", ErrSchema, MaxBodyBytes)
	}
	if b.V != 1 {
		return nil, fmt.Errorf("%w: unsupported v=%d", ErrSchema, b.V)
	}
	return &b, nil
}
