import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { broker } from '../lib/broker.ts';
import { isPrivateChannel, verifyChannelToken } from '../lib/token.ts';

export const streamRoute = new Hono();

streamRoute.get('/stream', async (c) => {
  const channelParam = c.req.query('channel');

  if (!channelParam || channelParam.trim().length === 0) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'Query parameter "channel" is required. Example: /stream?channel=notifications',
      },
      400
    );
  }

  // Parse comma-separated channels and deduplicate
  const channels = Array.from(
    new Set(channelParam.split(',').map((ch) => ch.trim()).filter(Boolean))
  );

  if (channels.length === 0) {
    return c.json(
      {
        error: 'Bad Request',
        message: 'At least one valid channel name must be provided.',
      },
      400
    );
  }

  const normalizedScope = channels.join(',');

  // Verify HMAC token if any requested channel is private
  if (channels.some(isPrivateChannel)) {
    const token = c.req.query('token');
    if (!verifyChannelToken(normalizedScope, token)) {
      return c.json(
        {
          error: 'Unauthorized',
          message: 'Valid token required for private channel(s).',
        },
        401
      );
    }
  }

  // Prevent proxy buffering (e.g. Nginx, Cloudflare)
  c.header('X-Accel-Buffering', 'no');
  c.header('Cache-Control', 'no-cache, no-transform');

  return streamSSE(c, async (stream) => {
    // Register client with in-memory multiplexer for all target channels
    await Promise.all(channels.map((ch) => broker.addClient(ch, stream)));

    let isCleanedUp = false;
    const cleanup = async () => {
      if (!isCleanedUp) {
        isCleanedUp = true;
        await Promise.all(channels.map((ch) => broker.removeClient(ch, stream)));
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
          channel: normalizedScope,
          channels,
          connectedAt: new Date().toISOString(),
          message: `Connected to ChronoStream on channel(s) "${normalizedScope}"`,
        }),
      });

      // Replay missed messages if Last-Event-ID or lastEventId query param is provided
      const lastEventId = c.req.header('Last-Event-ID') || c.req.query('lastEventId');
      if (lastEventId) {
        for (const ch of channels) {
          const missedMessages = await broker.getMissedMessages(ch, lastEventId);
          for (const msg of missedMessages) {
            await stream.writeSSE({
              event: msg.event,
              data: msg.data,
              id: msg.id,
              retry: msg.retry,
            });
          }
        }
      }

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
