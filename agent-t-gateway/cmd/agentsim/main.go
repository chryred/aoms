// Command agentsim is a load generator: it posts synthetic Agent-T batches
// (shape of contracts/agent-t/batch-v1.sample.json) to a gateway.
//
//	agentsim -gateway http://localhost:8330 -tokens tokens.txt -jvms 50 -tps 5000 -duration 10m
package main

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"flag"
	"fmt"
	"hash/fnv"
	"io"
	"log"
	"math/rand"
	"net/http"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
)

var (
	uris = []string{"/order/list", "/order/detail", "/cart/add", "/pay/confirm", "/item/search", "/member/me", "/event/banner", "/stock/check"}
	sqls = []string{
		"select * from orders where member_id = ?", "select * from item where id = ?",
		"update cart set qty = ? where id = ?", "insert into pay_log values (?, ?, ?)",
		"select count(*) from stock where item_id = ?",
	}
	sentTx, sentBatches, rejected, failed atomic.Int64
)

func fnvHex(s string) string {
	h := fnv.New64a()
	h.Write([]byte(s))
	return fmt.Sprintf("%016x", h.Sum64())
}

func randHex(r *rand.Rand, n int) string {
	const hexd = "0123456789abcdef"
	b := make([]byte, n)
	for i := range b {
		b[i] = hexd[r.Intn(16)]
	}
	return string(b)
}

type jvm struct {
	token string
	idx   int
	r     *rand.Rand
	seq   int64
	cfgV  int64
	dict  map[string]string // every id -> text this JVM can answer need_dict with
	send  map[string]bool   // ids to include in the next batch's dict
}

func (j *jvm) batch(nTx int, now int64) *protocol.Batch {
	b := &protocol.Batch{
		V: 1, Seq: j.seq, Ts: now, CfgV: j.cfgV,
		Agent:  protocol.AgentInfo{Version: "sim", JVM: "21", Pid: int64(1000 + j.idx), Host: fmt.Sprintf("sim-%d", j.idx), StartTs: now - 3600000},
		Active: protocol.Active{Buckets: [3]int64{int64(j.r.Intn(20)), int64(j.r.Intn(3)), 0}, Top: []protocol.ActiveTop{}},
		Tx:     make([]protocol.Tx, 0, nTx),
		Dict:   protocol.Dict{SQL: map[string]string{}, URI: map[string]string{}},
		Dumps:  []protocol.Dump{},
	}
	for i := 0; i < nTx; i++ {
		uri := uris[j.r.Intn(len(uris))]
		sql := sqls[j.r.Intn(len(sqls))]
		el := int64(20 + j.r.Intn(300))
		slow := j.r.Intn(100) == 0
		if slow {
			el = 3000 + int64(j.r.Intn(4000))
		}
		tx := protocol.Tx{
			TraceID: randHex(j.r, 32), SpanID: randHex(j.r, 16), StartTs: now - el - int64(j.r.Intn(900)),
			ElapsedMs: el, Method: "GET", URIID: fnvHex(uri), Status: 200, Error: j.r.Intn(200) == 0,
			CPUMs: el / 4, SQLMs: el / 2, SQLCnt: 2, UserIP: "10.253.21.*", UserID: "ab****",
			SQL: []protocol.TxSQL{{SQLID: fnvHex(sql), Cnt: 2, Ms: el / 2, MaxMs: el / 3}},
		}
		if slow || tx.Error {
			tx.Detail = &protocol.Detail{
				Nodes:  []protocol.Node{{I: 0, P: -1, K: "http", N: "GET " + uri, S: 0, D: el}, {I: 1, P: 0, K: "sql", N: "SELECT", S: 5, D: el / 2, SQLID: fnvHex(sql)}},
				Stacks: []protocol.Stack{{F: []string{"com.example.Dao.query", "com.example.Service.run"}, C: 3}},
			}
		}
		b.Tx = append(b.Tx, tx)
		j.dict["uri:"+fnvHex(uri)], j.dict["sql:"+fnvHex(sql)] = uri, sql
	}
	if j.seq == 0 { // first batch carries the whole dictionary; later ones only what need_dict asks for
		for k, v := range j.dict {
			j.addDict(b, k, v)
		}
	}
	for k := range j.send {
		if txt, ok := j.dict[k]; ok {
			j.addDict(b, k, txt)
		}
		delete(j.send, k)
	}
	return b
}

