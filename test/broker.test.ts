import { describe, expect, it, beforeEach } from 'bun:test';
import { ChannelBroker } from '../src/lib/broker';
import type { SSEStreamingApi } from 'hono/streaming';

class MockRedisHub {
  public subscribedChannels = new Set<string>();
  public subscribedPatterns = new Set<string>();
  public subListeners: Array<(channel: string, message: string) => void> = [];
  public psubListeners: Array<(pattern: string, channel: string, message: string) => void> = [];

  createSubClient() {
    return {
      status: 'ready',
      on: (event: string, callback: (...args: any[]) => void) => {
        if (event === 'message') {
          this.subListeners.push(callback);
        } else if (event === 'pmessage') {
          this.psubListeners.push(callback);
        }
        return this;
      },
      subscribe: async (channel: string) => {
        this.subscribedChannels.add(channel);
        return 1;
      },
      unsubscribe: async (channel: string) => {
        this.subscribedChannels.delete(channel);
        return 1;
      },
      psubscribe: async (pattern: string) => {
        this.subscribedPatterns.add(pattern);
        return 1;
      },
      punsubscribe: async (pattern: string) => {
        this.subscribedPatterns.delete(pattern);
        return 1;
      },
    };
  }

  createPubClient() {
    return {
      status: 'ready',
      publish: async (channel: string, message: string) => {
        // In real Redis, pub message triggers sub listener for subscribed channels
        if (this.subscribedChannels.has(channel)) {
          for (const cb of this.subListeners) {
            cb(channel, message);
          }
        }
        for (const pattern of this.subscribedPatterns) {
          const escaped = pattern.replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&').replace(/\*/g, '.*');
          if (new RegExp(`^${escaped}$`).test(channel)) {
            for (const cb of this.psubListeners) {
              cb(pattern, channel, message);
            }
          }
        }
        return 1;
      },
    };
  }
}

function createMockStream(): {
  stream: SSEStreamingApi;
  written: Array<{ data: string; event?: string; id?: string; retry?: number }>;
  abortCallbacks: Array<() => void>;
  triggerAbort: () => void;
} {
  const written: Array<{ data: string; event?: string; id?: string; retry?: number }> = [];
  const abortCallbacks: Array<() => void> = [];

  const stream = {
    writeSSE: async (data: any) => {
      written.push(data);
    },
    onAbort: (cb: () => void) => {
      abortCallbacks.push(cb);
    },
    aborted: false,
    sleep: async () => {},
    close: async () => {},
  } as unknown as SSEStreamingApi;

  return {
    stream,
    written,
    abortCallbacks,
    triggerAbort: () => {
      (stream as any).aborted = true;
      for (const cb of abortCallbacks) cb();
    },
  };
}

