import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env';

function createRedisClient(role: 'pub' | 'sub'): Redis {
  const options: RedisOptions = {
    retryStrategy(times) {
      // Exponential backoff capped at 3 seconds
      const delay = Math.min(times * 150, 3000);
      console.warn(`[ChronoStream:redis:${role}] Reconnecting in ${delay}ms (attempt #${times})`);
      return delay;
    },
    // Required for dedicated subscriber connections to avoid timeout errors
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };

  // Support TLS automatically when rediss:// scheme is passed (e.g. Upstash)
  if (env.REDIS_URL.startsWith('rediss://')) {
    options.tls = {
      rejectUnauthorized: false,
    };
  }

  const client = new Redis(env.REDIS_URL, options);

  client.on('connect', () => {
    console.log(`[ChronoStream:redis:${role}] Socket connected`);
  });

  client.on('ready', () => {
    console.log(`[ChronoStream:redis:${role}] Client ready`);
  });

  client.on('error', (err) => {
    console.error(`[ChronoStream:redis:${role}] Error: ${err.message}`);
  });

  client.on('close', () => {
    console.warn(`[ChronoStream:redis:${role}] Connection closed`);
  });

  client.on('reconnecting', () => {
    console.log(`[ChronoStream:redis:${role}] Reconnecting to Redis...`);
  });

  return client;
}

export const redisPub = createRedisClient('pub');
export const redisSub = createRedisClient('sub');

export async function closeRedis(): Promise<void> {
  console.log('[ChronoStream:redis] Disconnecting Redis clients gracefully...');
  await Promise.allSettled([
    redisPub.quit().catch(() => redisPub.disconnect()),
    redisSub.quit().catch(() => redisSub.disconnect()),
  ]);
}
