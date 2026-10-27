import type { Context, Next } from 'hono';
import { env } from '../config/env.ts';

/**
 * Constant-time string comparison to prevent timing attacks on token verification.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header('Authorization');

  if (!authHeader) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Authorization header with Bearer token is required.',
      },
      401
    );
  }

  const [scheme, token] = authHeader.trim().split(/\s+/);

  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid authorization format. Expected: Bearer <token>',
      },
      401
    );
  }

  if (!timingSafeEqual(token, env.PUBLISH_SECRET_KEY)) {
    return c.json(
      {
        error: 'Unauthorized',
        message: 'Invalid bearer token provided.',
      },
      401
    );
  }

  await next();
}
