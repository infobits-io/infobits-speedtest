# syntax=docker/dockerfile:1
FROM golang:1.26-alpine AS build

WORKDIR /src

# brotli CLI for build-time pre-compression. gzip is already in the base image.
RUN apk add --no-cache brotli

# Install tdewolff/minify (pinned for reproducibility). Cached separately
# from the project source so changes to web/ or main.go don't re-install it.
RUN go install github.com/tdewolff/minify/v2/cmd/minify@v2.24.13

COPY go.mod ./
RUN go mod download

COPY . .

# Minify and pre-compress (max gzip + max brotli) the embedded web assets.
# The Go server picks the best variant at request time via Accept-Encoding.
RUN set -eux; \
    for f in web/index.html web/assets/style.css web/assets/speedtest.js; do \
      minify -o "$f.min" "$f"; \
      mv "$f.min" "$f"; \
      gzip --best -k -f "$f"; \
      brotli -q 11 -k -f "$f"; \
    done

RUN CGO_ENABLED=0 GOOS=linux \
    go build -trimpath -ldflags="-s -w" -o /out/speedtest ./

FROM gcr.io/distroless/static:nonroot

COPY --from=build /out/speedtest /speedtest

USER nonroot:nonroot
EXPOSE 8080

ENTRYPOINT ["/speedtest"]
