import type { SSEStreamingApi } from 'hono/streaming';

export interface PublishPayload {
  channel: string;
  event?: string;
  data: unknown;
  id?: string;
  retry?: number;
}

export interface InternalBroadcastMessage {
  event: string;
  data: string;
  id?: string;
  retry?: number;
}

export interface BrokerStats {
  channelsCount: number;
  totalClientsCount: number;
  channels: Record<string, number>;
}

export interface HealthResponse {
  status: 'ok' | 'degraded' | 'error';
  uptimeSeconds: number;
  timestamp: string;
  redis: {
    pub: string;
    sub: string;
  };
  stats: BrokerStats;
  memory: {
    rssMB: number;
    heapUsedMB: number;
    heapTotalMB: number;
  };
}

export interface EnvConfig {
  PORT: number;
  REDIS_URL: string;
  PUBLISH_SECRET_KEY: string;
  ALLOWED_ORIGINS: string[];
  HISTORY_SIZE: number;
  HISTORY_TTL_SECONDS: number;
  RATE_LIMIT_MAX: number;
}

export type ActiveStream = SSEStreamingApi;
