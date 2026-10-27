import { beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { env } from '../src/config/env.ts';
import { streamRoute } from '../src/routes/stream.ts';
import { publishRoute } from '../src/routes/publish.ts';
import { redisPub, redisSub } from '../src/lib/redis.ts';
import { broker } from '../src/lib/broker.ts';

const app = new Hono();
app.route('/', streamRoute);
app.route('/', publishRoute);

describe('End-to-End Real Redis SSE Broadcast', () => {
  beforeAll(async () => {
    if (redisPub.status !== 'ready' || redisSub.status !== 'ready') {
      await new Promise((r) => setTimeout(r, 200));
    }
  });

  it('connects to SSE stream, receives handshake and real published events', async () => {
    const channelName = `e2e_${Date.now()}`;

    // Connect to /stream
    const streamResponse = await app.request(`/stream?channel=${channelName}`);
    expect(streamResponse.status).toBe(200);
    expect(streamResponse.body).toBeDefined();

    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();

    // Read initial handshake
    const firstChunk = await reader.read();
    expect(firstChunk.done).toBe(false);
    const firstText = decoder.decode(firstChunk.value);
    expect(firstText).toContain('event: connected');
    expect(firstText).toContain(channelName);

    // Verify broker registered the client
    const stats = broker.getStats();
    expect(stats.channels[channelName]).toBe(1);

    // Publish an event via POST /publish
    const publishRes = await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        channel: channelName,
        event: 'order.created',
        data: { orderId: 'ord_12345', amount: 99.95 },
        id: 'msg_001',
      }),
    });

    expect(publishRes.status).toBe(200);

    // Read broadcasted event from the SSE stream
    const secondChunk = await reader.read();
    expect(secondChunk.done).toBe(false);
    const secondText = decoder.decode(secondChunk.value);
    expect(secondText).toContain('event: order.created');
    expect(secondText).toContain('ord_12345');
    expect(secondText).toContain('id: msg_001');

    // Cancel stream to trigger disconnect cleanup
    await reader.cancel();

    // Allow disconnect cleanup tick
    await new Promise((r) => setTimeout(r, 50));
    const afterStats = broker.getStats();
    expect(afterStats.channels[channelName]).toBeUndefined();
  });
});
