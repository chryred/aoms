// Package config loads gateway settings from environment variables.
package config

import (
	"os"
	"strconv"
	"time"
)

type Config struct {
	Listen                string
	PGDSN                 string
	SecretKey             string
	ClickHouseURL         string
	ClickHouseDB          string
	ClickHouseUser        string
	ClickHousePassword    string
	PrometheusRemoteWrite string
	FlushInterval         time.Duration
	FlushRows             int
	CHQueueMaxBytes       int64
}

func Load() Config {
	return Config{
		Listen:                str("GATEWAY_LISTEN", ":8330"),
		PGDSN:                 str("GATEWAY_PG_DSN", ""),
		SecretKey:             str("SECRET_KEY", ""),
		ClickHouseURL:         str("CLICKHOUSE_URL", ""),
		ClickHouseDB:          str("CLICKHOUSE_DB", "agent_t"),
		ClickHouseUser:        str("CLICKHOUSE_USER", ""),
		ClickHousePassword:    str("CLICKHOUSE_PASSWORD", ""),
		PrometheusRemoteWrite: str("PROMETHEUS_REMOTE_WRITE_URL", ""),
		FlushInterval:         dur("GATEWAY_FLUSH_INTERVAL", time.Second),
		FlushRows:             int(num("GATEWAY_FLUSH_ROWS", 10000)),
		CHQueueMaxBytes:       num("GATEWAY_CH_QUEUE_MAX_BYTES", 268435456),
	}
}

func str(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func num(k string, def int64) int64 {
	if v, err := strconv.ParseInt(os.Getenv(k), 10, 64); err == nil {
		return v
	}
	return def
}

func dur(k string, def time.Duration) time.Duration {
	if v, err := time.ParseDuration(os.Getenv(k)); err == nil {
		return v
	}
	return def
}
