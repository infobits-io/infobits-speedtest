# Variables
IMAGE_NAME = ghcr.io/infobits-io/speedtest
VERSION = $(shell git describe --tags --always --dirty)
DOCKER_BUILDKIT = 1

.PHONY: build push run clean

# Build the Docker image
build:
	@echo "Building Docker image..."
	DOCKER_BUILDKIT=$(DOCKER_BUILDKIT) docker build -t $(IMAGE_NAME):$(VERSION) -t $(IMAGE_NAME):latest .

# Push the Docker image to GitHub Container Registry
push:
	@echo "Pushing Docker image to GitHub Container Registry..."
	docker push $(IMAGE_NAME):$(VERSION)
	docker push $(IMAGE_NAME):latest

# Run the container locally
run:
	@echo "Running container locally..."
	docker run -p 3000:3000 $(IMAGE_NAME):latest

# Clean up Docker resources
clean:
	@echo "Cleaning up Docker resources..."
	docker rmi $(IMAGE_NAME):$(VERSION) $(IMAGE_NAME):latest || true

# Login to GitHub Container Registry
login:
	@echo "Logging in to GitHub Container Registry..."
	docker login ghcr.io

# Build and push the image
all: build push

# Help command
help:
	@echo "Available commands:"
	@echo "  make build    - Build the Docker image"
	@echo "  make push     - Push the image to GitHub Container Registry"
	@echo "  make run      - Run the container locally"
	@echo "  make clean    - Clean up Docker resources"
	@echo "  make login    - Login to GitHub Container Registry"
	@echo "  make all      - Build and push the image"
	@echo "  make help     - Show this help message" 