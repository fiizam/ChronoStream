import type { Redis } from 'ioredis';
import type { SSEStreamingApi } from 'hono/streaming';
import type { BrokerStats, PublishPayload } from '../types/index';
import { redisPub, redisSub } from './redis';
import { env } from '../config/env';

export class ChannelBroker {
  private channels = new Map<string, Set<SSEStreamingApi>>();
  private history = new Map<string, Array<{ id?: string; event: string; data: string; retry?: number }>>();
  private redisPub: Redis;
  private redisSub: Redis;

  constructor(pubClient: Redis, subClient: Redis) {
    this.redisPub = pubClient;
    this.redisSub = subClient;

    // Fan-out incoming Redis Pub/Sub messages to local connected SSE streams
    this.redisSub.on('message', (channel: string, rawMessage: string) => {
      this.handleIncomingMessage(channel, rawMessage);
    });

    if (typeof (this.redisSub as any).on === 'function') {
      (this.redisSub as any).on('pmessage', (pattern: string, channel: string, rawMessage: string) => {
        this.handleIncomingMessage(channel, rawMessage, pattern);
      });
    }
  }

  private isPattern(channel: string): boolean {
    return channel.includes('*');
  }

  private matchPattern(pattern: string, channel: string): boolean {
    const escaped = pattern
      .replace(/[-/\\^$+?.()|[\]{}]/g, '\\$&')
      .replace(/\*/g, '.*');
    return new RegExp(`^${escaped}$`).test(channel);
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
        if (this.isPattern(channel) && typeof (this.redisSub as any).psubscribe === 'function') {
          await (this.redisSub as any).psubscribe(channel);
          console.log(`[ChronoStream:broker] Pattern subscribed to Redis channel "${channel}" (first client)`);
        } else {
          await this.redisSub.subscribe(channel);
          console.log(`[ChronoStream:broker] Subscribed to Redis channel "${channel}" (first client)`);
        }
      } catch (err) {
        // Rollback state if subscription fails
        clientSet.delete(stream);
        if (clientSet.size === 0) {
          this.channels.delete(channel);
        }
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
        if (this.isPattern(channel) && typeof (this.redisSub as any).punsubscribe === 'function') {
          await (this.redisSub as any).punsubscribe(channel);
          console.log(`[ChronoStream:broker] Pattern unsubscribed from Redis channel "${channel}" (0 local listeners)`);
        } else {
          await this.redisSub.unsubscribe(channel);
          console.log(`[ChronoStream:broker] Unsubscribed from Redis channel "${channel}" (0 local listeners)`);
        }
      } catch (err) {
        console.error(`[ChronoStream:broker] Error unsubscribing from "${channel}":`, err);
      }
    }
  }

  /**
   * Publishes an event to a Redis channel for broadcast across all cluster nodes.
   * Also records into history ring-buffer if payload.id is specified.
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

    // Record into history ring-buffer if an event id is provided
    if (payload.id && typeof payload.id === 'string' && payload.id.trim() !== '') {
      const historyItem = {
        id: payload.id,
        event: payload.event || 'message',
        data: stringifiedData,
        retry: payload.retry,
      };

      // In-memory bounded buffer
      let historyList = this.history.get(channel);
      if (!historyList) {
        historyList = [];
        this.history.set(channel, historyList);
      }
      historyList.push(historyItem);
      if (historyList.length > env.HISTORY_SIZE) {
        historyList.splice(0, historyList.length - env.HISTORY_SIZE);
      }

      // Persist to Redis key if available
      if (typeof (this.redisPub as any).rpush === 'function') {
        const key = `chronostream:history:${channel}`;
        const serialized = JSON.stringify(historyItem);
        try {
          await (this.redisPub as any).rpush(key, serialized);
          if (typeof (this.redisPub as any).ltrim === 'function') {
            await (this.redisPub as any).ltrim(key, -env.HISTORY_SIZE, -1);
          }
          if (typeof (this.redisPub as any).expire === 'function') {
            await (this.redisPub as any).expire(key, env.HISTORY_TTL_SECONDS);
          }
        } catch (err) {
          console.warn(`[ChronoStream:broker] Failed to persist history for "${channel}":`, err);
        }
      }
    }

    return await this.redisPub.publish(channel, messagePayload);
  }

  /**
   * Retrieves missed messages for replay after lastEventId.
   */
  async getMissedMessages(
    channel: string,
    lastEventId: string
  ): Promise<Array<{ id?: string; event: string; data: string; retry?: number }>> {
    if (!lastEventId || typeof lastEventId !== 'string') {
      return [];
    }

    let rawStrings: string[] | null = null;
    if (typeof (this.redisPub as any).lrange === 'function') {
      try {
        const key = `chronostream:history:${channel}`;
        const list = await (this.redisPub as any).lrange(key, 0, -1);
        if (Array.isArray(list) && list.length > 0) {
          rawStrings = list;
        }
      } catch (err) {
        console.warn(`[ChronoStream:broker] Failed to read history from Redis for "${channel}":`, err);
      }
    }

    let items: Array<{ id?: string; event: string; data: string; retry?: number }>;
    if (rawStrings !== null) {
      items = rawStrings
        .map((s) => {
          try {
            return JSON.parse(s);
          } catch {
            return null;
          }
        })
        .filter((item): item is { id?: string; event: string; data: string; retry?: number } => item !== null);
    } else {
      items = this.history.get(channel) || [];
    }

    const index = items.findIndex((msg) => msg.id === lastEventId);
    if (index !== -1) {
      return items.slice(index + 1);
    }
    return [];
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

  private async dispatchToClientSet(
    channelKey: string,
    clientSet: Set<SSEStreamingApi>,
    event: string,
    data: string,
    id?: string,
    retry?: number
  ): Promise<void> {
    const deadStreams: SSEStreamingApi[] = [];

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

    if (deadStreams.length > 0) {
      for (const deadStream of deadStreams) {
        await this.removeClient(channelKey, deadStream);
      }
    }
  }

  /**
   * Internal message handler supporting both ChronoStream JSON payloads
   * and raw strings from third-party publishers (Laravel, Python, Go, etc.).
   */
  private async handleIncomingMessage(channel: string, rawMessage: string, pattern?: string): Promise<void> {
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

    if (pattern) {
      const clientSet = this.channels.get(pattern);
      if (clientSet && clientSet.size > 0) {
        await this.dispatchToClientSet(pattern, clientSet, event, data, id, retry);
      }
      return;
    }

    const clientSet = this.channels.get(channel);
    if (clientSet && clientSet.size > 0) {
      await this.dispatchToClientSet(channel, clientSet, event, data, id, retry);
    }

    // Fallback if psubscribe is not supported (e.g. simple mock Redis emitting only 'message')
    if (typeof (this.redisSub as any).psubscribe !== 'function') {
      for (const [key, set] of this.channels.entries()) {
        if (key !== channel && this.isPattern(key) && this.matchPattern(key, channel)) {
          if (set && set.size > 0) {
            await this.dispatchToClientSet(key, set, event, data, id, retry);
          }
        }
      }
    }
  }

  /**
   * Graceful cleanup for broker instances.
   */
  async close(): Promise<void> {
    const activeChannels = Array.from(this.channels.keys());
    const exactChannels = activeChannels.filter((ch) => !this.isPattern(ch));
    const patternChannels = activeChannels.filter((ch) => this.isPattern(ch));

    if (exactChannels.length > 0) {
      await this.redisSub.unsubscribe(...exactChannels);
    }
    if (patternChannels.length > 0) {
      if (typeof (this.redisSub as any).punsubscribe === 'function') {
        await (this.redisSub as any).punsubscribe(...patternChannels);
      } else {
        await this.redisSub.unsubscribe(...patternChannels);
      }
    }
    this.channels.clear();
    this.history.clear();
  }
}

export const broker = new ChannelBroker(redisPub, redisSub);
