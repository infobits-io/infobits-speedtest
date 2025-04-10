FROM golang:1.22-alpine AS builder

WORKDIR /app

# Copy go module files
COPY go.mod go.sum* ./

# Download dependencies if go.sum exists
RUN if [ -f go.sum ]; then go mod download; fi

# Copy source code
COPY . .

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -a -installsuffix cgo -o speedtest .

# Use a small image for the final container
FROM alpine:latest

WORKDIR /app

# Copy the binary from the builder stage
COPY --from=builder /app/speedtest .

# Copy static files
COPY --from=builder /app/static ./static

# Expose port
EXPOSE 8080

# Run the application
ENTRYPOINT ["./speedtest"]
CMD ["-port", "8080"]