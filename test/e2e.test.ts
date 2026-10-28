import { beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { env } from '../src/config/env';
import { streamRoute } from '../src/routes/stream';
import { publishRoute } from '../src/routes/publish';
import { authRoute } from '../src/routes/auth';
import { redisPub, redisSub } from '../src/lib/redis';
import { broker } from '../src/lib/broker';

const app = new Hono();
app.route('/', streamRoute);
app.route('/', publishRoute);
app.route('/', authRoute);

describe('End-to-End Real Redis SSE Broadcast & v1.1 Features', () => {
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

  it('subscribes to multiple channels and receives events from any of them', async () => {
    const chA = `multi_a_${Date.now()}`;
    const chB = `multi_b_${Date.now()}`;

    const streamResponse = await app.request(`/stream?channel=${chA},${chB}`);
    expect(streamResponse.status).toBe(200);

    const reader = streamResponse.body!.getReader();
    const decoder = new TextDecoder();

    // Handshake
    const firstChunk = await reader.read();
    const firstText = decoder.decode(firstChunk.value);
    expect(firstText).toContain('event: connected');
    expect(firstText).toContain(chA);
    expect(firstText).toContain(chB);

    // Publish to Channel A
    await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        channel: chA,
        event: 'event.a',
        data: { origin: 'channel A' },
      }),
    });

    const chunkA = await reader.read();
    const textA = decoder.decode(chunkA.value);
    expect(textA).toContain('event: event.a');
    expect(textA).toContain('channel A');

    // Publish to Channel B
    await app.request('/publish', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({
        channel: chB,
        event: 'event.b',
        data: { origin: 'channel B' },
      }),
    });

    const chunkB = await reader.read();
    const textB = decoder.decode(chunkB.value);
    expect(textB).toContain('event: event.b');
    expect(textB).toContain('channel B');

    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('replays missed messages using Last-Event-ID header', async () => {
    const replayChannel = `replay_${Date.now()}`;

    // Publish 3 events with explicit IDs
    for (const id of ['evt_1', 'evt_2', 'evt_3']) {
      await app.request('/publish', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
        },
        body: JSON.stringify({
          channel: replayChannel,
          event: 'item.update',
          data: { seq: id },
          id,
        }),
      });
    }

    // Connect with Last-Event-ID: evt_1 -> should replay evt_2 and evt_3
    const streamRes = await app.request(`/stream?channel=${replayChannel}`, {
      headers: {
        'Last-Event-ID': 'evt_1',
      },
    });

    expect(streamRes.status).toBe(200);
    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();

    // Handshake
    const handshakeChunk = await reader.read();
    const handshakeText = decoder.decode(handshakeChunk.value);
    expect(handshakeText).toContain('event: connected');

    // Missed event 2
    const chunk2 = await reader.read();
    const text2 = decoder.decode(chunk2.value);
    expect(text2).toContain('id: evt_2');
    expect(text2).toContain('seq');

    // Missed event 3
    const chunk3 = await reader.read();
    const text3 = decoder.decode(chunk3.value);
    expect(text3).toContain('id: evt_3');

    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
  });

  it('enforces private channel token authorization end-to-end', async () => {
    const privateChannel = `private:tenant_${Date.now()}`;

    // Requesting without token fails
    const rejectedRes = await app.request(`/stream?channel=${privateChannel}`);
    expect(rejectedRes.status).toBe(401);

    // Generate token
    const tokenRes = await app.request('/auth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env.PUBLISH_SECRET_KEY}`,
      },
      body: JSON.stringify({ channel: privateChannel, ttlSeconds: 60 }),
    });

    expect(tokenRes.status).toBe(200);
    const { token } = await tokenRes.json();

    // Connect with generated token
    const streamRes = await app.request(
      `/stream?channel=${privateChannel}&token=${token}`
    );
    expect(streamRes.status).toBe(200);

    const reader = streamRes.body!.getReader();
    const decoder = new TextDecoder();
    const chunk = await reader.read();
    const text = decoder.decode(chunk.value);
    expect(text).toContain('event: connected');
    expect(text).toContain(privateChannel);

    await reader.cancel();
    await new Promise((r) => setTimeout(r, 50));
  });
});
