package server

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"
)

const (
	defaultDownloadBytes = int64(25 * 1024 * 1024)
	downloadChunkSize    = 256 * 1024
)

// downloadChunk is a reusable zero-filled buffer streamed to clients.
// It is read-only after package init by the runtime (Go zeroes new slices),
// and never mutated, so concurrent reads are safe.
var downloadChunk = make([]byte, downloadChunkSize)

// uploadResponse is returned by the /upload endpoint after the body is drained.
type uploadResponse struct {
	Bytes      int64 `json:"bytes"`
	DurationMS int64 `json:"duration_ms"`
}

// whoamiResponse is returned by the /whoami endpoint.
type whoamiResponse struct {
	IP string `json:"ip"`
}

func (s *Server) handlePing(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.Header().Set("Content-Length", "1")

	if _, err := w.Write([]byte("\n")); err != nil {
		return
	}
}

func (s *Server) handleConfig(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(s.cfg); err != nil {
		http.Error(w, "encode failed", http.StatusInternalServerError)

		return
	}
}

func (s *Server) handleWhoami(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(whoamiResponse{IP: clientIP(r)}); err != nil {
		return
	}
}

func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if before, _, ok := strings.Cut(xff, ","); ok {
			return strings.TrimSpace(before)
		}

		return strings.TrimSpace(xff)
	}

	if rip := r.Header.Get("X-Real-IP"); rip != "" {
		return strings.TrimSpace(rip)
	}

	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}

	return host
}

func (s *Server) handleDownload(w http.ResponseWriter, r *http.Request) {
	n := max(min(parseBytesParam(r.URL.Query().Get("bytes"), defaultDownloadBytes), s.cfg.MaxDownloadBytes), 0)

	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.FormatInt(n, 10))
	w.WriteHeader(http.StatusOK)

	var flusher http.Flusher
	if f, ok := w.(http.Flusher); ok {
		flusher = f
	}

	if err := writeZeros(r.Context(), w, n, flusher); err != nil {
		return
	}
}

func (s *Server) handleUpload(w http.ResponseWriter, r *http.Request) {
	start := time.Now()

	limited := http.MaxBytesReader(w, r.Body, s.cfg.MaxUploadBytes)

	n, err := io.Copy(io.Discard, limited)
	if err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			http.Error(w, "upload too large", http.StatusRequestEntityTooLarge)

			return
		}

		http.Error(w, "upload read failed", http.StatusBadRequest)

		return
	}

	duration := time.Since(start)
	resp := uploadResponse{
		Bytes:      n,
		DurationMS: duration.Milliseconds(),
	}

	w.Header().Set("Content-Type", "application/json")

	if err := json.NewEncoder(w).Encode(resp); err != nil {
		return
	}
}

func parseBytesParam(s string, fallback int64) int64 {
	if s == "" {
		return fallback
	}

	n, err := strconv.ParseInt(s, 10, 64)
	if err != nil || n <= 0 {
		return fallback
	}

	return n
}

// writeZeros streams n zero bytes to w using a reusable buffer, honoring ctx cancellation.
// The optional flusher is invoked after each chunk so clients see continuous progress
// even when the response is buffered.
func writeZeros(ctx context.Context, w io.Writer, n int64, flusher http.Flusher) error {
	var written int64

	for written < n {
		if err := ctx.Err(); err != nil {
			return err
		}

		remaining := n - written
		chunk := downloadChunk

		if remaining < int64(len(chunk)) {
			chunk = chunk[:remaining]
		}

		m, err := w.Write(chunk)
		written += int64(m)

		if err != nil {
			return err
		}

		if flusher != nil {
			flusher.Flush()
		}
	}

	return nil
}
