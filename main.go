// Package main is the entrypoint for the infobits-speedtest server.
package main

import (
	"context"
	"embed"
	"errors"
	"io/fs"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/infobits-io/infobits-speedtest/internal/server"
)

//go:embed web
var webFS embed.FS

func main() {
	logger := newLogger(getEnv("LOG_FORMAT", "text"), getEnv("LOG_LEVEL", "info"))
	slog.SetDefault(logger)

	cfg := server.Config{
		Port:             getEnv("PORT", "8080"),
		ServerLocation:   getEnv("SERVER_LOCATION", ""),
		TestDurationSec:  getEnvInt("TEST_DURATION_SEC", 10),
		ParallelStreams:  getEnvInt("PARALLEL_STREAMS", 4),
		MaxDownloadBytes: getEnvInt64("MAX_DOWNLOAD_BYTES", 1<<32),
		MaxUploadBytes:   getEnvInt64("MAX_UPLOAD_BYTES", 1<<32),
	}

	webRoot, err := fs.Sub(webFS, "web")
	if err != nil {
		logger.Error("embed sub failed", slog.Any("err", err))
		os.Exit(1)
	}

	srv := server.New(cfg, webRoot, logger)

	httpSrv := &http.Server{
		Addr:              ":" + cfg.Port,
		Handler:           srv,
		ReadHeaderTimeout: 10 * time.Second,
		IdleTimeout:       120 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	serverErr := make(chan error, 1)

	go func() {
		logger.Info("listening", slog.String("addr", httpSrv.Addr))

		if err := httpSrv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			serverErr <- err
		}

		close(serverErr)
	}()

	select {
	case <-ctx.Done():
		logger.Info("shutdown signal received")
	case err := <-serverErr:
		if err != nil {
			logger.Error("server failed", slog.Any("err", err))
			os.Exit(1)
		}
	}

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := httpSrv.Shutdown(shutdownCtx); err != nil {
		logger.Error("graceful shutdown failed", slog.Any("err", err))
		os.Exit(1)
	}
}

func newLogger(format, levelStr string) *slog.Logger {
	var level slog.Level

	switch strings.ToLower(levelStr) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	default:
		level = slog.LevelInfo
	}

	opts := &slog.HandlerOptions{Level: level}

	var handler slog.Handler
	if strings.EqualFold(format, "json") {
		handler = slog.NewJSONHandler(os.Stdout, opts)
	} else {
		handler = slog.NewTextHandler(os.Stdout, opts)
	}

	return slog.New(handler)
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}

	return fallback
}

func getEnvInt(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}

	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}

	return n
}

func getEnvInt64(key string, fallback int64) int64 {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}

	n, err := strconv.ParseInt(v, 10, 64)
	if err != nil {
		return fallback
	}

	return n
}
