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
	"synapse/agent-t-gateway/internal/registry"
	"synapse/agent-t-gateway/internal/store"
)

func main() {
	cfg := config.Load()
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
	go commands.Run(ctx)
	writerDone := make(chan struct{})
	go func() { writer.Run(ctx); close(writerDone) }() // final flush on shutdown

	mux := http.NewServeMux()
	mux.Handle("/t/v1/batch", &ingest.Handler{
		Registry: reg, Sink: writer, Commands: commands, Dict: store.NewDict(writer, store.DefaultDictCapacity),
		Back: writer, Skew: ingest.NewSkew(), Now: time.Now,
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	srv := &http.Server{Addr: cfg.Listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout: 30 * time.Second, IdleTimeout: 120 * time.Second}
	go func() {
		<-ctx.Done()
		sc, c := context.WithTimeout(context.Background(), 5*time.Second)
		defer c()
		_ = srv.Shutdown(sc)
	}()
	log.Printf("agent-t-gateway listening on %s", cfg.Listen)
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
	<-writerDone
}
