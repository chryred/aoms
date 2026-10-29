//go:build integration

package store

import (
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"math/big"
	"net/http"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

func envOr(k, d string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return d
}

func chQuery(t *testing.T, cfg Config, q string) string {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, cfg.URL+"/?"+url.Values{"query": {q}}.Encode(), nil)
	req.Header.Set("X-ClickHouse-User", cfg.User)
	req.Header.Set("X-ClickHouse-Key", cfg.Password)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	b, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		t.Fatalf("query %q: %d %s", q, resp.StatusCode, b)
	}
	return strings.TrimSpace(string(b))
}

// TestInsertAndQuery loads the contract sample batch into a real ClickHouse (T0 DDL) and
// proves DateTime64/DateTime string formats, UInt64 ids and expire_at round-trip.
func TestInsertAndQuery(t *testing.T) {
	cfg := Config{
		URL: envOr("CLICKHOUSE_URL", "http://localhost:8123"), DB: "agent_t",
		User: envOr("CLICKHOUSE_USER", "agent_t"), Password: envOr("CLICKHOUSE_PASSWORD", "agent_t_dev"),
		FlushInterval: time.Hour, FlushRows: 10000, MaxQueueBytes: 1 << 30,
	}
	n, _ := rand.Int(rand.Reader, big.NewInt(9000))
	sysID := 990000 + n.Int64() // unique per run; other tasks share this ClickHouse
	inst := registry.Instance{SystemID: sysID, InstanceRole: "was1", Host: "itest", RetentionDays: 7}

	raw, err := os.ReadFile("../../../contracts/agent-t/batch-v1.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	b, err := protocol.Decode(strings.NewReader(string(raw)), false)
	if err != nil {
		t.Fatal(err)
	}

	w := NewWriter(cfg, nil)
	ack := &fakeAcker{}
	w.Dumps = ack
	// The sample's timestamps are old, so expire_at would already be past and ClickHouse TTL would
	// discard the rows on insert. Shift them to "now" through the skew-offset path.
	offset := time.Now().UnixMilli() - b.Ts
	w.Accept(inst, b, offset)
	w.PutDict("sql", "1122334455667788", "select * from orders where id = ?")
	if err := w.Flush(context.Background()); err != nil {
		t.Fatal(err)
	}

	where := fmt.Sprintf("WHERE system_id=%d", sysID)
	if got := chQuery(t, cfg, "SELECT count() FROM agent_t.tx_summary "+where); got != "3" {
		t.Fatalf("tx_summary count=%s", got)
	}
	if got := chQuery(t, cfg, "SELECT count() FROM agent_t.tx_detail "+where); got != "1" {
		t.Fatalf("tx_detail count=%s", got)
	}
	if got := chQuery(t, cfg, "SELECT count() FROM agent_t.jvm_thread_dump "+where+" AND cmd_id=7"); got != "1" {
		t.Fatalf("dump count=%s", got)
	}
	if len(ack.ids) != 1 || ack.ids[0] != 7 {
		t.Fatalf("acks=%v", ack.ids)
	}

	// Round-trip: ms precision kept, UTC, expire_at = start + 7d.
	first := b.Tx[0]
	row := chQuery(t, cfg, fmt.Sprintf(
		"SELECT toUnixTimestamp64Milli(start_ts), toUnixTimestamp(expire_at) FROM agent_t.tx_summary %s AND span_id='%s' FORMAT TSV",
		where, first.SpanID))
	var gotMs, gotExp int64
	fmt.Sscanf(row, "%d\t%d", &gotMs, &gotExp)
	wantStart := first.StartTs + offset
	if gotMs != wantStart || gotExp != wantStart/1000+7*86400 {
		t.Fatalf("start/expire = %d/%d, want %d/%d", gotMs, gotExp, wantStart, wantStart/1000+7*86400)
	}
	// UInt64 id with high bits survives.
	if got := chQuery(t, cfg, fmt.Sprintf("SELECT count() FROM agent_t.tx_sql %s AND sql_id=toUInt64(0x1122334455667788)", where)); got == "0" {
		t.Fatal("tx_sql row with UInt64 sql_id not found")
	}
	if got := chQuery(t, cfg, "SELECT text FROM agent_t.dict_sql WHERE id = 1234605616436508552 LIMIT 1"); !strings.Contains(got, "orders") {
		t.Fatalf("dict_sql=%q", got)
	}
}
