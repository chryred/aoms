package store

import (
	"context"
	"sync"
	"testing"

	"synapse/agent-t-gateway/internal/protocol"
)

type fakeCmdStore struct {
	mu      sync.Mutex
	pending []CommandRow
	sent    []int64
	done    map[int64]bool
}

func (f *fakeCmdStore) LoadPending(context.Context) ([]CommandRow, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []CommandRow
	for _, r := range f.pending {
		isSent := false
		for _, s := range f.sent {
			if s == r.ID {
				isSent = true
			}
		}
		if !isSent {
			out = append(out, r)
		}
	}
	return out, nil
}
func (f *fakeCmdStore) MarkSent(_ context.Context, ids []int64) error {
	f.mu.Lock()
	f.sent = append(f.sent, ids...)
	f.mu.Unlock()
	return nil
}
func (f *fakeCmdStore) MarkDone(_ context.Context, id int64, ok bool) error {
	f.mu.Lock()
	if f.done == nil {
		f.done = map[int64]bool{}
	}
	f.done[id] = ok
	f.mu.Unlock()
	return nil
}

func TestCommandsPendingSentDone(t *testing.T) {
	fs := &fakeCmdStore{pending: []CommandRow{{ID: 7, AgentID: 3, Command: "thread_dump"}, {ID: 8, AgentID: 4, Command: "thread_dump"}}}
	c := NewCommands(fs)
	ctx := context.Background()
	c.Sync(ctx)

	got := c.Pending(3)
	if len(got) != 1 || got[0] != (protocol.Command{ID: 7, Type: "thread_dump"}) {
		t.Fatalf("pending=%v", got)
	}
	if again := c.Pending(3); len(again) != 0 {
		t.Fatalf("command must be delivered once: %v", again)
	}
	c.Done(7, true)
	c.Sync(ctx) // marks sent, reloads (7 no longer pending), applies done
	if len(fs.sent) != 1 || fs.sent[0] != 7 || !fs.done[7] {
		t.Fatalf("sent=%v done=%v", fs.sent, fs.done)
	}
	if got := c.Pending(3); len(got) != 0 {
		t.Fatalf("7 must not reappear: %v", got)
	}
	if got := c.Pending(4); len(got) != 1 || got[0].ID != 8 {
		t.Fatalf("agent 4: %v", got)
	}
}
