# ChronoStream

[![CI](https://github.com/fiizam/ChronoStream/actions/workflows/ci.yml/badge.svg)](https://github.com/fiizam/ChronoStream/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

Ultra-lightweight Server-Sent Events (SSE) Real-Time Broadcasting Engine powered by **Bun**, **Hono**, and **Redis Pub/Sub** (Upstash compatible).

ChronoStream allows any third-party backend (Laravel, Python, Go, Node.js, Supabase, PHP) to push real-time events to thousands of web browsers using the native browser `EventSource` API with zero client-side dependencies.

---

## Key Features

- **Native Browser Compatibility**: Uses the browser's built-in `EventSource` API. No proprietary client SDKs or heavy WebSocket libraries required.
- **Shared Subscription Multiplexing**: Exactly 2 Redis connections per ChronoStream server instance (`redisPub` and `redisSub`), regardless of how many thousands of browser connections are open.
- **Multi-Channel Subscription**: Subscribe to multiple channels over a single SSE connection (`GET /stream?channel=orders,alerts`).
- **Private Channel HMAC Auth**: Restrict sensitive channels (`private:*` and `private-*`) with cryptographically signed tokens issued via `POST /auth/token`.
- **Missed Message Replay (`Last-Event-ID`)**: Bounded Redis and in-memory ring buffers controlled by `HISTORY_SIZE` and `HISTORY_TTL_SECONDS` for automatic message recovery upon reconnection.
- **Batch Event Publishing (`POST /publish/batch`)**: Broadcast up to 50 events across channels in a single HTTP request.
- **Built-In Interactive Playground (`GET /playground`)**: Inspect live SSE streams and test publishing directly in your browser.
- **Sliding-Window IP Rate Limiting**: Configurable per-IP protection (`RATE_LIMIT_MAX`) with `X-RateLimit-*` headers.
- **Zero Memory Leaks**: Guaranteed cleanup on client disconnect (`stream.onAbort`) and automatic Redis `UNSUBSCRIBE` as soon as a channel has zero active local listeners.
- **Upstash & Redis Cloud Ready**: First-class support for standard TCP (`redis://`) and TLS (`rediss://`) connections.
- **Dual Ingestion**: Publish events either via the authenticated `POST /publish` HTTP endpoint or directly via native Redis `PUBLISH` from your backend workers.
- **Heartbeat Keep-Alive**: Built-in 25-second heartbeat ping prevents connection drops from intermediate reverse proxies (Nginx, Cloudflare) and NAT firewalls.
- **Timing-Safe Authentication**: Bearer token authentication protected by constant-time string verification to prevent timing attacks.

---

## Architecture: Shared Subscription Multiplexing

Traditional SSE implementations often open a separate Redis subscriber connection for every single HTTP client, exhausting Redis connection limits within hundreds of users. 

ChronoStream solves this through an in-memory multiplexer:

```mermaid
flowchart TD
    subgraph Backends ["Third-Party Backends (Laravel, Python, Go, Node)"]
        HTTP_PUB["HTTP POST /publish"]
        DIRECT_PUB["Native Redis PUBLISH"]
    end

    subgraph RedisCluster ["Redis / Upstash Pub/Sub"]
        R_BROKER["Redis Pub/Sub Channel Bus"]
    end

    subgraph ChronoStream ["ChronoStream Engine (Bun + Hono)"]
        R_PUB["redisPub (Dedicated Publisher)"]
        R_SUB["redisSub (Dedicated Subscriber)"]
        BROKER["ChannelBroker (Singleton Multiplexer)"]
        CH_MAP["In-Memory Map: channel to Set of SSEStreams"]
    end

    subgraph Clients ["Browser Clients (Native EventSource API)"]
        C1["Client 1 (Channel: orders)"]
        C2["Client 2 (Channel: orders)"]
        C3["Client 3 (Channel: alerts)"]
    end

    HTTP_PUB -->|Bearer Token| R_PUB
    R_PUB -->|PUBLISH| R_BROKER
    DIRECT_PUB -->|PUBLISH| R_BROKER
    R_BROKER -->|SUBSCRIBE Message| R_SUB
    R_SUB --> BROKER
    BROKER --> CH_MAP
    CH_MAP -->|stream.writeSSE| C1
    CH_MAP -->|stream.writeSSE| C2
    CH_MAP -->|stream.writeSSE| C3
```

### Lifecycle & Zero-Leak Guarantee

1. **First Listener**: When Client 1 connects to `orders`, ChronoStream registers the client in `Map<"orders", Set>` and calls `redisSub.subscribe("orders")`.
2. **Subsequent Listeners**: When Client 2 connects to `orders`, ChronoStream simply adds the stream to the existing `Set`. No additional Redis commands are issued.
3. **Fan-Out**: When Redis delivers a message on `orders`, ChronoStream iterates through the local `Set` and broadcasts the event via `stream.writeSSE(...)`.
4. **Client Disconnect**: When Client 1 disconnects, `stream.onAbort` removes the stream from the `Set`.
5. **Zero Listeners Cleanup**: When Client 2 disconnects and the `Set` becomes empty, ChronoStream deletes `orders` from the Map and calls `redisSub.unsubscribe("orders")`.

---

## Quickstart

### Prerequisites
- [Bun](https://bun.sh) (v1.1+)
- Redis instance (local or [Upstash](https://upstash.com))

### 1. Installation

```bash
git clone https://github.com/fiizam/ChronoStream.git
cd chronostream
bun install
```

### 2. Configure Environment

Copy the example configuration:

```bash
cp .env.example .env
```

Edit `.env` with your settings:

```ini
PORT=3000
REDIS_URL=redis://127.0.0.1:6379
PUBLISH_SECRET_KEY=your_strong_secret_key_here
ALLOWED_ORIGINS=*
HISTORY_SIZE=50
HISTORY_TTL_SECONDS=300
RATE_LIMIT_MAX=120
```

### 3. Start Development Server

```bash
bun run dev
```

The server will start on `http://localhost:3000` (interactive explorer at `http://localhost:3000/playground`).

### 4. Run Automated Tests

ChronoStream includes unit, integration, and end-to-end tests:

```bash
bun test
```

---

## Running with Docker

### Using Docker Compose (Recommended)

Start ChronoStream alongside a configured Redis container with a single command:

```bash
docker compose up -d
```

### Manual Docker Build

Run using the production multi-stage Docker image:

```bash
# Build Docker image
docker build -t chronostream:latest .

# Run container
docker run -d \
  -p 3000:3000 \
  -e REDIS_URL=rediss://default:YOUR_PASSWORD@YOUR_ENDPOINT.upstash.io:6379 \
  -e PUBLISH_SECRET_KEY=your_strong_secret_key_here \
  --name chronostream \
  chronostream:latest
```

---

## API Reference

### 1. Health & Metrics
Check system health, uptime, Redis connection statuses, and active channel listener counts.

- **URL**: `GET /health`
- **Authentication**: None

**Response `(200 OK)`**:
```json
{
  "status": "ok",
  "uptimeSeconds": 348,
  "timestamp": "2026-10-27T13:45:00.000Z",
  "redis": {
    "pub": "ready",
    "sub": "ready"
  },
  "stats": {
    "channelsCount": 2,
    "totalClientsCount": 150,
    "channels": {
      "orders": 120,
      "notifications:user-42": 30
    }
  },
  "memory": {
    "rssMB": 34.2,
    "heapUsedMB": 12.8,
    "heapTotalMB": 24.5
  }
}
```

---

### 2. Connect SSE Stream
Establish a persistent Server-Sent Events stream for one or more channels.

- **URL**: `GET /stream?channel=:channels[&token=:hmacToken]`
- **Headers Sent by Client (Optional)**:
  - `Last-Event-ID`: ID of the last received event to automatically replay missed messages upon reconnection.
- **Headers Sent by Server**:
  - `Content-Type: text/event-stream`
  - `Cache-Control: no-cache, no-transform`
  - `Connection: keep-alive`
  - `X-Accel-Buffering: no`

**Query Parameters**:
| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `channel` | string | Yes | Single channel name or comma-separated list of channels (e.g. `orders,alerts`) |
| `token` | string | Optional | Cryptographic HMAC token required when subscribing to private channels (`private:*` or `private-*`) |
| `lastEventId` | string | Optional | Query parameter alternative to `Last-Event-ID` header for missed message replay |

**Events Sent to Client**:
1. `connected`: Initial handshake containing server timestamp, active channels confirmation, and connection metadata.
2. `ping`: Keep-alive event sent every 25 seconds.
3. Custom events: Real-time events broadcasted to any of the subscribed channels.

---

### 3. Publish Event
Publish an event to a channel for immediate broadcast to all connected clients.

- **URL**: `POST /publish`
- **Authentication**: `Authorization: Bearer <PUBLISH_SECRET_KEY>`
- **Rate Limit**: `RATE_LIMIT_MAX` requests/min per IP (`X-RateLimit-Limit`, `X-RateLimit-Remaining`)
- **Content-Type**: `application/json`

**Request Body**:
```json
{
  "channel": "orders",
  "event": "order.created",
  "data": {
    "orderId": "ord_9981",
    "amount": 89.50,
    "customer": "Jane Doe"
  },
  "id": "evt_1700000000",
  "retry": 5000
}
```

**Field Specifications**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | Yes | Target channel name |
| `data` | any | Yes | Event payload (JSON object, array, or string) |
| `event` | string | No | SSE event name (default: `"message"`) |
| `id` | string | No | Event identifier for client deduplication and missed message replay |
| `retry` | number | No | Reconnection time in milliseconds for the client |

**Response `(200 OK)`**:
```json
{
  "success": true,
  "channel": "orders",
  "event": "order.created",
  "subscribers": 1,
  "timestamp": "2026-10-27T13:45:00.000Z"
}
```

---

### 4. Batch Publish Events
Publish between 1 and 50 events in a single HTTP request.

- **URL**: `POST /publish/batch`
- **Authentication**: `Authorization: Bearer <PUBLISH_SECRET_KEY>`
- **Content-Type**: `application/json`

**Request Body**:
```json
{
  "events": [
    {
      "channel": "orders",
      "event": "order.created",
      "data": { "orderId": "ord_9981" }
    },
    {
      "channel": "notifications",
      "event": "user.alert",
      "data": { "message": "New order received" }
    }
  ]
}
```

**Response `(200 OK)`**:
```json
{
  "success": true,
  "count": 2,
  "results": [
    { "channel": "orders", "event": "order.created", "subscribers": 1 },
    { "channel": "notifications", "event": "user.alert", "subscribers": 1 }
  ],
  "timestamp": "2026-10-28T09:30:00.000Z"
}
```

---

### 5. Generate Private Channel Token
Issue a cryptographically signed HMAC-SHA256 token to authorize client connections to private channels (`private:*` or `private-*`).

- **URL**: `POST /auth/token`
- **Authentication**: `Authorization: Bearer <PUBLISH_SECRET_KEY>`
- **Content-Type**: `application/json`

**Request Body**:
```json
{
  "channel": "private:user-42",
  "ttlSeconds": 3600
}
```

**Field Specifications**:
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `channel` | string | Yes | Target private channel name or comma-separated list of private channels |
| `ttlSeconds` | number | No | Token lifetime in seconds (default: `3600`) |

**Response `(200 OK)`**:
```json
{
  "success": true,
  "channel": "private:user-42",
  "token": "1793114400.a3f8c9b1d2e4...",
  "expiresAt": 1793114400
}
```

---

## Client Integration Examples

### Native Browser JavaScript
```javascript
const channel = 'orders';
const es = new EventSource(`http://localhost:3000/stream?channel=${channel}`);

// Handle initial handshake
es.addEventListener('connected', (e) => {
  console.log('Connected to ChronoStream:', JSON.parse(e.data));
});

// Handle keep-alive heartbeats
es.addEventListener('ping', () => {
  // connection is active
});

// Handle custom typed events
es.addEventListener('order.created', (e) => {
  const order = JSON.parse(e.data);
  console.log('New order received:', order);
});

// Handle default messages
es.onmessage = (e) => {
  console.log('Message:', e.data);
};

es.onerror = (err) => {
  console.warn('Connection lost, browser will auto-reconnect:', err);
};
```

---

### React Hook Example
```tsx
import { useEffect, useState } from 'react';

export function useChronoStream<T = unknown>(channel: string, eventName = 'message') {
  const [data, setData] = useState<T | null>(null);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    const es = new EventSource(`http://localhost:3000/stream?channel=${encodeURIComponent(channel)}`);

    es.addEventListener('connected', () => setIsConnected(true));
    es.addEventListener(eventName, (e) => {
      try {
        setData(JSON.parse(e.data));
      } catch {
        setData(e.data as unknown as T);
      }
    });

    es.onerror = () => setIsConnected(false);

    return () => {
      es.close();
    };
  }, [channel, eventName]);

  return { data, isConnected };
}
```

---

### Backend Publisher Examples

#### Python (via `requests`)
```python
import requests

url = "http://localhost:3000/publish"
headers = {"Authorization": "Bearer chronostream_dev_secret_key_change_in_production"}

payload = {
    "channel": "orders",
    "event": "order.created",
    "data": {"order_id": 1042, "status": "paid"}
}

response = requests.post(url, json=payload, headers=headers)
print(response.json())
```

#### PHP / Laravel (via `Http` facade)
```php
use Illuminate\Support\Facades\Http;

Http::withToken(config('services.chronostream.secret'))
    ->post(config('services.chronostream.url') . '/publish', [
        'channel' => 'orders',
        'event' => 'order.created',
        'data' => [
            'order_id' => $order->id,
            'total' => $order->total_amount,
        ],
    ]);
```

#### Direct Redis Publish (Laravel, Python, or Go workers)
You can bypass HTTP and publish directly to Redis. ChronoStream will parse and broadcast the event:

```bash
redis-cli PUBLISH orders '{"event":"order.created","data":{"order_id":1042,"total":49.90}}'
```

---

## Interactive Testing UI (`GET /playground`)

ChronoStream serves a built-in interactive SSE explorer at `GET /playground` (backed by `examples/client.html`).

To use it:
1. Start ChronoStream: `bun run dev`
2. Visit `http://localhost:3000/playground` in your browser (or open `examples/client.html` directly).
3. Connect to a channel (e.g. `demo-stream`), send test broadcasts using the built-in publisher console, and watch real-time events arrive.

---

## License

MIT License. Open-source and free for commercial and personal use.
