package live

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const PingInterval = 15 * time.Second

// API serves GET /t/v1/stream and GET /t/v1/snapshot behind the admin-api user JWT.
type API struct {
	State  *State
	Hub    *Hub
	Secret []byte
	Ping   time.Duration // defaults to PingInterval
	Now    func() time.Time
}

func (a *API) authorized(w http.ResponseWriter, r *http.Request) bool {
	h := r.Header.Get("Authorization")
	tok := strings.TrimPrefix(h, "Bearer ")
	now := time.Now
	if a.Now != nil {
		now = a.Now
	}
	if tok == "" || tok == h || VerifyJWT(tok, a.Secret, now()) != nil {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
		return false
	}
	return true
}

func parseSystemIDs(r *http.Request) []int64 {
	var ids []int64
	for _, p := range strings.Split(r.URL.Query().Get("system_ids"), ",") {
		if id, err := strconv.ParseInt(strings.TrimSpace(p), 10, 64); err == nil {
			ids = append(ids, id)
		}
	}
	return ids
}

func (a *API) Snapshot(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(w, r) {
		return
	}
	set := map[int64]bool{}
	for _, id := range parseSystemIDs(r) {
		set[id] = true
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-cache")
	_ = json.NewEncoder(w).Encode(a.State.Snapshot(set))
}

func (a *API) Stream(w http.ResponseWriter, r *http.Request) {
	if !a.authorized(w, r) {
		return
	}
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	h := w.Header()
	h.Set("Content-Type", "text/event-stream")
	h.Set("Cache-Control", "no-cache")
	h.Set("X-Accel-Buffering", "no")
	sub := a.Hub.Subscribe(parseSystemIDs(r))
	defer a.Hub.Unsubscribe(sub)

	write := func(name string, data []byte) bool {
		if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", name, data); err != nil {
			return false
		}
		fl.Flush()
		return true
	}
	if !write("ping", []byte("{}")) { // opens the stream immediately
		return
	}
	iv := a.Ping
	if iv <= 0 {
		iv = PingInterval
	}
	t := time.NewTicker(iv)
	defer t.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case ev := <-sub.C:
			if !write(ev.Name, ev.Data) {
				return
			}
		case <-t.C:
			if !write("ping", []byte("{}")) {
				return
			}
		}
	}
}
