package ingest

import "sync"

const (
	skewThresholdMs = 2000
	skewAlpha       = 0.3
)

// Skew tracks per-instance clock offset (server - agent), smoothed by EWMA.
type Skew struct {
	mu  sync.Mutex
	ewm map[string]float64
}

func NewSkew() *Skew { return &Skew{ewm: map[string]float64{}} }

// Correct returns the offset (ms) to add to agent timestamps. Differences within
// +-2000ms are treated as network jitter: offset 0 and the EWMA resets.
func (s *Skew) Correct(instanceKey string, batchTs, nowMs int64) int64 {
	diff := float64(nowMs - batchTs)
	s.mu.Lock()
	defer s.mu.Unlock()
	if diff > skewThresholdMs || diff < -skewThresholdMs {
		prev, ok := s.ewm[instanceKey]
		if ok {
			diff = skewAlpha*diff + (1-skewAlpha)*prev
		}
		s.ewm[instanceKey] = diff
		return int64(diff)
	}
	delete(s.ewm, instanceKey)
	return 0
}
