// Package registry caches Agent-T instance + system configuration read from PostgreSQL.
package registry

import (
	"context"
	"hash/fnv"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	DefaultSlowMs        = 3000
	DefaultRetentionDays = 7
	RefreshInterval      = 30 * time.Second
)

// Row is one agent_instances row joined with its system.
type Row struct {
	AgentID       int64
	SystemID      int64
	Host          string
	InstanceRole  string
	TokenSHA256   string
	SlowMsLabel   string // label_info.tx_slow_threshold_ms (instance override), "" if unset
	EnabledLabel  string // label_info.enabled, "" if unset
	SystemName    string
	DisplayName   string
	Environment   string
	SystemSlowMs  *int64
	SystemRetDays *int64
}

// Store loads rows; PG implementation in pgstore.go, fakes in tests.
type Store interface {
	Load(ctx context.Context) ([]Row, error)
}

type Instance struct {
	AgentID       int64
	SystemID      int64
	SystemName    string
	DisplayName   string
	Environment   string
	InstanceRole  string
	Host          string
	Enabled       bool
	SlowMs        int64
	RetentionDays int64
	ConfigVersion int64
}

type Registry struct {
	store Store
	mu    sync.RWMutex
	byTok map[string]Instance
}

func New(store Store) *Registry {
	return &Registry{store: store, byTok: map[string]Instance{}}
}

// Lookup finds an enabled-or-disabled instance by sha256 hex of its agent token.
func (r *Registry) Lookup(tokenSHA256 string) (Instance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	inst, ok := r.byTok[strings.ToLower(tokenSHA256)]
	return inst, ok
}

// Refresh reloads the cache. On error the previous cache is kept.
func (r *Registry) Refresh(ctx context.Context) error {
	rows, err := r.store.Load(ctx)
	if err != nil {
		return err
	}
	m := make(map[string]Instance, len(rows))
	for _, row := range rows {
		if row.TokenSHA256 == "" {
			continue
		}
		m[strings.ToLower(row.TokenSHA256)] = build(row)
	}
	r.mu.Lock()
	r.byTok = m
	r.mu.Unlock()
	return nil
}

// Run refreshes immediately, then every RefreshInterval until ctx is done.
func (r *Registry) Run(ctx context.Context) {
	if err := r.Refresh(ctx); err != nil {
		log.Printf("registry refresh: %v", err)
	}
	t := time.NewTicker(RefreshInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			if err := r.Refresh(ctx); err != nil {
				log.Printf("registry refresh: %v", err)
			}
		}
	}
}

func build(row Row) Instance {
	slow := int64(DefaultSlowMs)
	if row.SystemSlowMs != nil && *row.SystemSlowMs > 0 {
		slow = *row.SystemSlowMs
	}
	if v, err := strconv.ParseInt(strings.TrimSpace(row.SlowMsLabel), 10, 64); err == nil && v > 0 {
		slow = v
	}
	ret := int64(DefaultRetentionDays)
	if row.SystemRetDays != nil && *row.SystemRetDays >= 1 && *row.SystemRetDays <= 30 {
		ret = *row.SystemRetDays
	}
	enabled := strings.ToLower(strings.TrimSpace(row.EnabledLabel)) != "false"
	inst := Instance{
		AgentID: row.AgentID, SystemID: row.SystemID, SystemName: row.SystemName,
		DisplayName: row.DisplayName, Environment: row.Environment,
		InstanceRole: row.InstanceRole, Host: row.Host,
		Enabled: enabled, SlowMs: slow, RetentionDays: ret,
	}
	inst.ConfigVersion = configVersion(inst)
	return inst
}

// configVersion hashes the agent-visible config values into the low 31 bits (never 0).
func configVersion(i Instance) int64 {
	h := fnv.New64a()
	h.Write([]byte(strconv.FormatBool(i.Enabled) + "|" + strconv.FormatInt(i.SlowMs, 10)))
	v := int64(h.Sum64() & 0x7fffffff)
	if v == 0 {
		v = 1
	}
	return v
}
