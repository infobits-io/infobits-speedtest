# Variables
IMAGE_NAME = ghcr.io/infobits-io/infobits-speedtest
VERSION = $(shell git describe --tags --always --dirty || echo "dev")
DOCKER_BUILDKIT = 1

.PHONY: build run clean push all login help

# Build the Go application
build:
	@echo "Building Go application..."
	go build -o speedtest .

# Build the Docker image
docker-build:
	@echo "Building Docker image..."
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker build -t $(IMAGE_NAME):$(VERSION) -t $(IMAGE_NAME):latest .

# Run the application locally
run: build
	@echo "Running application locally..."
	./speedtest -port 8080

# Run the Docker container locally
docker-run:
	@echo "Running Docker container locally..."
	docker run -p 8080:8080 $(IMAGE_NAME):latest

# Clean up build artifacts
clean:
	@echo "Cleaning up build artifacts..."
	rm -f speedtest
	go clean

# Clean up Docker resources
docker-clean:
	@echo "Cleaning up Docker resources..."
	docker rmi $(IMAGE_NAME):$(VERSION) $(IMAGE_NAME):latest || true

# Push the Docker image to GitHub Container Registry
push:
	@echo "Pushing Docker image to GitHub Container Registry..."
	docker push $(IMAGE_NAME):$(VERSION)
	docker push $(IMAGE_NAME):latest

# Login to GitHub Container Registry
login:
	@echo "Logging in to GitHub Container Registry..."
	docker login ghcr.io

# Build and push the image
all: docker-build push

# Help command
help:
	@echo "Available commands:"
	@echo "  make build        - Build the Go application"
	@echo "  make docker-build - Build the Docker image"
	@echo "  make run          - Run the application locally"
	@echo "  make docker-run   - Run the container locally"
	@echo "  make clean        - Clean up build artifacts"
	@echo "  make docker-clean - Clean up Docker resources"
	@echo "  make push         - Push the image to GitHub Container Registry"
	@echo "  make login        - Login to GitHub Container Registry"
	@echo "  make all          - Build and push the image"
	@echo "  make help         - Show this help message"