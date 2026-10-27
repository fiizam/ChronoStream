import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.ts';
import { broker } from '../lib/broker.ts';
import type { PublishPayload } from '../types/index.ts';

export const publishRoute = new Hono();

publishRoute.post('/publish', authMiddleware, async (c) => {
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

  const { channel, event, data, id, retry } = body as Partial<PublishPayload>;

  if (typeof channel !== 'string' || channel.trim().length === 0) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Field "channel" is required and must be a non-empty string.',
      },
      400
    );
  }

  if (data === undefined) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Field "data" is required.',
      },
      400
    );
  }

  const trimmedChannel = channel.trim();
  const eventName = typeof event === 'string' && event.trim() ? event.trim() : 'message';

  let retryMs: number | undefined;
  if (retry !== undefined) {
    const parsed = Number(retry);
    if (!isNaN(parsed) && parsed > 0) {
      retryMs = parsed;
    }
  }

  const subscribers = await broker.publish(trimmedChannel, {
    channel: trimmedChannel,
    event: eventName,
    data,
    id: typeof id === 'string' ? id : undefined,
    retry: retryMs,
  });

  return c.json({
    success: true,
    channel: trimmedChannel,
    event: eventName,
    subscribers,
    timestamp: new Date().toISOString(),
  });
});
