package live

import (
	"testing"
	"time"
)

func TestVerifyJWT(t *testing.T) {
	now := time.Now()
	cases := []struct {
		name string
		tok  string
		ok   bool
	}{
		{"valid", mkToken(testSecret, "HS256", "access", now.Add(time.Hour)), true},
		{"expired", mkToken(testSecret, "HS256", "access", now.Add(-time.Minute)), false},
		{"wrong secret", mkToken([]byte("x"), "HS256", "access", now.Add(time.Hour)), false},
		{"refresh type", mkToken(testSecret, "HS256", "refresh", now.Add(time.Hour)), false},
		{"alg none", mkToken(testSecret, "none", "access", now.Add(time.Hour)), false},
		{"garbage", "a.b", false},
	}
	for _, c := range cases {
		if got := VerifyJWT(c.tok, testSecret, now) == nil; got != c.ok {
			t.Errorf("%s: got %v want %v", c.name, got, c.ok)
		}
	}
}
