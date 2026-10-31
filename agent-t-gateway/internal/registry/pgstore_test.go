package registry

import "testing"

func TestParseLabelValidObject(t *testing.T) {
	f, ok := parseLabel(`{"instance_role":"was1","agent_token_sha256":"abc","tx_slow_threshold_ms":5000,"enabled":false}`)
	if !ok || f.instanceRole != "was1" || f.tokenSHA256 != "abc" || f.slowMs != "5000" || f.enabled != "false" {
		t.Fatalf("ok=%v f=%+v", ok, f)
	}
}

func TestParseLabelRejectsNonObjects(t *testing.T) {
	for _, raw := range []string{`not json`, `[1,2]`, `"str"`, `null`, `{"a":`} {
		if _, ok := parseLabel(raw); ok {
			t.Errorf("%q must be rejected", raw)
		}
	}
}

func TestParseLabelMissingFieldsEmpty(t *testing.T) {
	f, ok := parseLabel(`{}`)
	if !ok || f != (labelFields{}) {
		t.Fatalf("ok=%v f=%+v", ok, f)
	}
}
