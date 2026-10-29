package registry

import (
	"context"
	"errors"
	"testing"
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