func (j *jvm) addDict(b *protocol.Batch, key, text string) {
	kind, id, _ := strings.Cut(key, ":")
	if kind == "sql" {
		b.Dict.SQL[id] = text
	} else {
		b.Dict.URI[id] = text
	}
}

func (j *jvm) post(c *http.Client, url string, b *protocol.Batch) (backoff time.Duration) {
	raw, _ := json.Marshal(b)
	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	zw.Write(raw)
	zw.Close()
	req, _ := http.NewRequest(http.MethodPost, url+"/t/v1/batch", &buf)
	req.Header.Set("Authorization", "Bearer "+j.token)
	req.Header.Set("Content-Encoding", "gzip")
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		failed.Add(1)
		return time.Second
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	switch {
	case resp.StatusCode == http.StatusOK:
		sentTx.Add(int64(len(b.Tx)))
		sentBatches.Add(1)
		var r protocol.Response
		if json.Unmarshal(body, &r) == nil {
			if r.Config != nil {
				j.cfgV = r.Config.Version
			}
			for _, id := range r.NeedDict.SQL {
				j.send["sql:"+id] = true
			}
			for _, id := range r.NeedDict.URI {
				j.send["uri:"+id] = true
			}
			return time.Duration(r.BackoffMs) * time.Millisecond
		}
	case resp.StatusCode == http.StatusTooManyRequests:
		rejected.Add(1)
		var r struct {
			BackoffMs int `json:"backoff_ms"`
		}
		_ = json.Unmarshal(body, &r)
		return time.Duration(r.BackoffMs) * time.Millisecond
	default:
		failed.Add(1)
		return time.Second
	}
	return 0
}

func readTokens(path string) []string {
	f, err := os.Open(path)
	if err != nil {
		log.Fatalf("tokens: %v", err)
	}
	defer f.Close()
	var out []string
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		if t := strings.TrimSpace(sc.Text()); t != "" {
			out = append(out, t)
		}
	}
	if len(out) == 0 {
		log.Fatal("tokens file is empty")
	}
	return out
}

func main() {
	gateway := flag.String("gateway", "http://localhost:8330", "gateway base URL")
	tokensFile := flag.String("tokens", "tokens.txt", "file with one agent token per line (JVMs reuse them round-robin)")
	jvms := flag.Int("jvms", 50, "simulated JVM count")
	tps := flag.Int("tps", 5000, "total transactions per second across all JVMs")
	duration := flag.Duration("duration", 10*time.Minute, "run time")
	flag.Parse()
	if *jvms < 1 || *tps < 1 {
		log.Fatal("-jvms and -tps must be >= 1")
	}
	tokens := readTokens(*tokensFile)
	perBatch := (*tps + *jvms - 1) / *jvms
	client := &http.Client{Timeout: 10 * time.Second}
	stop := time.Now().Add(*duration)

	var wg sync.WaitGroup
	for i := 0; i < *jvms; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			j := &jvm{token: tokens[i%len(tokens)], idx: i, r: rand.New(rand.NewSource(int64(i) + time.Now().UnixNano())),
				dict: map[string]string{}, send: map[string]bool{}}
			time.Sleep(time.Duration(j.r.Intn(1000)) * time.Millisecond) // spread JVMs across the second
			t := time.NewTicker(time.Second)
			defer t.Stop()
			for time.Now().Before(stop) {
				if wait := j.post(client, *gateway, j.batch(perBatch, time.Now().UnixMilli())); wait > 0 {
					time.Sleep(wait)
				}
				j.seq++
				<-t.C
			}
		}(i)
	}
	wg.Wait()
	fmt.Printf("sent_tx=%d batches=%d rejected_429=%d failed=%d\n", sentTx.Load(), sentBatches.Load(), rejected.Load(), failed.Load())
}
