package ingest

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

const token = "secret-token"

type fakeReg struct{ inst registry.Instance }

func (f fakeReg) Lookup(h string) (registry.Instance, bool) {
	s := sha256.Sum256([]byte(token))
	if h == hex.EncodeToString(s[:]) {
		return f.inst, true
	}
	return registry.Instance{}, false
}

type recSink struct {
	n      int
	offset int64
}

func (s *recSink) Accept(_ registry.Instance, _ *protocol.Batch, off int64) { s.n++; s.offset = off }

type fakeCmds struct{}

func (fakeCmds) Pending(int64) []protocol.Command {
	return []protocol.Command{{ID: 7, Type: "thread_dump"}}
}
func (fakeCmds) Done(int64, bool) {}

type fakeDict struct{ known map[string]bool }

func (d fakeDict) Missing(kind string, ids []string) []string {
	var out []string
	for _, id := range ids {
		if !d.known[kind+":"+id] {
			out = append(out, id)
		}
	}
	return out
}
func (d fakeDict) Put(kind, id, _ string) { d.known[kind+":"+id] = true }

type fakeBack int

func (f fakeBack) BackoffMs() int { return int(f) }

func newHandler(inst registry.Instance, back int, now time.Time) (*Handler, *recSink) {
	sink := &recSink{}
	return &Handler{
		Registry: fakeReg{inst}, Sink: sink, Commands: fakeCmds{},
		Dict: fakeDict{known: map[string]bool{}}, Back: fakeBack(back), Skew: NewSkew(),
		Now: func() time.Time { return now },
	}, sink
}

