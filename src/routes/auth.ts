import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth';
import { generateChannelToken } from '../lib/token';

export const authRoute = new Hono();

authRoute.post('/auth/token', authMiddleware, async (c) => {
  let body: unknown;

  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Request body must be valid JSON.',
      },
      400
    );
  }

  if (!body || typeof body !== 'object') {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Request body must be a JSON object.',
      },
      400
    );
  }

  const { channel, ttlSeconds } = body as { channel?: unknown; ttlSeconds?: unknown };

  if (typeof channel !== 'string' || channel.trim().length === 0) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Field "channel" is required and must be a non-empty string.',
      },
      400
    );
  }

  // Normalize single or comma-separated channel scope
  const normalizedChannel = Array.from(
    new Set(channel.split(',').map((ch) => ch.trim()).filter(Boolean))
  ).join(',');

  if (!normalizedChannel) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Field "channel" must contain at least one valid channel identifier.',
      },
      400
    );
  }

  let ttl = 3600;
  if (typeof ttlSeconds === 'number' && ttlSeconds > 0) {
    ttl = Math.floor(ttlSeconds);
  }

  const { token, expiresAt } = generateChannelToken(normalizedChannel, ttl);

  return c.json({
    success: true,
    channel: normalizedChannel,
    token,
    expiresAt,
  });
});
