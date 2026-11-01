package store

import (
	"container/list"
	"sync"
)

// DefaultDictCapacity bounds the in-memory id set (spec: LRU 200,000).
const DefaultDictCapacity = 200000

// DictPersister stores new dictionary entries durably (Writer.PutDict).
type DictPersister interface {
	PutDict(kind, id, text string)
}

// Dict implements ingest.DictCache. It starts empty, so after a restart every
// referenced id is reported missing and agents resend the text (need_dict).
type Dict struct {
	persist DictPersister
	cap     int

	mu    sync.Mutex
	ll    *list.List // front = most recently used; values are string keys
	items map[string]*list.Element
}

func NewDict(persist DictPersister, capacity int) *Dict {
	if capacity <= 0 {
		capacity = DefaultDictCapacity
	}
	return &Dict{persist: persist, cap: capacity, ll: list.New(), items: map[string]*list.Element{}}
}

func dictKey(kind, id string) string { return kind + ":" + id }

// Missing returns the ids not currently known. Known ids are refreshed in the LRU.
func (d *Dict) Missing(kind string, ids []string) []string {
	d.mu.Lock()
	defer d.mu.Unlock()
	var out []string
	for _, id := range ids {
		if el, ok := d.items[dictKey(kind, id)]; ok {
			d.ll.MoveToFront(el)
		} else {
			out = append(out, id)
		}
	}
	return out
}

// Put records an id and queues it for dict_sql / dict_uri.
func (d *Dict) Put(kind, id, text string) {
	k := dictKey(kind, id)
	d.mu.Lock()
	if el, ok := d.items[k]; ok {
		d.ll.MoveToFront(el)
	} else {
		d.items[k] = d.ll.PushFront(k)
		for d.ll.Len() > d.cap {
			back := d.ll.Back()
			d.ll.Remove(back)
			delete(d.items, back.Value.(string))
		}
	}
	d.mu.Unlock()
	if d.persist != nil {
		d.persist.PutDict(kind, id, text)
	}
}

// Evict forgets an id whose text was shed or rejected before reaching ClickHouse,
// so the next batch that references it gets it back in need_dict.
func (d *Dict) Evict(kind, id string) {
	k := dictKey(kind, id)
	d.mu.Lock()
	if el, ok := d.items[k]; ok {
		d.ll.Remove(el)
		delete(d.items, k)
	}
	d.mu.Unlock()
}
