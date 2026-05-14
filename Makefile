BINARY      := speedtest
IMAGE       := infobits-speedtest:latest
PORT        ?= 8080
SERVER_LOCATION ?= localhost

GO          ?= go
DOCKER      ?= docker
COMPOSE     ?= docker compose

GO_FILES    := $(shell find . -name '*.go' -not -path './vendor/*')

.DEFAULT_GOAL := help

## help: List available targets.
.PHONY: help
help:
	@awk 'BEGIN{FS=":.*## "; printf "\nUsage: make \033[36m<target>\033[0m\n\nTargets:\n"} \
	/^## / { sub(/^## /, ""); split($$0, a, ": "); printf "  \033[36m%-18s\033[0m %s\n", a[1], a[2] } \
	' $(MAKEFILE_LIST)

## run: Run the server locally (go run).
.PHONY: run
run:
	PORT=$(PORT) SERVER_LOCATION="$(SERVER_LOCATION)" $(GO) run .

## dev: Alias for run.
.PHONY: dev
dev: run

## build: Build a local static binary into ./speedtest.
.PHONY: build
build:
	CGO_ENABLED=0 $(GO) build -trimpath -ldflags="-s -w" -o $(BINARY) ./

## test: Run all tests with the race detector.
.PHONY: test
test:
	$(GO) test -race ./...

## lint: Run golangci-lint (auto-fix enabled via config).
.PHONY: lint
lint:
	golangci-lint run ./...

## fmt: Format Go files with gofumpt + goimports via golangci-lint formatters.
.PHONY: fmt
fmt:
	golangci-lint fmt ./...

## tidy: Run go mod tidy.
.PHONY: tidy
tidy:
	$(GO) mod tidy

## check: Run fmt, lint, and test together.
.PHONY: check
check: fmt lint test

## docker: Build the Docker image.
.PHONY: docker-build
docker:
	$(DOCKER) build -t $(IMAGE) .

## docker-run: Build the image and run it on $(PORT) (no Compose).
.PHONY: docker-run
docker-run: docker
	$(DOCKER) run --rm -it -p $(PORT):8080 \
		-e SERVER_LOCATION="$(SERVER_LOCATION)" \
		--name infobits-speedtest \
		$(IMAGE)

## up: Build and start the container in the foreground via Compose.
.PHONY: up
up:
	$(COMPOSE) up --build

## up-d: Build and start the container detached via Compose.
.PHONY: up-d
up-d:
	$(COMPOSE) up --build -d

## down: Stop and remove containers, networks.
.PHONY: down
down:
	$(COMPOSE) down

## logs: Tail logs from the compose service.
.PHONY: logs
logs:
	$(COMPOSE) logs -f

## ps: Show running compose services.
.PHONY: ps
ps:
	$(COMPOSE) ps

## clean: Remove build artifacts.
.PHONY: clean
clean:
	rm -f $(BINARY)
	$(GO) clean -testcache