describe('ChannelBroker Multiplexing & Zero Memory Leak', () => {
  let hub: MockRedisHub;
  let mockPub: any;
  let mockSub: any;
  let testBroker: ChannelBroker;

  beforeEach(() => {
    hub = new MockRedisHub();
    mockPub = hub.createPubClient();
    mockSub = hub.createSubClient();
    testBroker = new ChannelBroker(mockPub, mockSub);
  });

  it('subscribes to Redis only when the first client joins a channel', async () => {
    const client1 = createMockStream();
    const client2 = createMockStream();

    await testBroker.addClient('orders', client1.stream);
    expect(hub.subscribedChannels.has('orders')).toBe(true);
    expect(hub.subscribedChannels.size).toBe(1);

    // Second client joining same channel should not trigger additional Redis subscribe
    await testBroker.addClient('orders', client2.stream);
    expect(hub.subscribedChannels.size).toBe(1);

    const stats = testBroker.getStats();
    expect(stats.channelsCount).toBe(1);
    expect(stats.totalClientsCount).toBe(2);
    expect(stats.channels['orders']).toBe(2);
  });

  it('fans out Redis messages to all active clients in the channel', async () => {
    const client1 = createMockStream();
    const client2 = createMockStream();
    const otherClient = createMockStream();

    await testBroker.addClient('chat', client1.stream);
    await testBroker.addClient('chat', client2.stream);
    await testBroker.addClient('other', otherClient.stream);

    await testBroker.publish('chat', {
      channel: 'chat',
      event: 'user_joined',
      data: { username: 'alice' },
    });

    // Small tick to allow async fanout microtasks to complete
    await new Promise((r) => setTimeout(r, 10));

    expect(client1.written.length).toBe(1);
    expect(client1.written[0].event).toBe('user_joined');
    expect(JSON.parse(client1.written[0].data)).toEqual({ username: 'alice' });

    expect(client2.written.length).toBe(1);
    expect(client2.written[0].event).toBe('user_joined');

    // Other channel client should NOT receive the message
    expect(otherClient.written.length).toBe(0);
  });

  it('unsubscribes from Redis and cleans map when the last client disconnects', async () => {
    const client1 = createMockStream();
    const client2 = createMockStream();

    await testBroker.addClient('alerts', client1.stream);
    await testBroker.addClient('alerts', client2.stream);
    expect(hub.subscribedChannels.has('alerts')).toBe(true);

    // Remove client 1: channel should still have 1 listener and remain subscribed
    await testBroker.removeClient('alerts', client1.stream);
    expect(hub.subscribedChannels.has('alerts')).toBe(true);
    expect(testBroker.getStats().channels['alerts']).toBe(1);

    // Remove client 2 (last listener): channel must be deleted and unsubscribed from Redis
    await testBroker.removeClient('alerts', client2.stream);
    expect(hub.subscribedChannels.has('alerts')).toBe(false);
    expect(testBroker.getStats().channelsCount).toBe(0);
    expect(testBroker.getStats().totalClientsCount).toBe(0);
  });

  it('cleans up client when writeSSE fails during fan-out', async () => {
    const brokenStream = {
      writeSSE: async () => {
        throw new Error('Socket abruptly closed');
      },
      onAbort: () => {},
      aborted: false,
    } as unknown as SSEStreamingApi;

    await testBroker.addClient('metrics', brokenStream);
    expect(hub.subscribedChannels.has('metrics')).toBe(true);

    // Publishing will hit the broken stream, catch the error, and remove it
    await testBroker.publish('metrics', {
      channel: 'metrics',
      data: 'test-data',
    });

    await new Promise((r) => setTimeout(r, 15));

    // Channel should now be cleaned up because the only listener failed
    expect(hub.subscribedChannels.has('metrics')).toBe(false);
    expect(testBroker.getStats().channelsCount).toBe(0);
  });

  it('handles raw strings from external backends (Laravel, Python, Go)', async () => {
    const client = createMockStream();
    await testBroker.addClient('raw_channel', client.stream);

    // Simulate external Redis client directly publishing a raw string
    for (const cb of hub.subListeners) {
      cb('raw_channel', 'plain-text-payload');
    }

    await new Promise((r) => setTimeout(r, 10));

    expect(client.written.length).toBe(1);
    expect(client.written[0].event).toBe('message');
    expect(client.written[0].data).toBe('plain-text-payload');
  });

  it('delivers events to wildcard pattern subscribers (orders:*) when publishing to sub-channels', async () => {
    const client = createMockStream();
    await testBroker.addClient('orders:*', client.stream);

    expect(hub.subscribedPatterns.has('orders:*')).toBe(true);

    await testBroker.publish('orders:101', {
      channel: 'orders:101',
      event: 'order.created',
      data: { orderId: 101 },
    });

    await testBroker.publish('orders:202', {
      channel: 'orders:202',
      event: 'order.updated',
      data: { orderId: 202 },
    });

    // Other channel should not match
    await testBroker.publish('users:99', {
      channel: 'users:99',
      event: 'user.created',
      data: { userId: 99 },
    });

    await new Promise((r) => setTimeout(r, 15));

    expect(client.written.length).toBe(2);
    expect(client.written[0].event).toBe('order.created');
    expect(JSON.parse(client.written[0].data)).toEqual({ orderId: 101 });
    expect(client.written[1].event).toBe('order.updated');
    expect(JSON.parse(client.written[1].data)).toEqual({ orderId: 202 });
  });
});
