import { beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { env } from '../src/config/env.ts';
import { authMiddleware } from '../src/middleware/auth.ts';
import { healthRoute } from '../src/routes/health.ts';
import { publishRoute } from '../src/routes/publish.ts';
import { streamRoute } from '../src/routes/stream.ts';
import { redisPub, redisSub } from '../src/lib/redis.ts';

const app = new Hono();
app.route('/', healthRoute);
app.route('/', publishRoute);
app.route('/', streamRoute);

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

  it('GET /stream returns 400 when channel query param is missing', async () => {
    const res = await app.request('/stream');
    expect(res.status).toBe(400);

    const data = await res.json();
    expect(data.error).toBe('Bad Request');
  });

  it('GET /stream initiates SSE with appropriate streaming headers', async () => {
    const res = await app.request('/stream?channel=live_demo');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/event-stream');
    expect(res.headers.get('Cache-Control')).toContain('no-cache');
    await res.body?.cancel();
  });
});
