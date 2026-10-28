import type { Context, Next } from 'hono';
import { env } from '../config/env.ts';

const WINDOW_MS = 60_000;
const requestTimestamps = new Map<string, number[]>();

export function resetRateLimitStore(): void {
  requestTimestamps.clear();
}

function getClientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for');
  if (xff) {
    const firstIp = xff.split(',')[0]?.trim();
    if (firstIp) return firstIp;
  }
  const cfIp = c.req.header('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  return '127.0.0.1';
}

export async function rateLimitMiddleware(c: Context, next: Next) {
  const maxRequests = env.RATE_LIMIT_MAX;
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const ip = getClientIp(c);

  const existing = requestTimestamps.get(ip) ?? [];
  const activeTimestamps = existing.filter((ts) => ts > windowStart);

  if (activeTimestamps.length >= maxRequests) {
    requestTimestamps.set(ip, activeTimestamps);
    c.header('X-RateLimit-Limit', String(maxRequests));
    c.header('X-RateLimit-Remaining', '0');
    return c.json(
      {
        error: 'Too Many Requests',
        message: 'Rate limit exceeded. Please try again later.',
      },
      429
    );
  }

  activeTimestamps.push(now);
  requestTimestamps.set(ip, activeTimestamps);

  const remaining = Math.max(0, maxRequests - activeTimestamps.length);
  c.header('X-RateLimit-Limit', String(maxRequests));
  c.header('X-RateLimit-Remaining', String(remaining));

  await next();
}
