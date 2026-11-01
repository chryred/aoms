package live

import (
	"sort"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

const (
	AggWindowSec = 5
	topN         = 10
	UriTotalsMax = 200
	OtherURI     = "_other"
)

type TopItem struct {
	Name string  `json:"-"`
	Cnt  int64   `json:"cnt"`
	Ms   float64 `json:"ms"`
}

type UriCounter struct {
	Cnt uint64
	Err uint64
	Ms  float64
}

// Counters are cumulative since gateway start (for Prometheus remote write).
type Counters struct {
	TxTotal, ErrTotal, SlowTotal uint64
	ElapsedSumMs                 float64
	UriTotals                    map[string]UriCounter // top 200 + "_other"
}

type AggEvent struct {
	Inst           registry.Instance
	Ts             int64
	Tps, AvgMs     float64
	ErrRate        float64
	SlowCnt        int
	UriTop, SqlTop []TopItem
	Jvm            *protocol.JVM
	Active         [3]int64 // latest active-transaction buckets (normal/warning/critical)
	Dropped        protocol.Dropped
	Counters       Counters
}

type counter struct {
	cnt int64
	ms  float64
}

// window accumulates one 5s aggregation interval.
type window struct {
	tx, errs, slow int
	sumMs          float64
	uri, sql       map[string]*counter
	jvm            *protocol.JVM
	dropped        protocol.Dropped
}

func newWindow() *window {
	return &window{uri: map[string]*counter{}, sql: map[string]*counter{}}
}

func bump(m map[string]*counter, k string, cnt int64, ms float64) {
	c := m[k]
	if c == nil {
		c = &counter{}
		m[k] = c
	}
	c.cnt += cnt
	c.ms += ms
}

func topOf(m map[string]*counter) []TopItem {
	out := make([]TopItem, 0, len(m))
	for k, c := range m {
		out = append(out, TopItem{Name: k, Cnt: c.cnt, Ms: c.ms})
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Cnt != out[j].Cnt {
			return out[i].Cnt > out[j].Cnt
		}
		return out[i].Name < out[j].Name
	})
	if len(out) > topN {
		out = out[:topN]
	}
	return out
}

func (c *Counters) addURI(uri string, ms float64, isErr bool) {
	if _, ok := c.UriTotals[uri]; !ok {
		named := len(c.UriTotals)
		if _, has := c.UriTotals[OtherURI]; has {
			named--
		}
		if named >= UriTotalsMax {
			uri = OtherURI
		}
	}
	u := c.UriTotals[uri]
	u.Cnt++
	if isErr {
		u.Err++
	}
	u.Ms += ms
	c.UriTotals[uri] = u
}
