# Infobits Speed Test

A modern internet speed test application built with Go and vanilla HTML/CSS/JavaScript.

## Features

- **Accurate** download speed measurement with warm-up phase and statistical methods
- **Reliable** upload speed testing with TCP optimization
- **Precise** latency (ping) and jitter measurement
- Responsive design for all devices
- Real-time progress indicators

## How It Works

This speed test uses advanced measurement techniques for accurate results:

1. **Connection Warm-up**: Initial connection warm-up phase to establish stable connection
2. **Statistical Analysis**: Uses median values and outlier removal for more reliable results
3. **TCP Optimization**: Optimizes buffer sizes for more consistent measurements 
4. **Server-side Timing**: Uses server-side timing for upload measurement when possible

## GitHub Container Registry

This project uses GitHub Actions to automatically build and publish Docker images to GitHub Container Registry.

### Using the pre-built image

```bash
# Pull the latest image
docker pull ghcr.io/infobits-io/infobits-speedtest:latest

# Run the container
docker run -p 8080:8080 ghcr.io/infobits-io/infobits-speedtest:latest
```

Or in a docker-compose.yml file:

```yaml
version: '3'

services:
  speedtest:
    image: ghcr.io/infobits-io/infobits-speedtest:latest
    ports:
      - "8080:8080"
    restart: unless-stopped
```

## Docker Setup (Local Build)

### Using Docker Compose

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infobits-speedtest
   ```

2. Build and start the container:
   ```bash
   docker-compose up -d
   ```

3. Access the application at `http://localhost:8080`

### Manual Docker Build

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infobits-speedtest
   ```

2. Build the Docker image:
   ```bash
   docker build -t infobits-speedtest .
   ```

3. Run the container:
   ```bash
   docker run -p 8080:8080 infobits-speedtest
   ```

4. Access the application at `http://localhost:8080`

## Development Setup

### Prerequisites

- Go 1.21 or later

### Installation

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd infobits-speedtest
   ```

2. Build the application:
   ```bash
   go build -o speedtest .
   ```

3. Run the application:
   ```bash
   ./speedtest
   ```

4. Access the application at `http://localhost:8080`

## Makefile Commands

The project includes a Makefile for common operations:

```bash
# Build the Go application
make build

# Run the application locally
make run

# Build the Docker image
make docker-build

# Run the Docker container
make docker-run

# Clean up build artifacts
make clean

# Show all available commands
make help
```

## Speed Test Algorithm

The speed test follows this process:

1. **Latency Test**: 
   - Sends multiple ping requests and calculates average latency
   - Measures variation to calculate jitter

2. **Download Test**:
   - Establishes initial connection and warms up TCP window
   - Streams optimized data chunks with proper buffer sizes
   - Uses statistical smoothing to eliminate outliers
   - Takes median of measurements for final result

3. **Upload Test**:
   - Sends data chunks in optimal sizes for TCP performance
   - Measures server-side processing time when available
   - Uses outlier elimination and statistical averaging
   - Calculates median speed for final result

## License

MIT