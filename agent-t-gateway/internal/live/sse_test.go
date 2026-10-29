package live

import (
	"bufio"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func newAPI() (*API, *State) {
	hub := NewHub()
	st := NewState(hub)
	return &API{State: st, Hub: hub, Secret: testSecret, Ping: time.Hour}, st
}

func TestSseRequiresJWT(t *testing.T) {
	api, _ := newAPI()
	srv := httptest.NewServer(http.HandlerFunc(api.Stream))
	defer srv.Close()
	get := func(tok string) *http.Response {
		req, _ := http.NewRequestWithContext(context.Background(), "GET", srv.URL, nil)
		if tok != "" {
			req.Header.Set("Authorization", "Bearer "+tok)
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		return resp
	}
	if r := get(""); r.StatusCode != 401 {
		t.Fatalf("no token: %d", r.StatusCode)
	}
	if r := get(mkToken(testSecret, "HS256", "access", time.Now().Add(-time.Minute))); r.StatusCode != 401 {
		t.Fatalf("expired: %d", r.StatusCode)
	}
	r := get(mkToken(testSecret, "HS256", "access", time.Now().Add(time.Hour)))
	defer r.Body.Close()
	if r.StatusCode != 200 || r.Header.Get("Content-Type") != "text/event-stream" || r.Header.Get("X-Accel-Buffering") != "no" {
		t.Fatalf("status=%d hdr=%v", r.StatusCode, r.Header)
	}
	line, _ := bufio.NewReader(r.Body).ReadString('\n')
	if strings.TrimSpace(line) != "event: ping" {
		t.Fatalf("first line %q", line)
	}
}

func TestStreamDeliversEventsFiltered(t *testing.T) {
	api, st := newAPI()
	srv := httptest.NewServer(http.HandlerFunc(api.Stream))
	defer srv.Close()
	req, _ := http.NewRequest("GET", srv.URL+"?system_ids=7", nil)
	req.Header.Set("Authorization", "Bearer "+mkToken(testSecret, "HS256", "access", time.Now().Add(time.Hour)))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	rd := bufio.NewReader(resp.Body)
	rd.ReadString('\n') // event: ping
	rd.ReadString('\n')
	rd.ReadString('\n')
	other := testInst
	other.AgentID, other.SystemID = 2, 8
	st.Accept(other, batchWith(1, 0, 0), 0)
	st.Accept(testInst, batchWith(1, 0, 0), 0)
	line, _ := rd.ReadString('\n')
	if strings.TrimSpace(line) != "event: active" {
		t.Fatalf("got %q", line)
	}
	data, _ := rd.ReadString('\n')
	if !strings.Contains(data, `"system_id":7`) {
		t.Fatalf("filter leaked: %s", data)
	}
}

func TestSnapshotShape(t *testing.T) {
	api, st := newAPI()
	st.Accept(testInst, batchWith(3, 0, 0), 0)
	st.Aggregate()
	st.Accept(testInst, batchWith(3, 0, 0), 0)
	st.Aggregate()

	rec := httptest.NewRecorder()
	req := httptest.NewRequest("GET", "/t/v1/snapshot?system_ids=7", nil)
	req.Header.Set("Authorization", "Bearer "+mkToken(testSecret, "HS256", "access", time.Now().Add(time.Hour)))
	api.Snapshot(rec, req)
	if rec.Code != 200 {
		t.Fatalf("code %d", rec.Code)
	}
	var out struct {
		Instances []struct {
			LastSeen int64 `json:"last_seen"`
			Active   struct {
				Buckets []int64 `json:"buckets"`
			} `json:"active"`
			Agg []json.RawMessage `json:"agg"`
		} `json:"instances"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if len(out.Instances) != 1 || len(out.Instances[0].Active.Buckets) != 3 || len(out.Instances[0].Agg) != 2 || out.Instances[0].LastSeen == 0 {
		t.Fatalf("%s", rec.Body.String())
	}
	// unauthenticated
	rec = httptest.NewRecorder()
	api.Snapshot(rec, httptest.NewRequest("GET", "/t/v1/snapshot", nil))
	if rec.Code != 401 {
		t.Fatalf("code %d", rec.Code)
	}
	// filtered out
	rec = httptest.NewRecorder()
	req = httptest.NewRequest("GET", "/t/v1/snapshot?system_ids=99", nil)
	req.Header.Set("Authorization", "Bearer "+mkToken(testSecret, "HS256", "access", time.Now().Add(time.Hour)))
	api.Snapshot(rec, req)
	if !strings.Contains(rec.Body.String(), `"instances":[]`) {
		t.Fatalf("%s", rec.Body.String())
	}
}

func TestRingCapped(t *testing.T) {
	_, st := newAPI()
	for i := 0; i < RingSize+5; i++ {
		st.Accept(testInst, batchWith(1, 0, 0), 0)
		st.Aggregate()
	}
	if n := len(st.insts[1].ring); n != RingSize {
		t.Fatalf("ring=%d", n)
	}
}

func TestInvalidSystemIDsRejected(t *testing.T) {
	api, _ := newAPI()
	tok := "Bearer " + mkToken(testSecret, "HS256", "access", time.Now().Add(time.Hour))
	for _, h := range []func(http.ResponseWriter, *http.Request){api.Snapshot, api.Stream} {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest("GET", "/t/v1/x?system_ids=7,abc", nil)
		req.Header.Set("Authorization", tok)
		h(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("code %d", rec.Code)
		}
	}
}
