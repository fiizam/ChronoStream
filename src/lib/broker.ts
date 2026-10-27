import type { Redis } from 'ioredis';
import type { SSEStreamingApi } from 'hono/streaming';
import type { BrokerStats, PublishPayload } from '../types/index.ts';
import { redisPub, redisSub } from './redis.ts';

export class ChannelBroker {
  private channels = new Map<string, Set<SSEStreamingApi>>();
  private redisPub: Redis;
  private redisSub: Redis;

  constructor(pubClient: Redis, subClient: Redis) {
    this.redisPub = pubClient;
    this.redisSub = subClient;

    // Fan-out incoming Redis Pub/Sub messages to local connected SSE streams
    this.redisSub.on('message', (channel: string, rawMessage: string) => {
      this.handleIncomingMessage(channel, rawMessage);
    });
  }

  /**
   * Adds an SSE stream to the channel. Subscribes to Redis if this is the first client.
   */
  async addClient(channel: string, stream: SSEStreamingApi): Promise<void> {
    let clientSet = this.channels.get(channel);
    const isFirstClient = !clientSet;

    if (!clientSet) {
      clientSet = new Set<SSEStreamingApi>();
      this.channels.set(channel, clientSet);
    }

    clientSet.add(stream);

    if (isFirstClient) {
      try {
        await this.redisSub.subscribe(channel);
        console.log(`[ChronoStream:broker] Subscribed to Redis channel "${channel}" (first client)`);
      } catch (err) {
        // Rollback state if subscription fails
        this.channels.delete(channel);
        console.error(`[ChronoStream:broker] Failed to subscribe to "${channel}":`, err);
        throw err;
      }
    }
  }

  /**
   * Removes an SSE stream from the channel. Unsubscribes from Redis if no clients remain.
   */
  async removeClient(channel: string, stream: SSEStreamingApi): Promise<void> {
    const clientSet = this.channels.get(channel);
    if (!clientSet) return;

    clientSet.delete(stream);

    if (clientSet.size === 0) {
      this.channels.delete(channel);
      try {
        await this.redisSub.unsubscribe(channel);
        console.log(`[ChronoStream:broker] Unsubscribed from Redis channel "${channel}" (0 local listeners)`);
      } catch (err) {
        console.error(`[ChronoStream:broker] Error unsubscribing from "${channel}":`, err);
      }
    }
  }

  /**
   * Publishes an event to a Redis channel for broadcast across all cluster nodes.
   */
  async publish(channel: string, payload: PublishPayload): Promise<number> {
    const stringifiedData =
      typeof payload.data === 'string'
        ? payload.data
        : JSON.stringify(payload.data);

    const messagePayload = JSON.stringify({
      event: payload.event || 'message',
      data: stringifiedData,
      id: payload.id,
      retry: payload.retry,
    });

    return await this.redisPub.publish(channel, messagePayload);
  }

  /**
   * Returns current channel and client metrics.
   */
  getStats(): BrokerStats {
    const channelMap: Record<string, number> = {};
    let totalClientsCount = 0;

    for (const [channel, set] of this.channels.entries()) {
      channelMap[channel] = set.size;
      totalClientsCount += set.size;
    }

    return {
      channelsCount: this.channels.size,
      totalClientsCount,
      channels: channelMap,
    };
  }

  /**
   * Internal message handler supporting both ChronoStream JSON payloads
   * and raw strings from third-party publishers (Laravel, Python, Go, etc.).
   */
  private async handleIncomingMessage(channel: string, rawMessage: string): Promise<void> {
    const clientSet = this.channels.get(channel);
    if (!clientSet || clientSet.size === 0) {
      return;
    }

    let event = 'message';
    let data = rawMessage;
    let id: string | undefined;
    let retry: number | undefined;

    try {
      const parsed = JSON.parse(rawMessage);
      if (parsed && typeof parsed === 'object' && 'data' in parsed) {
        event = parsed.event || 'message';
        data = typeof parsed.data === 'string' ? parsed.data : JSON.stringify(parsed.data);
        id = parsed.id;
        retry = parsed.retry;
      }
    } catch {
      // Raw string payload delivered directly
    }

    const deadStreams: SSEStreamingApi[] = [];

    // Fan-out to all active streams connected to this channel
    for (const stream of clientSet) {
      try {
        await stream.writeSSE({
          event,
          data,
          id,
          retry,
        });
      } catch {
        deadStreams.push(stream);
      }
    }

    // Clean up streams that errored during write
    if (deadStreams.length > 0) {
      for (const deadStream of deadStreams) {
        await this.removeClient(channel, deadStream);
      }
    }
  }

  /**
   * Graceful cleanup for broker instances.
   */
  async close(): Promise<void> {
    const activeChannels = Array.from(this.channels.keys());
    if (activeChannels.length > 0) {
      await this.redisSub.unsubscribe(...activeChannels);
    }
    this.channels.clear();
  }
}

export const broker = new ChannelBroker(redisPub, redisSub);
