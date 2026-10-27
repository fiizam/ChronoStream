import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { broker } from '../lib/broker.ts';

export const streamRoute = new Hono();

streamRoute.get('/stream', async (c) => {
  const channel = c.req.query('channel');

  if (!channel || channel.trim().length === 0) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Query parameter "channel" is required. Example: /stream?channel=notifications',
      },
      400
    );
  }

  const trimmedChannel = channel.trim();

  // Prevent proxy buffering (e.g. Nginx, Cloudflare)
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache, no-transform');

  return streamSSE(c, async (stream) => {
    // Register client with in-memory multiplexer and subscribe to Redis if first listener
    await broker.addClient(trimmedChannel, stream);

    let isCleanedUp = false;
    const cleanup = async () => {
      if (!isCleanedUp) {
        isCleanedUp = true;
        await broker.removeClient(trimmedChannel, stream);
      }
    };

    // Client aborted / closed connection
    stream.onAbort(() => {
      cleanup();
    });

    try {
      // Send initial handshake acknowledging connection
      await stream.writeSSE({
        event: 'connected',
        data: JSON.stringify({
          channel: trimmedChannel,
          connectedAt: new Date().toISOString(),
          message: `Connected to ChronoStream on channel "${trimmedChannel}"`,
        }),
      });

      // 25-second heartbeat loop to prevent intermediate proxy/NAT timeouts
      const HEARTBEAT_INTERVAL_MS = 25000;

      while (!stream.aborted) {
        await stream.sleep(HEARTBEAT_INTERVAL_MS);

        if (stream.aborted) {
          break;
        }

        try {
          await stream.writeSSE({
            event: 'ping',
            data: JSON.stringify({ timestamp: Date.now() }),
          });
        } catch {
          // Socket write failed, break and cleanup
          break;
        }
      }
    } finally {
      await cleanup();
    }
  });
});
