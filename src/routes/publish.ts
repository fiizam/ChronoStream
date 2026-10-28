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

publishRoute.post('/publish/batch', authMiddleware, async (c) => {
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

  const { events } = body as { events?: unknown };

  if (!Array.isArray(events) || events.length === 0 || events.length > 50) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Field "events" must be a non-empty array of 1 to 50 event objects.',
      },
      400
    );
  }

  for (let i = 0; i < events.length; i++) {
    const item = events[i] as Partial<PublishPayload> | undefined;
    if (!item || typeof item !== 'object') {
      return c.json(
        {
          error: 'Bad Request',
          message: `Event at index ${i} must be an object.`,
        },
        400
      );
    }
    if (typeof item.channel !== 'string' || item.channel.trim().length === 0) {
      return c.json(
        {
          error: 'Bad Request',
          message: `Event at index ${i} requires a non-empty "channel" string.`,
        },
        400
      );
    }
    if (item.data === undefined) {
      return c.json(
        {
          error: 'Bad Request',
          message: `Event at index ${i} requires a "data" field.`,
        },
        400
      );
    }
  }

  const results = await Promise.all(
    (events as PublishPayload[]).map(async (item) => {
      const trimmedChannel = item.channel.trim();
      const eventName =
        typeof item.event === 'string' && item.event.trim() ? item.event.trim() : 'message';

      let retryMs: number | undefined;
      if (item.retry !== undefined) {
        const parsed = Number(item.retry);
        if (!isNaN(parsed) && parsed > 0) {
          retryMs = parsed;
        }
      }

      const subscribers = await broker.publish(trimmedChannel, {
        channel: trimmedChannel,
        event: eventName,
        data: item.data,
        id: typeof item.id === 'string' ? item.id : undefined,
        retry: retryMs,
      });

      return {
        channel: trimmedChannel,
        event: eventName,
        subscribers,
      };
    })
  );

  return c.json({
    success: true,
    count: events.length,
    results,
    timestamp: new Date().toISOString(),
  });
});
