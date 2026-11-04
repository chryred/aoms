package live

import (
	"hash/fnv"
	"math/rand"
	"strconv"
	"sync"
)

const (
	// UsersWindowMs is the sliding window for the distinct-user count ("동시 사용자").
	UsersWindowMs = 5 * 60 * 1000
	// UsersMaxKeys caps distinct user keys kept per instance. Above the cap new users are not
	// counted until older ones expire (the count saturates at the cap and UsersCapped is set).
	// Worst case ~50k * ~40B = ~2MB per instance.
	UsersMaxKeys = 50000
)

var (
	userSeedOnce sync.Once
	userSeed     string
)

// userHash maps a user key (user_id, else user_ip) to a process-salted 64-bit FNV hash.
// Raw IPs/ids are never stored: only the salted hash lives in memory, and nothing is persisted.
func userHash(key string) uint64 {
	userSeedOnce.Do(func() { userSeed = strconv.FormatUint(rand.Uint64(), 36) })
	h := fnv.New64a()
	h.Write([]byte(userSeed))
	h.Write([]byte{0})
	h.Write([]byte(key))
	return h.Sum64()
}

// userSet counts distinct users seen within the last UsersWindowMs.
type userSet struct {
	seen   map[uint64]int64 // salted hash -> last seen (ms)
	capped bool
}

func newUserSet() *userSet { return &userSet{seen: map[uint64]int64{}} }

// add records a user at nowMs. Empty keys are ignored.
func (u *userSet) add(key string, nowMs int64) {
	if key == "" {
		return
	}
	h := userHash(key)
	if _, ok := u.seen[h]; !ok && len(u.seen) >= UsersMaxKeys {
		u.expire(nowMs)
		if len(u.seen) >= UsersMaxKeys {
			u.capped = true
			return
		}
	}
	u.seen[h] = nowMs
}

func (u *userSet) expire(nowMs int64) {
	cut := nowMs - UsersWindowMs
	for h, at := range u.seen {
		if at < cut {
			delete(u.seen, h)
		}
	}
}

// count drops expired users and returns the distinct count plus whether the cap was hit
// since the previous call.
func (u *userSet) count(nowMs int64) (int, bool) {
	u.expire(nowMs)
	c := u.capped
	u.capped = false
	if len(u.seen) >= UsersMaxKeys {
		c = true
	}
	return len(u.seen), c
}

// userKey is user_id when present, otherwise user_ip.
func userKey(id, ip string) string {
	if id != "" {
		return id
	}
	return ip
}
