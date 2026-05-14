// Package server wires up the HTTP routes and handlers for the speedtest service.
package server

import (
	"io/fs"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"
)

// Config holds runtime configuration for the speedtest server.
type Config struct {
	Port             string `json:"-"`
	ServerLocation   string `json:"server_location"`
	TestDurationSec  int    `json:"test_duration_sec"`
	ParallelStreams  int    `json:"parallel_streams"`
	MaxDownloadBytes int64  `json:"max_download_bytes"`
	MaxUploadBytes   int64  `json:"max_upload_bytes"`
}

// Server is the HTTP entrypoint for the speedtest service.
type Server struct {
	cfg     Config
	logger  *slog.Logger
	handler http.Handler
}

// New constructs a Server with routes wired to the provided embedded web filesystem.
// A nil logger falls back to slog.Default().
func New(cfg Config, webRoot fs.FS, logger *slog.Logger) *Server {
	if logger == nil {
		logger = slog.Default()
	}

	s := &Server{cfg: cfg, logger: logger}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /ping", s.handlePing)
	mux.HandleFunc("GET /download", s.handleDownload)
	mux.HandleFunc("POST /upload", s.handleUpload)
	mux.HandleFunc("GET /config", s.handleConfig)
	mux.HandleFunc("GET /whoami", s.handleWhoami)
	mux.Handle("GET /", newPrecompressedFileHandler(webRoot))

	s.handler = withLogging(logger, withNoCache(mux))

	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.handler.ServeHTTP(w, r)
}

func withNoCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate")
		w.Header().Set("Pragma", "no-cache")
		next.ServeHTTP(w, r)
	})
}

type statusRecorder struct {
	http.ResponseWriter

	status int
}

func (sr *statusRecorder) WriteHeader(code int) {
	sr.status = code
	sr.ResponseWriter.WriteHeader(code)
}

// sanitizeForLog strips control characters that could be used for log forging.
var logUnsafe = strings.NewReplacer("\n", "", "\r", "", "\t", " ")

func sanitizeForLog(s string) string {
	if len(s) > 256 {
		s = s[:256]
	}

	return logUnsafe.Replace(s)
}

// precompressedVariant maps an Accept-Encoding token to the file suffix used
// at build time when producing pre-compressed asset variants.
type precompressedVariant struct {
	suffix   string
	encoding string
}

// precompressedVariants is ordered from most-preferred to least-preferred:
// brotli first (best ratio), gzip second (universal support).
var precompressedVariants = []precompressedVariant{
	{suffix: ".br", encoding: "br"},
	{suffix: ".gz", encoding: "gzip"},
}

// newPrecompressedFileHandler serves files from root, transparently substituting
// a pre-compressed variant (.br, .gz) when one exists and the client advertises
// support via Accept-Encoding. Falls back to the uncompressed file otherwise.
func newPrecompressedFileHandler(root fs.FS) http.Handler {
	fallback := http.FileServerFS(root)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Vary", "Accept-Encoding")

		assetPath := strings.TrimPrefix(r.URL.Path, "/")
		if assetPath == "" || strings.HasSuffix(r.URL.Path, "/") {
			assetPath = path.Join(assetPath, "index.html")
		}

		accept := r.Header.Get("Accept-Encoding")

		for _, v := range precompressedVariants {
			if !strings.Contains(accept, v.encoding) {
				continue
			}

			data, err := fs.ReadFile(root, assetPath+v.suffix)
			if err != nil {
				continue
			}

			contentType := mime.TypeByExtension(path.Ext(assetPath))
			if contentType == "" {
				contentType = "application/octet-stream"
			}

			h := w.Header()
			h.Set("Content-Type", contentType)
			h.Set("Content-Encoding", v.encoding)
			h.Set("Content-Length", strconv.Itoa(len(data)))

			//nolint:gosec // G705: data is read from the embedded asset FS, not user input.
			if _, err := w.Write(data); err != nil {
				return
			}

			return
		}

		fallback.ServeHTTP(w, r)
	})
}

func withLogging(logger *slog.Logger, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		sr := &statusRecorder{ResponseWriter: w, status: http.StatusOK}

		next.ServeHTTP(sr, r)

		method := sanitizeForLog(r.Method)
		urlPath := sanitizeForLog(r.URL.Path)

		level := slog.LevelDebug

		switch {
		case sr.status >= http.StatusInternalServerError:
			level = slog.LevelError
		case sr.status >= http.StatusBadRequest:
			level = slog.LevelWarn
		}

		logger.LogAttrs(
			r.Context(),
			level,
			"http",
			slog.String("method", method),
			slog.String("path", urlPath),
			slog.Int("status", sr.status),
			slog.Duration("duration", time.Since(start)),
		)
	})
}
