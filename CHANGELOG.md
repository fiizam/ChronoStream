# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-28

### Added
- **Interactive SSE Playground (`GET /playground`)**: Built-in web explorer UI with automatic origin detection for testing streams and publishing events directly from the server.
- **Batch Publishing Endpoint (`POST /publish/batch`)**: Broadcast up to 50 events across single or multiple channels in a single authenticated HTTP request.
- **Sliding-Window IP Rate Limiter**: Configurable per-IP request rate limiting (`RATE_LIMIT_MAX`) with `X-RateLimit-Limit` and `X-RateLimit-Remaining` headers on protected endpoints.
- **Multi-Channel Subscriptions**: Subscribe to comma-separated channels over a single SSE connection (`GET /stream?channel=orders,alerts`).
- **Private Channel HMAC-SHA256 Auth (`POST /auth/token`)**: Cryptographically signed, time-bound access tokens for `private:*` and `private-*` channels.
- **Missed Message Replay (`Last-Event-ID`)**: Bounded Redis and in-memory ring buffers (`HISTORY_SIZE`, `HISTORY_TTL_SECONDS`) to replay missed events when clients reconnect.
- **GitHub Actions CI**: Automated type-checking and integration test workflow against Redis 7.

## [1.0.0] - 2026-10-27

### Added
- Core Server-Sent Events (SSE) broadcasting engine powered by Bun, Hono, and Redis (`ioredis`).
- `ChannelBroker` shared subscription multiplexer using 2 Redis connections (`redisPub` and `redisSub`) with automatic `UNSUBSCRIBE` and zero memory leaks on disconnect.
- Authenticated `POST /publish` endpoint with constant-time Bearer token verification.
- `GET /stream` SSE endpoint with 25-second keep-alive heartbeats and proxy buffering headers.
- `GET /health` observability endpoint reporting uptime, Redis states, active channel/client metrics, and memory usage.
- Multi-stage production `Dockerfile` and `docker-compose.yml`.
