package store

import (
	"context"
	"log"
	"strconv"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"synapse/agent-t-gateway/internal/protocol"
)

const commandPollInterval = 2 * time.Second

// staleCommandAge: a pending command older than this is never delivered (admin-api
// marks it failed and lets the operator request a new dump).
const staleCommandAge = 120 * time.Second

// CommandRow is one agent_commands row in status 'pending'.
type CommandRow struct {
	ID      int64
	AgentID int64
	Command string
	// CreatedAt is naive UTC from PG; zero means unknown (never treated as stale).
	CreatedAt time.Time
}

// CommandStore is the PG access behind Commands; PGCommandStore is the real one, tests use fakes.
type CommandStore interface {
	LoadPending(ctx context.Context) ([]CommandRow, error)
	MarkSent(ctx context.Context, ids []int64) error
	MarkDone(ctx context.Context, id int64, ok bool) error
}

// Commands implements ingest.CommandSource. Requests only touch memory; PG is
// polled/updated by Run so the ingest path never waits on the database.
type Commands struct {
	store CommandStore
	now   func() time.Time // naive-UTC comparisons use time.Now().UTC(); tests override

	mu      sync.Mutex
	byAgent map[int64][]protocol.Command
	sentQ   []int64 // delivered, status not yet 'sent' in PG
	doneQ   []doneItem
}

type doneItem struct {
	id int64
	ok bool
}

func NewCommands(store CommandStore) *Commands {
	return &Commands{store: store, now: func() time.Time { return time.Now().UTC() }, byAgent: map[int64][]protocol.Command{}}
}

// Pending returns (and hands off) the commands waiting for this agent instance.
func (c *Commands) Pending(agentID int64) []protocol.Command {
	c.mu.Lock()
	defer c.mu.Unlock()
	cmds := c.byAgent[agentID]
	if len(cmds) == 0 {
		return nil
	}
	delete(c.byAgent, agentID)
	for _, cmd := range cmds {
		c.sentQ = append(c.sentQ, cmd.ID)
	}
	return cmds
}

// Done records the result of a command (thread dump received). Applied on the next Sync.
func (c *Commands) Done(cmdID int64, ok bool) {
	c.mu.Lock()
	c.doneQ = append(c.doneQ, doneItem{cmdID, ok})
	c.mu.Unlock()
}

// Sync writes queued status changes to PG, then reloads pending commands.
func (c *Commands) Sync(ctx context.Context) {
	c.mu.Lock()
	sent, done := c.sentQ, c.doneQ
	c.sentQ, c.doneQ = nil, nil
	c.mu.Unlock()

	if len(sent) > 0 {
		if err := c.store.MarkSent(ctx, sent); err != nil {
			log.Printf("agent_commands mark sent: %v", err)
			c.mu.Lock()
			c.sentQ = append(sent, c.sentQ...)
			c.mu.Unlock()
		}
	}
	for i, d := range done {
		if err := c.store.MarkDone(ctx, d.id, d.ok); err != nil {
			log.Printf("agent_commands mark done: %v", err)
			c.mu.Lock()
			c.doneQ = append(done[i:], c.doneQ...)
			c.mu.Unlock()
			break
		}
	}

	rows, err := c.store.LoadPending(ctx)
	if err != nil {
		log.Printf("agent_commands load: %v", err)
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	inflight := map[int64]bool{}
	for _, id := range c.sentQ {
		inflight[id] = true
	}
	m := map[int64][]protocol.Command{}
	for _, r := range rows {
		if inflight[r.ID] {
			continue
		}
		if !r.CreatedAt.IsZero() && c.now().Sub(r.CreatedAt) > staleCommandAge {
			continue
		}
		m[r.AgentID] = append(m[r.AgentID], protocol.Command{ID: r.ID, Type: r.Command})
	}
	c.byAgent = m
}

// Run syncs every 2s until ctx is done.
func (c *Commands) Run(ctx context.Context) {
	t := time.NewTicker(commandPollInterval)
	defer t.Stop()
	for {
		c.Sync(ctx)
		select {
		case <-ctx.Done():
			return
		case <-t.C:
		}
	}
}

// PGCommandStore reads and updates agent_commands. Timestamps are naive UTC.
type PGCommandStore struct{ Pool *pgxpool.Pool }

func (p PGCommandStore) LoadPending(ctx context.Context) ([]CommandRow, error) {
	rows, err := p.Pool.Query(ctx,
		`SELECT id, agent_instance_id, command, created_at FROM agent_commands WHERE status = 'pending' ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []CommandRow
	for rows.Next() {
		var r CommandRow
		if err := rows.Scan(&r.ID, &r.AgentID, &r.Command, &r.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

func (p PGCommandStore) MarkSent(ctx context.Context, ids []int64) error {
	_, err := p.Pool.Exec(ctx,
		`UPDATE agent_commands SET status='sent', updated_at = (now() AT TIME ZONE 'utc')
		 WHERE id = ANY($1) AND status='pending'`, ids)
	return err
}

// MarkDone sets status done|failed. result_ref = cmd id: the dump is in
// agent_t.jvm_thread_dump keyed by cmd_id.
func (p PGCommandStore) MarkDone(ctx context.Context, id int64, ok bool) error {
	status := "failed"
	if ok {
		status = "done"
	}
	_, err := p.Pool.Exec(ctx,
		`UPDATE agent_commands SET status=$2, result_ref=$3, updated_at = (now() AT TIME ZONE 'utc')
		 WHERE id=$1 AND status IN ('pending','sent')`, id, status, strconv.FormatInt(id, 10))
	return err
}