func sampleBody(t *testing.T, mutate func(map[string]any)) []byte {
	raw, err := os.ReadFile("../../../contracts/agent-t/batch-v1.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	var m map[string]any
	json.Unmarshal(raw, &m)
	if mutate != nil {
		mutate(m)
	}
	out, _ := json.Marshal(m)
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	w.Write(out)
	w.Close()
	return buf.Bytes()
}

func post(h http.Handler, tok string, body []byte) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodPost, "/t/v1/batch", bytes.NewReader(body))
	req.Header.Set("Content-Encoding", "gzip")
	if tok != "" {
		req.Header.Set("Authorization", "Bearer "+tok)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

var inst = registry.Instance{AgentID: 5, SystemName: "ORDER", Enabled: true, SlowMs: 3000, ConfigVersion: 5}

func nowFor(ts int64) time.Time { return time.UnixMilli(ts) }

func TestUnauthorized(t *testing.T) {
	h, sink := newHandler(inst, 0, nowFor(1761800000000))
	if rec := post(h, "wrong", sampleBody(t, nil)); rec.Code != 401 {
		t.Fatalf("code=%d", rec.Code)
	}
	if rec := post(h, "", sampleBody(t, nil)); rec.Code != 401 {
		t.Fatalf("no header code=%d", rec.Code)
	}
	if sink.n != 0 {
		t.Fatal("sink called")
	}
}

func TestBadBody400(t *testing.T) {
	h, _ := newHandler(inst, 0, nowFor(1761800000000))
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	w.Write([]byte("{bad"))
	w.Close()
	if rec := post(h, token, buf.Bytes()); rec.Code != 400 {
		t.Fatalf("code=%d", rec.Code)
	}
}

func TestConfigOmittedWhenSameVersion(t *testing.T) {
	h, sink := newHandler(inst, 0, nowFor(1761800000000))
	rec := post(h, token, sampleBody(t, func(m map[string]any) { m["cfg_v"] = 5 }))
	if rec.Code != 200 {
		t.Fatalf("code=%d %s", rec.Code, rec.Body)
	}
	var m map[string]json.RawMessage
	json.Unmarshal(rec.Body.Bytes(), &m)
	if _, ok := m["config"]; ok {
		t.Fatal("config should be omitted")
	}
	if sink.n != 1 {
		t.Fatal("sink not called")
	}
	var r protocol.Response
	json.Unmarshal(rec.Body.Bytes(), &r)
	if len(r.Commands) != 1 || r.Commands[0].ID != 7 {
		t.Fatalf("commands=%+v", r.Commands)
	}

	rec = post(h, token, sampleBody(t, func(m map[string]any) { m["cfg_v"] = 4 }))
	var r2 struct {
		Config map[string]any `json:"config"`
	}
	json.Unmarshal(rec.Body.Bytes(), &r2)
	if r2.Config == nil || r2.Config["slow_ms"].(float64) != 3000 || r2.Config["version"].(float64) != 5 {
		t.Fatalf("config=%v", r2.Config)
	}
}

func TestNeedDictOnlyForUnknownIDs(t *testing.T) {
	h, _ := newHandler(inst, 0, nowFor(1761800000000))
	// sample dict carries 4 sql ids and 3 uri ids, all referenced ones are supplied -> none missing
	rec := post(h, token, sampleBody(t, nil))
	var r protocol.Response
	json.Unmarshal(rec.Body.Bytes(), &r)
	if len(r.NeedDict.SQL) != 0 || len(r.NeedDict.URI) != 0 {
		t.Fatalf("need_dict=%+v", r.NeedDict)
	}
	// drop dict -> referenced ids are requested
	h2, _ := newHandler(inst, 0, nowFor(1761800000000))
	rec = post(h2, token, sampleBody(t, func(m map[string]any) { m["dict"] = map[string]any{"sql": map[string]any{}, "uri": map[string]any{}} }))
	json.Unmarshal(rec.Body.Bytes(), &r)
	if len(r.NeedDict.SQL) != 4 || len(r.NeedDict.URI) != 3 {
		t.Fatalf("need_dict=%+v", r.NeedDict)
	}
}

func TestBackpressure429(t *testing.T) {
	h, sink := newHandler(inst, 3000, nowFor(1761800000000))
	rec := post(h, token, sampleBody(t, nil))
	if rec.Code != 429 || bytes.TrimSpace(rec.Body.Bytes()) == nil {
		t.Fatalf("code=%d", rec.Code)
	}
	var m map[string]int
	json.Unmarshal(rec.Body.Bytes(), &m)
	if m["backoff_ms"] != 3000 || sink.n != 0 {
		t.Fatalf("body=%s sink=%d", rec.Body, sink.n)
	}
}

func TestSkewPassedToSink(t *testing.T) {
	h, sink := newHandler(inst, 0, nowFor(1761800000000-300000))
	post(h, token, sampleBody(t, nil))
	if sink.offset != -300000 {
		t.Fatalf("offset=%d", sink.offset)
	}
}

func TestDisabledInstanceGetsEnabledFalse(t *testing.T) {
	st := &stubStore{}
	reg := registry.New(st)
	st.rows = []registry.Row{{AgentID: 5, TokenSHA256: sha(token), SystemName: "S"}}
	reg.Refresh(t.Context())
	before, _ := reg.Lookup(sha(token))
	st.rows[0].EnabledLabel = "false"
	reg.Refresh(t.Context())
	after, _ := reg.Lookup(sha(token))
	if after.Enabled || after.ConfigVersion == before.ConfigVersion {
		t.Fatalf("before=%+v after=%+v", before, after)
	}
	sink := &recSink{}
	h := &Handler{Registry: reg, Sink: sink, Commands: fakeCmds{}, Dict: fakeDict{known: map[string]bool{}},
		Back: fakeBack(0), Skew: NewSkew(), Now: func() time.Time { return nowFor(1761800000000) }}
	rec := post(h, token, sampleBody(t, func(m map[string]any) { m["cfg_v"] = before.ConfigVersion }))
	var r struct {
		Config struct {
			Enabled bool  `json:"enabled"`
			Version int64 `json:"version"`
		} `json:"config"`
	}
	json.Unmarshal(rec.Body.Bytes(), &r)
	if r.Config.Enabled || r.Config.Version != after.ConfigVersion {
		t.Fatalf("resp=%s", rec.Body)
	}
}

type stubStore struct{ rows []registry.Row }

func (s *stubStore) Load(_ context.Context) ([]registry.Row, error) { return s.rows, nil }

func sha(s string) string {
	x := sha256.Sum256([]byte(s))
	return hex.EncodeToString(x[:])
}
