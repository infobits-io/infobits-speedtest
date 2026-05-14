package server

import (
	"bytes"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"testing/fstest"
)

func newTestServer(t *testing.T) *Server {
	t.Helper()

	cfg := Config{
		Port:             "0",
		TestDurationSec:  10,
		ParallelStreams:  4,
		MaxDownloadBytes: 64 * 1024 * 1024,
		MaxUploadBytes:   4 * 1024 * 1024,
	}

	webRoot := fstest.MapFS{
		"index.html": &fstest.MapFile{Data: []byte("<html></html>")},
	}

	logger := slog.New(slog.NewTextHandler(io.Discard, nil))

	return New(cfg, webRoot, logger)
}

func TestPing(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/ping", nil)

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if got := rec.Body.String(); got != "\n" {
		t.Errorf("body = %q, want %q", got, "\n")
	}

	if cc := rec.Header().Get("Cache-Control"); cc == "" {
		t.Error("missing Cache-Control header")
	}
}

func TestDownloadDefault(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/download", nil)

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusOK)
	}

	if got := int64(rec.Body.Len()); got != defaultDownloadBytes {
		t.Errorf("body len = %d, want %d", got, defaultDownloadBytes)
	}

	if ct := rec.Header().Get("Content-Type"); ct != "application/octet-stream" {
		t.Errorf("Content-Type = %q, want application/octet-stream", ct)
	}
}

func TestDownloadExactSize(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	sizes := []int64{1, 1024, 1024 * 1024}

	for _, size := range sizes {
		rec := httptest.NewRecorder()
		req := httptest.NewRequest(
			http.MethodGet,
			"/download?bytes="+strconv.FormatInt(size, 10),
			nil,
		)

		srv.ServeHTTP(rec, req)

		if rec.Code != http.StatusOK {
			t.Errorf("size=%d: status = %d", size, rec.Code)

			continue
		}

		if got := int64(rec.Body.Len()); got != size {
			t.Errorf("size=%d: body len = %d", size, got)
		}
	}
}

func TestDownloadClampedToMax(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/download?bytes=99999999999999", nil)

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	if got := int64(rec.Body.Len()); got != srv.cfg.MaxDownloadBytes {
		t.Errorf("body len = %d, want %d (clamped to max)", got, srv.cfg.MaxDownloadBytes)
	}
}

func TestDownloadAllZeros(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/download?bytes=4096", nil)

	srv.ServeHTTP(rec, req)

	body := rec.Body.Bytes()

	if len(body) != 4096 {
		t.Fatalf("len = %d", len(body))
	}

	for i, b := range body {
		if b != 0 {
			t.Fatalf("byte %d = %d, want 0", i, b)
		}
	}
}

func TestUploadDiscardsAndReportsSize(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	payload := bytes.Repeat([]byte("x"), 1024*64)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/upload", bytes.NewReader(payload))

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var resp uploadResponse

	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if resp.Bytes != int64(len(payload)) {
		t.Errorf("bytes = %d, want %d", resp.Bytes, len(payload))
	}
}

func TestUploadTooLarge(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	body := strings.NewReader(strings.Repeat("y", int(srv.cfg.MaxUploadBytes)+1))

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/upload", body)

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Errorf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestConfigReturnsJSON(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/config", nil)

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var got Config

	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got.TestDurationSec != 10 || got.ParallelStreams != 4 {
		t.Errorf("config = %+v", got)
	}
}

func TestWhoamiUsesRemoteAddr(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/whoami", nil)
	req.RemoteAddr = "203.0.113.42:55555"

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	var got whoamiResponse

	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got.IP != "203.0.113.42" {
		t.Errorf("ip = %q, want 203.0.113.42", got.IP)
	}
}

func TestWhoamiPrefersForwardedFor(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/whoami", nil)
	req.RemoteAddr = "10.0.0.1:55555"
	req.Header.Set("X-Forwarded-For", "198.51.100.7, 10.0.0.1")

	srv.ServeHTTP(rec, req)

	var got whoamiResponse

	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("decode: %v", err)
	}

	if got.IP != "198.51.100.7" {
		t.Errorf("ip = %q, want 198.51.100.7 (first XFF entry)", got.IP)
	}
}

func TestIndexServedAtRoot(t *testing.T) {
	t.Parallel()

	srv := newTestServer(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d", rec.Code)
	}

	body, _ := io.ReadAll(rec.Body)
	if !strings.Contains(string(body), "<html>") {
		t.Errorf("body did not contain <html>: %q", body)
	}
}
