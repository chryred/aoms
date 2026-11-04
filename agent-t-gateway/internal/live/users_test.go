package live

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
)

func userBatch(users ...[2]string) *protocol.Batch { // each = {user_id, user_ip}
	b := &protocol.Batch{V: 1}
	for i, u := range users {
		b.Tx = append(b.Tx, protocol.Tx{TraceID: fmt.Sprintf("t%d", i), SpanID: "s", StartTs: 1000,
			ElapsedMs: 10, URIID: "u1", UserID: u[0], UserIP: u[1]})
	}
	return b
}

func TestUsers5mDistinctByIDElseIP(t *testing.T) {
	s := NewState(nil)
	now := time.Unix(1000, 0)
	s.Now = func() time.Time { return now }
	// alice from two IPs counts once (id wins); two anonymous IPs count twice; one repeated IP once; empty ignored
	s.Accept(testInst, userBatch(
		[2]string{"alice", "1.1.1.1"}, [2]string{"alice", "2.2.2.2"},
		[2]string{"", "3.3.3.3"}, [2]string{"", "3.3.3.3"}, [2]string{"", "4.4.4.4"}, [2]string{"", ""}), 0)
	ev := s.Aggregate()[0]
	if ev.Users5m != 3 || ev.UsersCapped {
		t.Fatalf("users=%d capped=%v", ev.Users5m, ev.UsersCapped)
	}
	out, _ := json.Marshal(aggPayload{Users5m: ev.Users5m})
	if !strings.Contains(string(out), `"users_5m":3`) {
		t.Fatal(string(out))
	}
}

func TestUsers5mSlidesOut(t *testing.T) {
	s := NewState(nil)
	now := time.Unix(1000, 0)
	s.Now = func() time.Time { return now }
	s.Accept(testInst, userBatch([2]string{"a", ""}), 0)
	now = now.Add(4 * time.Minute)
	s.Accept(testInst, userBatch([2]string{"b", ""}), 0)
	if ev := s.Aggregate()[0]; ev.Users5m != 2 {
		t.Fatalf("users=%d", ev.Users5m)
	}
	now = now.Add(90 * time.Second) // a is 5m30s old, b 1m30s
	s.Accept(testInst, userBatch(), 0)
	if ev := s.Aggregate()[0]; ev.Users5m != 1 {
		t.Fatalf("users=%d", ev.Users5m)
	}
}

func TestUserSetCapBoundsMemory(t *testing.T) {
	u := newUserSet()
	for i := 0; i < UsersMaxKeys+500; i++ {
		u.add(fmt.Sprintf("u%d", i), 1000)
	}
	n, capped := u.count(1000)
	if n != UsersMaxKeys || !capped {
		t.Fatalf("n=%d capped=%v", n, capped)
	}
	// existing users still refresh, and expiry frees room for new ones
	u.add("u0", 2000)
	u.add("fresh", 1000+UsersWindowMs+1)
	if len(u.seen) > UsersMaxKeys {
		t.Fatalf("grew past cap: %d", len(u.seen))
	}
	if n, _ := u.count(1000 + UsersWindowMs + 1); n != 2 {
		t.Fatalf("after expiry n=%d", n)
	}
}

func TestUserSetStoresNoRawKey(t *testing.T) {
	u := newUserSet()
	u.add("10.1.2.3", 1)
	for h := range u.seen {
		if h == 0 {
			t.Fatal("zero hash")
		}
	}
	if userHash("10.1.2.3") != userHash("10.1.2.3") || userHash("a") == userHash("b") {
		t.Fatal("hash not stable/distinct")
	}
}
