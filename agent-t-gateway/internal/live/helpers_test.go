package live

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

var testInst = registry.Instance{AgentID: 1, SystemID: 7, InstanceRole: "was1", SlowMs: 3000}

var testSecret = []byte("test-secret")

func mkToken(secret []byte, alg, typ string, exp time.Time) string {
	enc := base64.RawURLEncoding.EncodeToString
	h, _ := json.Marshal(map[string]string{"alg": alg, "typ": "JWT"})
	p, _ := json.Marshal(map[string]any{"sub": "1", "type": typ, "exp": exp.Unix()})
	in := enc(h) + "." + enc(p)
	m := hmac.New(sha256.New, secret)
	m.Write([]byte(in))
	return in + "." + enc(m.Sum(nil))
}

func batchWith(n, errs, slow int) *protocol.Batch {
	b := &protocol.Batch{V: 1, Active: protocol.Active{Buckets: [3]int64{3, 1, 0}}}
	for i := 0; i < n; i++ {
		t := protocol.Tx{TraceID: fmt.Sprintf("t%d", i), SpanID: "s", StartTs: 1000, ElapsedMs: 100, URIID: "u1"}
		if i < errs {
			t.Error = true
		}
		if i >= n-slow {
			t.ElapsedMs = 4000
		}
		b.Tx = append(b.Tx, t)
	}
	return b
}
