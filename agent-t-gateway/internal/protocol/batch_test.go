package protocol

import (
	"bytes"
	"compress/gzip"
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
	if b.JVM == nil || b.Dict.SQL["1122334455667788"] == "" || *b.Active.Top[0].SQLID != "1122334455667788" {
		t.Fatal("fields not decoded")
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
