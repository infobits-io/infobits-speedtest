# infobits-speedtest

A simple, self-hosted speedtest website written in Go. Measures ping, jitter,
loss, download, and upload throughput from any modern browser. Single static
binary, single Docker container, no database.

## Quick start

`make help` lists every target. The most common ones:

```sh
make run            # run server locally on :8080
make test           # go test -race ./...
make lint           # golangci-lint
make check          # fmt + lint + test
make up             # docker compose up --build (foreground)
make up-d           # detached
make down           # stop containers
```

## Run with Docker

```sh
docker compose up --build      # or: make up
```

Open <http://localhost:8080>. The compose definition lives in `compose.yaml`.

## Run locally (dev)

```sh
go run .                       # or: make run
```

## Configuration

| Variable             | Default       | Description                                                   |
| -------------------- | ------------- | ------------------------------------------------------------- |
| `PORT`               | `8080`        | TCP port to listen on.                                        |
| `SERVER_LOCATION`    | `""`          | Optional location label shown in the UI header (e.g. `Amsterdam · NL`). |
| `TEST_DURATION_SEC`  | `10`          | Seconds spent on each of download/upload.                     |
| `PARALLEL_STREAMS`   | `4`           | Concurrent HTTP streams per direction.                        |
| `MAX_DOWNLOAD_BYTES` | `4294967296`  | Per-request download cap (bytes).                             |
| `MAX_UPLOAD_BYTES`   | `4294967296`  | Per-request upload cap (bytes).                               |
| `LOG_FORMAT`         | `text`        | `text` (key=value) or `json`.                                 |
| `LOG_LEVEL`          | `info`        | `debug`, `info`, `warn`, or `error`.                          |

## Endpoints

| Path        | Method | Purpose                                   |
| ----------- | ------ | ----------------------------------------- |
| `/`         | GET    | Web UI.                                   |
| `/config`   | GET    | Test configuration (JSON).                |
| `/whoami`   | GET    | Client IP (respects `X-Forwarded-For`).   |
| `/ping`     | GET    | Minimal response used for RTT measurement.|
| `/download` | GET    | Streams `?bytes=N` zero bytes.            |
| `/upload`   | POST   | Discards request body, reports size.      |

## Testing & linting

```sh
go test ./...
golangci-lint run ./...
```

## Notes

- Behind a reverse proxy (Caddy / Traefik / nginx), terminate TLS upstream and
  forward to port 8080. Disable any response buffering that would interfere
  with chunked transfer (e.g. `proxy_buffering off;` in nginx) for accurate
  throughput readings.
- The browser performs all measurements — server-side timing isn't trustworthy
  due to TCP/proxy buffering.
