import type { EnvConfig } from '../types/index';

function parsePort(val: string | undefined, defaultPort = 3000): number {
  if (!val) return defaultPort;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 1 || parsed > 65535) {
    console.warn(`[ChronoStream:env] Invalid PORT "${val}", falling back to ${defaultPort}`);
    return defaultPort;
  }
  return parsed;
}

function parseAllowedOrigins(val: string | undefined): string[] {
  if (!val || val.trim() === '*' || val.trim() === '') {
    return ['*'];
  }
  return val
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function parseRedisUrl(val: string | undefined): string {
  const defaultUrl = 'redis://127.0.0.1:6379';
  if (!val || val.trim() === '') {
    return defaultUrl;
  }
  const trimmed = val.trim();
  if (!trimmed.startsWith('redis://') && !trimmed.startsWith('rediss://')) {
    console.warn(`[ChronoStream:env] Redis URL "${trimmed}" lacks redis:// or rediss:// scheme; connecting may fail.`);
  }
  return trimmed;
}

function parseSecretKey(val: string | undefined): string {
  if (!val || val.trim() === '') {
    const devFallback = 'chronostream_dev_secret_key_change_in_production';
    console.warn(
      '[ChronoStream:env] Warning: PUBLISH_SECRET_KEY not set. Using insecure default development key.'
    );
    return devFallback;
  }
  return val.trim();
}

function parsePositiveInt(val: string | undefined, defaultVal: number): number {
  if (!val) return defaultVal;
  const parsed = parseInt(val, 10);
  if (isNaN(parsed) || parsed < 1) {
    console.warn(`[ChronoStream:env] Invalid number "${val}", falling back to ${defaultVal}`);
    return defaultVal;
  }
  return parsed;
}

export const env: EnvConfig = {
  PORT: parsePort(process.env.PORT, 3000),
  REDIS_URL: parseRedisUrl(process.env.REDIS_URL),
  PUBLISH_SECRET_KEY: parseSecretKey(process.env.PUBLISH_SECRET_KEY),
  ALLOWED_ORIGINS: parseAllowedOrigins(process.env.ALLOWED_ORIGINS),
  HISTORY_SIZE: parsePositiveInt(process.env.HISTORY_SIZE, 50),
  HISTORY_TTL_SECONDS: parsePositiveInt(process.env.HISTORY_TTL_SECONDS, 300),
  RATE_LIMIT_MAX: parsePositiveInt(process.env.RATE_LIMIT_MAX, 120),
};

export function getEnvSummary(): Record<string, string | number | string[]> {
  const maskedKey =
    env.PUBLISH_SECRET_KEY.length > 6
      ? `${env.PUBLISH_SECRET_KEY.slice(0, 3)}...${env.PUBLISH_SECRET_KEY.slice(-3)}`
      : '***';

  // Mask credentials in Redis URL if present
  let maskedRedisUrl = env.REDIS_URL;
  try {
    const url = new URL(env.REDIS_URL);
    if (url.password) {
      url.password = '***';
      maskedRedisUrl = url.toString();
    }
  } catch {
    maskedRedisUrl = env.REDIS_URL.replace(/:\/\/[^@]+@/, '://***:***@');
  }

  return {
    PORT: env.PORT,
    REDIS_URL: maskedRedisUrl,
    PUBLISH_SECRET_KEY: maskedKey,
    ALLOWED_ORIGINS: env.ALLOWED_ORIGINS,
    HISTORY_SIZE: env.HISTORY_SIZE,
    HISTORY_TTL_SECONDS: env.HISTORY_TTL_SECONDS,
    RATE_LIMIT_MAX: env.RATE_LIMIT_MAX,
  };
}
