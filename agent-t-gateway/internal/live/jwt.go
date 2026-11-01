package live

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

var errToken = errors.New("invalid token")

// VerifyJWT validates an admin-api access token (HS256, type=="access", unexpired).
func VerifyJWT(token string, secret []byte, now time.Time) error {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return errToken
	}
	hb, err := base64.RawURLEncoding.DecodeString(parts[0])
	if err != nil {
		return errToken
	}
	var hdr struct {
		Alg string `json:"alg"`
	}
	if json.Unmarshal(hb, &hdr) != nil || hdr.Alg != "HS256" {
		return errToken
	}
	sig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return errToken
	}
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return errToken
	}
	pb, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return errToken
	}
	var claims struct {
		Type string   `json:"type"`
		Exp  *float64 `json:"exp"`
	}
	if json.Unmarshal(pb, &claims) != nil || claims.Type != "access" || claims.Exp == nil {
		return errToken
	}
	if float64(now.Unix()) >= *claims.Exp {
		return errToken
	}
	return nil
}
