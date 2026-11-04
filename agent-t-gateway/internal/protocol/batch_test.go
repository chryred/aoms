package protocol

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"os"
	"strings"
	"testing"
)

func gz(t *testing.T, p []byte) *bytes.Reader {
	var buf bytes.Buffer
	w := gzip.NewWriter(&buf)
	w.Write(p)
	w.Close()
	return bytes.NewReader(buf.Bytes())
}

func TestDecodeSample(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/agent-t/batch-v1.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Decode(gz(t, raw), true)
	if err != nil {
		t.Fatal(err)
	}
	if len(b.Tx) != 3 {
		t.Fatalf("tx=%d", len(b.Tx))
	}
	if b.Tx[1].Detail == nil || len(b.Tx[1].Detail.Nodes) != 4 {
		t.Fatal("detail missing")
	}
	if pr := b.Tx[1].Detail.Params; pr == nil || pr.Q != "src=mobile&token=****" || len(pr.P) != 3 || pr.P[2][1] != "****" || pr.T {
		t.Fatalf("params not decoded: %+v", pr)
	}
	if b.Tx[0].Detail != nil {
		t.Fatal("tx0 has no detail")
	}
	if b.JVM == nil || b.Dict.SQL["1122334455667788"] == "" || *b.Active.Top[0].SQLID != "1122334455667788" {
		t.Fatal("fields not decoded")
	}
	if b.Tx[0].SQL[0].DB != "10.103.1.61:1433/stap" || b.Tx[0].SQL[1].DB != "" {
		t.Fatalf("sql db: %q %q", b.Tx[0].SQL[0].DB, b.Tx[0].SQL[1].DB)
	}
}

func TestDecodePoolFieldsAndOldAgentCompat(t *testing.T) {
	raw, err := os.ReadFile("../../../contracts/agent-t/batch-v1.sample.json")
	if err != nil {
		t.Fatal(err)
	}
	b, err := Decode(gz(t, raw), true)
	if err != nil {
		t.Fatal(err)
	}
	j := b.JVM
	if j.ConnActive == nil || *j.ConnActive != 12 || *j.ConnIdle != 18 || *j.ConnMax != 659 || *j.ConnWait != 1 {
		t.Fatalf("conn sums: %+v", j)
	}
	if j.ConnPeak == nil || *j.ConnPeak != 15 {
		t.Fatalf("conn_peak: %+v", j.ConnPeak)
	}
	p1 := j.Pools[1]
	if len(j.Pools) != 2 || p1.Name != "sic_sso_DS" || p1.Active != 5 || p1.Max != 5 || p1.Wait != 1 || p1.Peak == nil || *p1.Peak != 6 {
		t.Fatalf("pools: %+v", j.Pools)
	}
	// 구 에이전트: conn_*/pools 없음 -> nil 이고 JSON 으로 다시 내보내도 키가 없다(0 과 구분).
	old := `{"v":1,"jvm":{"ts":1,"heap_used":1,"threads":3}}`
	ob, err := Decode(strings.NewReader(old), false)
	if err != nil {
		t.Fatal(err)
	}
	if ob.JVM.ConnActive != nil || ob.JVM.ConnPeak != nil || ob.JVM.Pools != nil {
		t.Fatalf("old agent should have no pool fields: %+v", ob.JVM)
	}
	out, _ := json.Marshal(ob.JVM)
	if strings.Contains(string(out), "conn_") || strings.Contains(string(out), "pools") {
		t.Fatalf("absent fields leaked into JSON: %s", out)
	}
	// 실제 0 은 키가 남는다.
	z := `{"v":1,"jvm":{"ts":1,"conn_active":0,"conn_idle":0,"conn_max":0,"conn_wait":0}}`
	zb, _ := Decode(strings.NewReader(z), false)
	out, _ = json.Marshal(zb.JVM)
	if !strings.Contains(string(out), `"conn_active":0`) {
		t.Fatalf("zero must be kept: %s", out)
	}
}

func TestDecodeRejectsBadVersionAndJSON(t *testing.T) {
	if _, err := Decode(strings.NewReader(`{"v":2}`), false); err == nil {
		t.Fatal("want error for v=2")
	}
	if _, err := Decode(strings.NewReader(`not json`), false); err == nil {
		t.Fatal("want error")
	}
	if _, err := Decode(strings.NewReader(`{"v":1}`), true); err == nil {
		t.Fatal("want gzip error")
	}
}
