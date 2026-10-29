// Package ingest serves POST /t/v1/batch.
package ingest

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

// Interfaces implemented by later tasks (B2 sink/backpressure, B3 commands/dict).
type Sink interface {
	Accept(inst registry.Instance, b *protocol.Batch, offsetMs int64)
}
type CommandSource interface {
	Pending(agentID int64) []protocol.Command
	Done(cmdID int64, ok bool)
}
type DictCache interface {
	Missing(kind string, ids []string) []string
	Put(kind, id, text string)
}
type Backpressure interface {
	BackoffMs() int
}
type Lookuper interface {
	Lookup(tokenSHA256 string) (registry.Instance, bool)
}

type Handler struct {
	Registry Lookuper
	Sink     Sink
	Commands CommandSource
	Dict     DictCache
	Back     Backpressure
	Skew     *Skew
	Now      func() time.Time // injectable for tests
}

func (h *Handler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	token := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
	if token == "" || token == r.Header.Get("Authorization") {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	sum := sha256.Sum256([]byte(token))
	inst, ok := h.Registry.Lookup(hex.EncodeToString(sum[:]))
	if !ok {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return
	}
	if ms := h.Back.BackoffMs(); ms > 0 {
		writeJSON(w, http.StatusTooManyRequests, map[string]int{"backoff_ms": ms})
		return
	}
	isGzip := strings.EqualFold(r.Header.Get("Content-Encoding"), "gzip")
	b, err := protocol.Decode(http.MaxBytesReader(w, r.Body, protocol.MaxBodyBytes), isGzip)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	now := h.Now().UnixMilli()
	offset := h.Skew.Correct(strconv.FormatInt(inst.AgentID, 10), b.Ts, now)

	for id, text := range b.Dict.SQL {
		h.Dict.Put("sql", id, text)
	}
	for id, text := range b.Dict.URI {
		h.Dict.Put("uri", id, text)
	}
	h.Sink.Accept(inst, b, offset)

	resp := protocol.Response{
		Commands: h.Commands.Pending(inst.AgentID),
		NeedDict: protocol.NeedDict{
			SQL: nonNil(h.Dict.Missing("sql", referencedSQL(b))),
			URI: nonNil(h.Dict.Missing("uri", referencedURI(b))),
		},
		BackoffMs: h.Back.BackoffMs(),
	}
	if resp.Commands == nil {
		resp.Commands = []protocol.Command{}
	}
	if b.CfgV != inst.ConfigVersion {
		resp.Config = &protocol.Config{
			Version: inst.ConfigVersion, Enabled: inst.Enabled, SlowMs: inst.SlowMs,
			NormalDetailRate: 0.01, StackIntervalMs: 1000,
			Exclude: []string{}, URIRules: []string{}, LogLevel: "info",
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

func referencedURI(b *protocol.Batch) []string {
	set := map[string]struct{}{}
	for _, t := range b.Tx {
		set[t.URIID] = struct{}{}
	}
	for _, t := range b.Active.Top {
		set[t.URIID] = struct{}{}
	}
	return keys(set)
}

func referencedSQL(b *protocol.Batch) []string {
	set := map[string]struct{}{}
	for _, t := range b.Tx {
		for _, s := range t.SQL {
			set[s.SQLID] = struct{}{}
		}
	}
	for _, t := range b.Active.Top {
		if t.SQLID != nil {
			set[*t.SQLID] = struct{}{}
		}
	}
	return keys(set)
}

func keys(m map[string]struct{}) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		if k != "" {
			out = append(out, k)
		}
	}
	return out
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
