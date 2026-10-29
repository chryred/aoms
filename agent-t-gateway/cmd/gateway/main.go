package main

import (
	"context"
	"log"
	"net/http"
	"os/signal"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"synapse/agent-t-gateway/internal/config"
	"synapse/agent-t-gateway/internal/ingest"
	"synapse/agent-t-gateway/internal/live"
	"synapse/agent-t-gateway/internal/promrw"
	"synapse/agent-t-gateway/internal/registry"
	"synapse/agent-t-gateway/internal/store"
)

func main() {
	cfg := config.Load()
	if cfg.SecretKey == "" {
		log.Fatal("SECRET_KEY is required (verifies admin-api user JWTs for /t/v1/stream)")
	}
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.PGDSN)
	if err != nil {
		log.Fatalf("pg: %v", err)
	}
	defer pool.Close()
	reg := registry.New(registry.PGStore{Pool: pool})
	go reg.Run(ctx)

	writer := store.NewWriter(store.Config{
		URL: cfg.ClickHouseURL, DB: cfg.ClickHouseDB, User: cfg.ClickHouseUser, Password: cfg.ClickHousePassword,
		FlushInterval: cfg.FlushInterval, FlushRows: cfg.FlushRows, MaxQueueBytes: cfg.CHQueueMaxBytes,
	}, nil)
	commands := store.NewCommands(store.PGCommandStore{Pool: pool})
	writer.Dumps = commands
	// Writer and commands outlive the HTTP server so in-flight requests finish first.
	bgCtx, stopBg := context.WithCancel(context.Background())
	defer stopBg()
	go commands.Run(bgCtx)
	writerDone := make(chan struct{})
	go func() { writer.Run(bgCtx); close(writerDone) }() // final flush on cancel

	hub := live.NewHub()
	liveState := live.NewState(hub)
	if cfg.PrometheusRemoteWrite == "" {
		log.Print("PROMETHEUS_REMOTE_WRITE_URL is empty: Prometheus remote write disabled")
	} else {
		rw := promrw.NewWriter(cfg.PrometheusRemoteWrite)
		liveState.OnAgg = rw.Hook
		go rw.Run(bgCtx)
	}
	go liveState.Run(bgCtx)
	liveAPI := &live.API{State: liveState, Hub: hub, Secret: []byte(cfg.SecretKey)}

	mux := http.NewServeMux()
	mux.HandleFunc("/t/v1/stream", liveAPI.Stream)
	mux.HandleFunc("/t/v1/snapshot", liveAPI.Snapshot)
	mux.Handle("/t/v1/batch", &ingest.Handler{
		Registry: reg, Sink: ingest.MultiSink{writer, liveState}, Commands: commands, Dict: store.NewDict(writer, store.DefaultDictCapacity),
		Back: writer, Skew: ingest.NewSkew(), Now: time.Now,
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	srv := &http.Server{Addr: cfg.Listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	log.Printf("agent-t-gateway listening on %s", cfg.Listen)
	go func() {
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatal(err)
		}
	}()

	<-ctx.Done()
	// 1) stop accepting and wait for handlers, 2) final ClickHouse flush,
	// 3) last command sync so dumps inserted in the final flush become 'done'.
	sc, c := context.WithTimeout(context.Background(), 5*time.Second)
	_ = srv.Shutdown(sc)
	c()
	stopBg()
	<-writerDone
	fc, fcancel := context.WithTimeout(context.Background(), 5*time.Second)
	commands.Sync(fc)
	fcancel()
}
