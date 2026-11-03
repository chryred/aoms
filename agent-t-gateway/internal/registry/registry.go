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
	// MissReloadInterval: 미등록 토큰이 들어왔을 때 즉시 재로드하는 전역 최소 간격.
	MissReloadInterval = 2 * time.Second
	missReloadTimeout  = 5 * time.Second
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

	missMu     sync.Mutex
	missFlight chan struct{} // 진행 중인 온디맨드 재로드(끝나면 close), 없으면 nil
	missLast   time.Time     // 마지막 온디맨드 재로드 시작 시각
	now        func() time.Time
}

func New(store Store) *Registry {
	return &Registry{store: store, byTok: map[string]Instance{}, now: time.Now}
}

// Lookup finds an enabled-or-disabled instance by sha256 hex of its agent token.
// 미등록 토큰이면 레지스트리를 즉시 재로드(전역 MissReloadInterval 당 1회, 동시 호출은 한 번의
// 재로드를 공유)한 뒤 다시 확인한다 — 방금 설치된 에이전트가 30초 주기 갱신을 기다리다 401 을 받지 않도록.
func (r *Registry) Lookup(tokenSHA256 string) (Instance, bool) {
	key := strings.ToLower(tokenSHA256)
	if inst, ok := r.get(key); ok {
		return inst, true
	}
	r.reloadOnMiss()
	return r.get(key)
}

func (r *Registry) get(key string) (Instance, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	inst, ok := r.byTok[key]
	return inst, ok
}

// reloadOnMiss runs at most one Refresh per MissReloadInterval; callers arriving during
// an in-flight reload wait for it, callers inside the interval return immediately.
// 실패한 재로드도 간격에 포함된다(PG 장애 중 미등록 토큰 폭주가 DB 부하가 되지 않도록).
func (r *Registry) reloadOnMiss() {
	r.missMu.Lock()
	if f := r.missFlight; f != nil {
		r.missMu.Unlock()
		<-f
		return
	}
	if !r.missLast.IsZero() && r.now().Sub(r.missLast) < MissReloadInterval {
		r.missMu.Unlock()
		return
	}
	f := make(chan struct{})
	r.missFlight = f
	r.missLast = r.now()
	r.missMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), missReloadTimeout)
	if err := r.Refresh(ctx); err != nil {
		log.Printf("registry on-demand refresh: %v", err)
	}
	cancel()

	r.missMu.Lock()
	r.missFlight = nil
	r.missMu.Unlock()
	close(f)
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
