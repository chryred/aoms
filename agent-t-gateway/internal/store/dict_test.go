package store

import "testing"

type recPersist struct{ got []string }

func (r *recPersist) PutDict(kind, id, text string) { r.got = append(r.got, kind+":"+id+"="+text) }

func TestDictMissingPutAndEviction(t *testing.T) {
	p := &recPersist{}
	d := NewDict(p, 2)
	if m := d.Missing("sql", []string{"a", "b"}); len(m) != 2 {
		t.Fatalf("fresh dict must report all missing: %v", m)
	}
	d.Put("sql", "a", "select 1")
	d.Put("uri", "a", "/x") // same id, other kind: distinct
	if m := d.Missing("sql", []string{"a", "b"}); len(m) != 1 || m[0] != "b" {
		t.Fatalf("missing=%v", m)
	}
	// capacity 2: "sql:a" was just touched, so adding a third evicts "uri:a".
	d.Put("sql", "c", "select 2")
	if m := d.Missing("uri", []string{"a"}); len(m) != 1 {
		t.Fatalf("uri:a should be evicted: %v", m)
	}
	if len(p.got) != 3 || p.got[0] != "sql:a=select 1" {
		t.Fatalf("persisted=%v", p.got)
	}
}
