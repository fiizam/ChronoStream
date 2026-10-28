import { beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { env } from '../src/config/env.ts';
import { healthRoute } from '../src/routes/health.ts';
import { publishRoute } from '../src/routes/publish.ts';
import { streamRoute } from '../src/routes/stream.ts';
import { authRoute } from '../src/routes/auth.ts';
import { playgroundRoute } from '../src/routes/playground.ts';
import { redisPub, redisSub } from '../src/lib/redis.ts';

const app = new Hono();
app.route('/', healthRoute);
app.route('/', publishRoute);
app.route('/', streamRoute);
app.route('/', authRoute);
app.route('/', playgroundRoute);

describe('API Route Handlers', () => {
  beforeAll(async () => {
    // Wait until local Redis is ready if still connecting
    if (redisPub.status !== 'ready' || redisSub.status !== 'ready') {
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it('GET /health returns 200 with server metrics', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);

    const data = await res.json();
    expect(data.status).toBeDefined();
    expect(data.uptimeSeconds).toBeGreaterThanOrEqual(0);
    expect(data.redis).toBeDefined();
    expect(data.stats).toBeDefined();
    expect(data.memory).toBeDefined();
    expect(data.memory.rssMB).toBeGreaterThan(0);
  });

  it('POST /publish returns 401 when Authorization header is missing', async () => {
    const res = await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        channel: 'notifications',
        data: { message: 'hello' },
      }),
    });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('POST /publish returns 401 when Bearer token is invalid', async () => {
    const res = await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer wrong-secret-token',
      },
      body: JSON.stringify({
        channel: 'notifications',
        data: { message: 'hello' },
      }),
    });

    expect(res.status).toBe(401);
  });

  it('POST /publish returns 400 when channel is missing', async () => {
    const res = await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        data: { message: 'hello' },
      }),
    });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Bad Request');
  });

  it('POST /publish returns 400 when data is missing', async () => {
    const res = await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        channel: 'test_channel',
      }),
    });

    expect(res.status).toBe(400);
  });

  it('POST /publish returns 200 with valid token and payload', async () => {
    const res = await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        channel: 'news',
        event: 'breaking_news',
        data: { headline: 'ChronoStream Launched' },
        id: 'evt_99',
        retry: 3000,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.channel).toBe('news');
    expect(data.event).toBe('breaking_news');
    expect(typeof data.subscribers).toBe('number');
  });

  it('POST /publish/batch returns 400 when events array is empty or missing', async () => {
    const missingRes = await app.request('/publish/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({}),
    });
    expect(missingRes.status).toBe(400);

    const emptyRes = await app.request('/publish/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({ events: [] }),
    });
    expect(emptyRes.status).toBe(400);
  });

  it('POST /publish/batch returns 200 and broadcasts multiple events with valid payload', async () => {
    const res = await app.request('/publish/batch', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        events: [
          {
            channel: 'orders',
            event: 'order.created',
            data: { orderId: 'ord_1' },
          },
          {
            channel: 'notifications',
            event: 'user.alert',
            data: { message: 'Order confirmed' },
          },
        ],
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.count).toBe(2);
    expect(Array.isArray(data.results)).toBe(true);
    expect(data.results).toHaveLength(2);
    expect(data.results[0].channel).toBe('orders');
    expect(data.results[1].channel).toBe('notifications');
  });

  it('POST /auth/token returns 401 without Authorization header', async () => {
    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel: 'private:user-123' }),
    });

    expect(res.status).toBe(401);
  });

  it('POST /auth/token returns 400 when channel is missing', async () => {
    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
  });

  it('POST /auth/token returns 200 with generated HMAC token', async () => {
    const res = await app.request('/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        channel: 'private:tenant-99, private-audit',
        ttlSeconds: 1800,
      }),
    });

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.success).toBe(true);
    expect(data.channel).toBe('private:tenant-99,private-audit');
    expect(data.token).toBeDefined();
    expect(typeof data.token).toBe('string');
    expect(data.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('GET /stream returns 400 when channel query param is missing', async () => {
    const res = await app.request('/stream');
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe('Bad Request');
  });

  it('GET /stream rejects private channels without token with 401', async () => {
    const res = await app.request('/stream?channel=private:secure-feed');
    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Unauthorized');
  });

  it('GET /stream rejects private channels with invalid token with 401', async () => {
    const res = await app.request('/stream?channel=private:secure-feed&token=123456.invalid');
    expect(res.status).toBe(401);
  });

  it('GET /stream accepts private channel when valid HMAC token is provided', async () => {
    // Generate valid token
    const authRes = await app.request('/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({ channel: 'private:secure-feed' }),
    });

    expect(authRes.status).toBe(200);
    const authData = await authRes.json();

    // Connect with token
    const streamRes = await app.request(
      `/stream?channel=private:secure-feed&token=${authData.token}`
    );
    expect(streamRes.status).toBe(200);
    expect(streamRes.headers.get('Content-Type')).toContain('text/event-stream');
    await streamRes.body?.cancel();
  });

  it('GET /stream supports multi-channel subscription', async () => {
    const res = await app.request('/stream?channel=channel1,channel2');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    await res.body?.cancel();
  });

  it('GET /stream initiates SSE with appropriate streaming headers', async () => {
    const res = await app.request('/stream?channel=live_demo');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    await res.body?.cancel();
  });

  it('GET /playground returns 200 with HTML explorer UI', async () => {
    const res = await app.request('/playground');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('ChronoStream');
  });
});
