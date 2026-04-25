package auth

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"time"
)

type Config struct {
	BaseURL       string `json:"base_url"`
	AccessToken   string `json:"access_token"`
	RefreshToken  string `json:"refresh_token"`
	ExpiresAt     int64  `json:"expires_at"`
	SystemName    string `json:"system_name"`
	LastSessionID string `json:"last_session_id"`
}

func configPath() string {
	if p := os.Getenv("SYNAPSE_CONFIG"); p != "" {
		return p
	}
	if exe, err := os.Executable(); err == nil {
		return filepath.Join(filepath.Dir(exe), ".synapse_config.json")
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".synapse", "config.json")
}

func LoadConfig() (*Config, error) {
	data, err := os.ReadFile(configPath())
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func SaveConfig(cfg *Config) error {
	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		return err
	}
	return nil
}

func GetValidToken(cfg *Config) (string, error) {
	if cfg.AccessToken == "" {
		return "", fmt.Errorf("로그인이 필요합니다. 'synapse login'을 실행하세요")
	}
	if time.Now().Unix() < cfg.ExpiresAt-60 {
		return cfg.AccessToken, nil
	}
	if cfg.RefreshToken == "" {
		return "", fmt.Errorf("세션이 만료되었습니다. 'synapse login'으로 다시 로그인하세요")
	}

	newToken, err := refreshToken(cfg)
	if err != nil {
		// 갱신 실패 시 기존 토큰 반환 (서버가 거부하면 명확한 에러 발생)
		return cfg.AccessToken, nil
	}
	return newToken, nil
}

func refreshToken(cfg *Config) (string, error) {
	body, _ := json.Marshal(map[string]string{"refresh_token": cfg.RefreshToken})
	req, err := http.NewRequest("POST", cfg.BaseURL+"/api/v1/auth/refresh", bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Client", "cli")

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		return "", fmt.Errorf("refresh 실패: HTTP %d", resp.StatusCode)
	}

	var data struct {
		AccessToken string `json:"access_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return "", err
	}

	cfg.AccessToken = data.AccessToken
	cfg.ExpiresAt = time.Now().Unix() + 14*60
	_ = SaveConfig(cfg)
	return cfg.AccessToken, nil
}
