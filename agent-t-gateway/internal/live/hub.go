package live

import (
	"sync"
	"sync/atomic"
)

// SubBuffer is the per-subscriber event buffer (events beyond it are dropped for that subscriber only).
const SubBuffer = 256

// Event is one SSE message; Data is pre-marshaled JSON.
type Event struct {
	Name     string
	SystemID int64 // 0 = broadcast to all subscribers (ping)
	Data     []byte
}

type Sub struct {
	C       chan Event
	systems map[int64]bool // empty = all
	Dropped atomic.Uint64
}

type Hub struct {
	mu      sync.RWMutex
	subs    map[*Sub]struct{}
	Dropped atomic.Uint64 // total dropped across subscribers
}

func NewHub() *Hub { return &Hub{subs: map[*Sub]struct{}{}} }

func (h *Hub) Subscribe(systemIDs []int64) *Sub {
	s := &Sub{C: make(chan Event, SubBuffer), systems: map[int64]bool{}}
	for _, id := range systemIDs {
		s.systems[id] = true
	}
	h.mu.Lock()
	h.subs[s] = struct{}{}
	h.mu.Unlock()
	return s
}

func (h *Hub) Unsubscribe(s *Sub) {
	h.mu.Lock()
	delete(h.subs, s)
	h.mu.Unlock()
}

// Publish never blocks: a full subscriber buffer drops the event for that subscriber.
func (h *Hub) Publish(ev Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for s := range h.subs {
		if ev.SystemID != 0 && len(s.systems) > 0 && !s.systems[ev.SystemID] {
			continue
		}
		select {
		case s.C <- ev:
		default:
			s.Dropped.Add(1)
			h.Dropped.Add(1)
		}
	}
}
