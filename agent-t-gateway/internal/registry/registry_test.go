package registry

import (
	"context"
	"errors"
	"strconv"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

type fakeStore struct {
	rows []Row
	err  error
}

func (f *fakeStore) Load(context.Context) ([]Row, error) { return f.rows, f.err }

func i64(v int64) *int64 { return &v }

func TestRegistryLookup(t *testing.T) {
	st := &fakeStore{rows: []Row{
		{AgentID: 1, SystemID: 10, Host: "h1", InstanceRole: "was1", TokenSHA256: "AAA", SystemName: "ORDER", DisplayName: "주문", Environment: "prod", SystemSlowMs: i64(5000), SystemRetDays: i64(14)},
		{AgentID: 2, SystemID: 10, Host: "h2", TokenSHA256: "bbb", SlowMsLabel: "1200", EnabledLabel: "false", SystemName: "ORDER", SystemSlowMs: i64(5000)},
		{AgentID: 3, SystemID: 11, TokenSHA256: "ccc", SystemName: "X"},
		{AgentID: 4, SystemID: 11, TokenSHA256: "", SystemName: "X"},
	}}
	r := New(st)
	if err := r.Refresh(context.Background()); err != nil {
		t.Fatal(err)
	}
	a, ok := r.Lookup("aaa")
	if !ok || a.AgentID != 1 || a.SlowMs != 5000 || a.RetentionDays != 14 || !a.Enabled || a.SystemName != "ORDER" || a.InstanceRole != "was1" {
		t.Fatalf("a=%+v ok=%v", a, ok)
	}
	b, _ := r.Lookup("bbb")
	if b.SlowMs != 1200 || b.Enabled || b.RetentionDays != 7 {
		t.Fatalf("override b=%+v", b)
	}
	c, _ := r.Lookup("ccc")
	if c.SlowMs != 3000 || c.RetentionDays != 7 {
		t.Fatalf("defaults c=%+v", c)
	}
	if a.ConfigVersion <= 0 || a.ConfigVersion >= 1<<31 || a.ConfigVersion == b.ConfigVersion {
		t.Fatalf("versions a=%d b=%d", a.ConfigVersion, b.ConfigVersion)
	}
	if _, ok := r.Lookup("nope"); ok {
		t.Fatal("unexpected hit")
	}
}

func TestRefreshErrorKeepsCache(t *testing.T) {
	st := &fakeStore{rows: []Row{{AgentID: 1, TokenSHA256: "aaa", SystemName: "S"}}}
	r := New(st)
	_ = r.Refresh(context.Background())
	st.err = errors.New("pg down")
	if err := r.Refresh(context.Background()); err == nil {
		t.Fatal("want error")
	}
	if _, ok := r.Lookup("aaa"); !ok {
		t.Fatal("cache dropped on error")
	}
}

func TestLookupMissReloadsAndAccepts(t *testing.T) {
	st := &fakeStore{}
	r := New(st)
	_ = r.Refresh(context.Background())
	st.rows = []Row{{AgentID: 7, TokenSHA256: "NEW", SystemName: "S"}} // 설치 직후 등록됨
	inst, ok := r.Lookup("new")
	if !ok || inst.AgentID != 7 {
		t.Fatalf("want accepted after on-demand reload, got %+v ok=%v", inst, ok)
	}
}

func TestLookupStillUnknownAfterReload(t *testing.T) {
	st := &countStore{rows: []Row{{AgentID: 1, TokenSHA256: "aaa", SystemName: "S"}}}
	r := New(st)
	_ = r.Refresh(context.Background())
	if _, ok := r.Lookup("zzz"); ok {
		t.Fatal("unknown token accepted")
	}
	if n := st.loads.Load(); n != 2 { // 초기 Refresh + 온디맨드 1회
		t.Fatalf("loads=%d", n)
	}
}

func TestLookupRevokedTokenRejected(t *testing.T) {
	st := &fakeStore{rows: []Row{{AgentID: 1, TokenSHA256: "aaa", SystemName: "S"}}}
	r := New(st)
	_ = r.Refresh(context.Background())
	st.rows = nil
	_ = r.Refresh(context.Background()) // 주기 갱신이 폐기를 반영
	if _, ok := r.Lookup("aaa"); ok {
		t.Fatal("revoked token accepted")
	}
}

func TestMissReloadRateLimited(t *testing.T) {
	st := &countStore{}
	r := New(st)
	clock := time.Unix(1000, 0)
	r.now = func() time.Time { return clock }
	for i := 0; i < 500; i++ {
		r.Lookup("unknown" + strconv.Itoa(i))
	}
	if n := st.loads.Load(); n != 1 {
		t.Fatalf("loads=%d want 1 within interval", n)
	}
	clock = clock.Add(MissReloadInterval + time.Millisecond)
	r.Lookup("again")
	if n := st.loads.Load(); n != 2 {
		t.Fatalf("loads=%d want 2 after interval", n)
	}
}

func TestMissReloadSharedInFlight(t *testing.T) {
	st := &countStore{gate: make(chan struct{})}
	r := New(st)
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			r.Lookup("unknown" + strconv.Itoa(i))
		}(i)
	}
	time.Sleep(100 * time.Millisecond) // 모든 호출이 진행 중인 재로드에 합류할 시간
	close(st.gate)
	wg.Wait()
	if n := st.loads.Load(); n != 1 {
		t.Fatalf("loads=%d want 1 shared", n)
	}
}

// countStore counts Load calls; if gate is set, Load blocks until it is closed.
type countStore struct {
	rows  []Row
	loads atomic.Int64
	gate  chan struct{}
}

func (c *countStore) Load(context.Context) ([]Row, error) {
	c.loads.Add(1)
	if c.gate != nil {
		<-c.gate
	}
	return c.rows, nil
}
