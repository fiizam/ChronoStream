# ChronoStream

[![CI](https://github.com/fiizam/ChronoStream/actions/workflows/ci.yml/badge.svg)](https://github.com/fiizam/ChronoStream/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Lightweight Server-Sent Events (SSE) real-time broadcasting server built with **Bun**, **Hono**, and **Redis Pub/Sub**.

ChronoStream lets any backend (Laravel, Python, Go, Node.js) push real-time one-way updates (payment confirmations, live notifications, order statuses, chat streams) to thousands of browser clients using the native `EventSource` API—without paying for proprietary services or maintaining heavy WebSocket servers.

**Live Playground:** [https://chrono-stream-five.vercel.app/playground](https://chrono-stream-five.vercel.app/playground)

---

## What It Does

- **Shared Redis Multiplexing**: Uses only 2 Redis connections (`redisPub` and `redisSub`) per server instance regardless of client count. Automatically runs `SUBSCRIBE` when the first client joins a channel and `UNSUBSCRIBE` when the last client leaves.
- **Multi-Channel Streaming**: Listen to multiple channels over a single HTTP connection (`GET /stream?channel=orders,alerts`).
- **Private Channel Auth**: Channels prefixed with `private:` or `private-` require an expiring HMAC-SHA256 token issued via `POST /auth/token`.
- **Missed Event Replay (`Last-Event-ID`)**: Buffers recent events with an `id` in Redis/memory (`HISTORY_SIZE` & `HISTORY_TTL_SECONDS`) and replays missed messages automatically when a client reconnects.
- **Built-in Rate Limiting & Keep-Alive**: Protects publish endpoints with sliding-window IP rate limiting and sends 25-second `ping` heartbeats so reverse proxies do not drop idle connections.

```mermaid
flowchart LR
    B["Backend (Laravel / Python / Go)"] -->|POST /publish| CS["ChronoStream (Hono)"]
    CS <-->|Pub/Sub Multiplexer| R[("Redis / Upstash")]
    CS -->|SSE EventSource| C1["Browser 1"]
    CS -->|SSE EventSource| C2["Browser 2"]
```

---

## How to Use (2 Steps)

### 1. Listen from Frontend (Browser)
No external library required. Use the browser's built-in `EventSource`:

```javascript
const stream = new EventSource("https://chrono-stream-five.vercel.app/stream?channel=order-101");

stream.addEventListener("payment.paid", (e) => {
  const data = JSON.parse(e.data);
  console.log("Order paid:", data);
});
```

### 2. Broadcast from Any Backend
Send an HTTP `POST` request with your `PUBLISH_SECRET_KEY`:

```bash
curl -X POST https://chrono-stream-five.vercel.app/publish \
  -H "Authorization: Bearer YOUR_PUBLISH_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "channel": "order-101",
    "event": "payment.paid",
    "id": "evt-001",
    "data": { "orderId": "ORD-101", "status": "PAID" }
  }'
```

---

## Self-Hosting Quickstart

### Option A: Docker Compose (Recommended)
```bash
git clone https://github.com/fiizam/ChronoStream.git
cd ChronoStream
docker compose up -d
```

### Option B: Local with Bun
```bash
cp .env.example .env
bun install
bun run dev
```
Open `http://localhost:3000/playground` in your browser to test live connections and broadcasts.

---

## API Endpoints

| Method | Endpoint | Auth | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/channels[?prefix=...]` | Public | Inspect active channels, subscriber counts, and presence (`/channels/:name`). |
| `GET` | `/stream?channel=ch1,ch2[&token=...]` | Public / HMAC | Connect to one or more SSE channels. Supports `Last-Event-ID` header for replay. |
| `POST` | `/publish` | Bearer Token | Broadcast an event `{ channel, event?, data, id?, retry? }` to a channel. |
| `POST` | `/publish/batch` | Bearer Token | Broadcast up to 50 events at once `{ events: [...] }`. |
| `POST` | `/auth/token` | Bearer Token | Generate an expiring HMAC token `{ channel, ttlSeconds? }` for `private:*` channels. |
| `GET` | `/playground` | Public | Built-in web UI for testing live SSE streams and publishing events. |
| `GET` | `/health` | Public | Server uptime, memory usage, Redis connection state, and active client counts. |

---

## Environment Variables

| Variable | Default | Description |
| :--- | :--- | :--- |
| `PORT` | `3000` | HTTP server port |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis TCP or TLS (`rediss://`) connection URL |
| `PUBLISH_SECRET_KEY` | *(dev fallback)* | Secret key for Bearer auth and private channel HMAC signing |
| `ALLOWED_ORIGINS` | `*` | Comma-separated allowed CORS origins |
| `HISTORY_SIZE` | `50` | Max buffered events per channel for `Last-Event-ID` replay |
| `HISTORY_TTL_SECONDS` | `300` | Redis TTL (seconds) for channel replay history |
| `RATE_LIMIT_MAX` | `120` | Max publish/auth requests per minute per IP |

---

## License

[MIT](./LICENSE)
