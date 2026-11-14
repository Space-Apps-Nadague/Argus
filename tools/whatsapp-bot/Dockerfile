# syntax=docker/dockerfile:1

FROM golang:1.26-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY *.go ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/argus-wa-bot .

FROM node:22-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /out/argus-wa-bot /usr/local/bin/argus-wa-bot

WORKDIR /workspace
ENV WHATSAPP_DB_PATH=/data/whatsapp.db
VOLUME ["/data"]

ENTRYPOINT ["/usr/local/bin/argus-wa-bot"]
