package main

import (
	"crypto/rand"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"time"
)

// Configuration
const (
	maxFileSize       = 500 * 1024 * 1024 // 500 MB max file size
	fixedDownloadSize = 32 * 1024 * 1024  // Fixed 32 MB download size
	fixedUploadSize   = 32 * 1024 * 1024  // Fixed 32 MB upload size (changed from 500 bytes)
)

// Initialize logger
var logger = log.New(os.Stdout, "[SPEEDTEST] ", log.LstdFlags)

func main() {
	// Parse command-line flags
	port := flag.Int("port", 8080, "Port to serve on")
	flag.Parse()

	http.HandleFunc("/", serveHome)
	http.HandleFunc("/ping", handlePing)
	http.HandleFunc("/testfile", handleTestFile)
	http.HandleFunc("/upload", handleUpload)

	// Set up static file serving
	fs := http.FileServer(http.Dir("static"))
	http.Handle("/static/", http.StripPrefix("/static/", fs))

	// Start the server
	addr := fmt.Sprintf(":%d", *port)
	logger.Printf("Starting server on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

// serveHome serves the home page
func serveHome(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, "static/index.html")
}

// handlePing responds to ping requests to measure latency
func handlePing(w http.ResponseWriter, r *http.Request) {
	// Set headers to prevent caching
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Just return 200 OK with no content for ping test
	w.WriteHeader(http.StatusOK)
}

// handleTestFile generates and streams random data for the download test
func handleTestFile(w http.ResponseWriter, r *http.Request) {
	// Always use fixed download size of 32MB, ignore any size parameter
	size := fixedDownloadSize

	// Check if we need to throttle for testing purposes
	throttleStr := r.URL.Query().Get("throttle")
	var throttleKBps int = 0 // No throttling by default

	if throttleStr != "" {
		parsedThrottle, err := strconv.Atoi(throttleStr)
		if err == nil && parsedThrottle > 0 {
			throttleKBps = parsedThrottle
			logger.Printf("Throttling download to %d KBps", throttleKBps)
		}
	}

	// Set appropriate headers
	w.Header().Set("Content-Type", "application/octet-stream")
	w.Header().Set("Content-Length", strconv.Itoa(size))
	w.Header().Set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
	w.Header().Set("Pragma", "no-cache")
	w.Header().Set("Expires", "0")

	// Create a buffer for sending data in chunks
	chunkSize := 64 * 1024 // 64KB chunks for efficient streaming
	buffer := make([]byte, chunkSize)

	// Pre-fill buffer with random data to avoid regenerating it for each chunk
	_, err := rand.Read(buffer)
	if err != nil {
		logger.Printf("Error generating random data: %v", err)
		http.Error(w, "Error generating test data", http.StatusInternalServerError)
		return
	}

	// Stream random data
	bytesRemaining := size
	startTime := time.Now()

	for bytesRemaining > 0 {
		currentChunkSize := int(math.Min(float64(chunkSize), float64(bytesRemaining)))

		// Write the chunk to the response
		_, err := w.Write(buffer[:currentChunkSize])
		if err != nil {
			// Client probably disconnected, that's OK
			logger.Printf("Error writing response: %v", err)
			return
		}

		bytesRemaining -= currentChunkSize

		// Flush to ensure data is sent immediately
		if f, ok := w.(http.Flusher); ok {
			f.Flush()
		}

		// Apply throttling if requested
		if throttleKBps > 0 {
			// Calculate how long this chunk should take to send at the throttled rate
			elapsed := time.Since(startTime).Milliseconds()
			expectedTime := int64((size - bytesRemaining) * 1000 / (throttleKBps * 1024))

			if elapsed < expectedTime {
				// Sleep to maintain the throttled rate
				time.Sleep(time.Duration(expectedTime-elapsed) * time.Millisecond)
			}
		}
	}
}

// handleUpload processes upload requests for the upload speed test
func handleUpload(w http.ResponseWriter, r *http.Request) {
	if r.Method != "POST" {
		http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// For upload test, we use the same size as download (32MB)
	r.Body = http.MaxBytesReader(w, r.Body, maxFileSize)

	// Check if we need to simulate latency for more accurate testing
	simulateLatencyStr := r.URL.Query().Get("latency")
	var simulateLatencyMs int = 0

	if simulateLatencyStr != "" {
		parsedLatency, err := strconv.Atoi(simulateLatencyStr)
		if err == nil && parsedLatency > 0 {
			simulateLatencyMs = parsedLatency
		}
	}

	// Check if throttling is requested
	throttleStr := r.URL.Query().Get("throttle")
	var throttleKBps int = 0

	if throttleStr != "" {
		parsedThrottle, err := strconv.Atoi(throttleStr)
		if err == nil && parsedThrottle > 0 {
			throttleKBps = parsedThrottle
		}
	}

	// Start timing the upload
	startTime := time.Now()

	// Create a rate-limited reader if throttling is requested
	var reader io.Reader = r.Body
	if throttleKBps > 0 {
		// Implement a simple rate-limiting reader
		bytesPerSecond := throttleKBps * 1024
		reader = &throttledReader{
			r:              r.Body,
			bytesPerSecond: bytesPerSecond,
			lastRead:       time.Now(),
			bytesRead:      0,
		}
	}

	// Read the uploaded data (using the fixed size)
	var byteCount int64
	buffer := make([]byte, 8192) // Use a reasonable buffer size
	totalRead := int64(0)

	for {
		n, err := reader.Read(buffer)
		if err != nil && err != io.EOF {
			logger.Printf("Error reading upload data: %v", err)
			http.Error(w, "Upload failed", http.StatusInternalServerError)
			return
		}

		totalRead += int64(n)

		// For the test, we count up to fixedUploadSize bytes
		if totalRead <= int64(fixedUploadSize) {
			byteCount = totalRead
		} else {
			byteCount = int64(fixedUploadSize)
		}

		if err == io.EOF {
			break
		}
	}

	// Simulate additional latency if requested
	if simulateLatencyMs > 0 {
		time.Sleep(time.Duration(simulateLatencyMs) * time.Millisecond)
	}

	// Calculate upload duration
	duration := time.Since(startTime).Seconds()

	// Send response with upload information
	w.Header().Set("Content-Type", "application/json")
	response := map[string]interface{}{
		"success":  true,
		"size":     byteCount,
		"duration": duration,
	}

	json.NewEncoder(w).Encode(response)
}

// throttledReader implements a rate-limited reader
type throttledReader struct {
	r              io.Reader
	bytesPerSecond int
	lastRead       time.Time
	bytesRead      int
}

func (t *throttledReader) Read(p []byte) (n int, err error) {
	n, err = t.r.Read(p)
	t.bytesRead += n

	// Calculate expected time for bytes read so far
	expectedDuration := time.Duration(float64(t.bytesRead) / float64(t.bytesPerSecond) * float64(time.Second))
	actualDuration := time.Since(t.lastRead)

	// If we're reading too fast, sleep to maintain the rate limit
	if actualDuration < expectedDuration {
		time.Sleep(expectedDuration - actualDuration)
	}

	return n, err
}

// ensureDir makes sure a directory exists, creating it if necessary
func ensureDir(dir string) error {
	return os.MkdirAll(dir, 0755)
}

// init function to ensure necessary directories exist at startup
func init() {
	// Ensure static directory exists
	staticDir := filepath.Join(".", "static")
	if err := ensureDir(staticDir); err != nil {
		log.Fatalf("Failed to create static directory: %v", err)
	}
}
