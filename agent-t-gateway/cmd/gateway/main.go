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
	"synapse/agent-t-gateway/internal/protocol"
	"synapse/agent-t-gateway/internal/registry"
)

// No-op implementations until B2 (sink/backpressure) and B3 (commands/dict) land.
type noopSink struct{}

func (noopSink) Accept(registry.Instance, *protocol.Batch, int64) {}

type noopCommands struct{}

func (noopCommands) Pending(int64) []protocol.Command { return nil }
func (noopCommands) Done(int64, bool)                 {}

type noopDict struct{}

func (noopDict) Missing(string, []string) []string { return nil }
func (noopDict) Put(string, string, string)        {}

type noopBackpressure struct{}

func (noopBackpressure) BackoffMs() int { return 0 }

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

	mux := http.NewServeMux()
	mux.Handle("/t/v1/batch", &ingest.Handler{
		Registry: reg, Sink: noopSink{}, Commands: noopCommands{}, Dict: noopDict{},
		Back: noopBackpressure{}, Skew: ingest.NewSkew(), Now: time.Now,
	})
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.Write([]byte("ok")) })

	srv := &http.Server{Addr: cfg.Listen, Handler: mux, ReadHeaderTimeout: 10 * time.Second}
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
}
