package ingest

import "testing"

func TestClockSkewCorrection(t *testing.T) {
	s := NewSkew()
	now := int64(1_800_000_000_000)
	if off := s.Correct("a", now+300_000, now); off != -300_000 {
		t.Fatalf("offset=%d", off)
	}
	if off := s.Correct("a", now-1000, now); off != 0 {
		t.Fatalf("1s diff offset=%d", off)
	}
	// EWMA smooths after a reset-free sequence
	s.Correct("b", now+300_000, now)
	off := s.Correct("b", now+310_000, now)
	if off >= -300_000 || off <= -310_000 {
		t.Fatalf("ewma offset=%d", off)
	}
}
