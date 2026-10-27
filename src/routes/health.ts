import { Hono } from 'hono';
import { redisPub, redisSub } from '../lib/redis.ts';
import { broker } from '../lib/broker.ts';
import type { HealthResponse } from '../types/index.ts';

export const healthRoute = new Hono();

const startTime = Date.now();

healthRoute.get('/health', (c) => {
  const pubStatus = redisPub.status;
  const subStatus = redisSub.status;

  const isPubHealthy = pubStatus === 'ready' || pubStatus === 'connecting';
  const isSubHealthy = subStatus === 'ready' || subStatus === 'connecting';

  let overallStatus: 'ok' | 'degraded' | 'error' = 'ok';
  if (!isPubHealthy && !isSubHealthy) {
    overallStatus = 'error';
  } else if (!isPubHealthy || !isSubHealthy || pubStatus !== 'ready' || subStatus !== 'ready') {
    overallStatus = pubStatus === 'ready' && subStatus === 'ready' ? 'ok' : 'degraded';
  }

  const memory = process.memoryUsage();
  const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);

  const response: HealthResponse = {
    status: overallStatus,
    uptimeSeconds,
    timestamp: new Date().toISOString(),
    redis: {
      pub: pubStatus,
      sub: subStatus,
    },
    stats: broker.getStats(),
    memory: {
      rssMB: Number((memory.rss / (1024 * 1024)).toFixed(2)),
      heapUsedMB: Number((memory.heapUsed / (1024 * 1024)).toFixed(2)),
      heapTotalMB: Number((memory.heapTotal / (1024 * 1024)).toFixed(2)),
    },
  };

  const statusCode = overallStatus === 'error' ? 503 : 200;
  return c.json(response, statusCode);
});
