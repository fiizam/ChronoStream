import { beforeEach, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { env } from '../src/config/env.ts';
import { rateLimitMiddleware, resetRateLimitStore } from '../src/middleware/rateLimit.ts';

describe('Sliding-Window Rate Limiter Middleware', () => {
  const originalMax = env.RATE_LIMIT_MAX;

  beforeEach(() => {
    resetRateLimitStore();
    env.RATE_LIMIT_MAX = 3;
  });

  it('allows requests within the limit and sets X-RateLimit headers', async () => {
    const app = new Hono();
    app.use('*', rateLimitMiddleware);
    app.post('/test', (c) => c.json({ ok: true }));

    const res1 = await app.request('/test', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(res1.status).toBe(200);
    expect(res1.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(res1.headers.get('X-RateLimit-Remaining')).toBe('2');

    const res2 = await app.request('/test', {
      method: 'POST',
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });
    expect(res2.status).toBe(200);
    expect(res2.headers.get('X-RateLimit-Remaining')).toBe('1');
  });

  it('returns 429 Too Many Requests when the limit is exceeded for an IP', async () => {
    const app = new Hono();
    app.use('*', rateLimitMiddleware);
    app.post('/test', (c) => c.json({ ok: true }));

    for (let i = 0; i < 3; i++) {
      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'cf-connecting-ip': '198.51.100.42' },
      });
      expect(res.status).toBe(200);
    }

    const blockedRes = await app.request('/test', {
      method: 'POST',
      headers: { 'cf-connecting-ip': '198.51.100.42' },
    });
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get('X-RateLimit-Limit')).toBe('3');
    expect(blockedRes.headers.get('X-RateLimit-Remaining')).toBe('0');

    const body = await blockedRes.json();
    expect(body.error).toBe('Too Many Requests');

    // Restore original config
    env.RATE_LIMIT_MAX = originalMax;
  });
});
