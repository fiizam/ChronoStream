import crypto from 'node:crypto';
import { env } from '../config/env.ts';

/**
 * Checks whether a channel requires private authentication token.
 * A channel is private if it begins with "private:" or "private-".
 */
export function isPrivateChannel(channel: string): boolean {
  return channel.startsWith('private:') || channel.startsWith('private-');
}

/**
 * Generates an HMAC-SHA256 token scoped to one or more channels with an expiration timestamp.
 */
export function generateChannelToken(
  channelScope: string,
  ttlSeconds = 3600
): { token: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = `${channelScope}:${expiresAt}`;
  const signature = crypto
    .createHmac('sha256', env.PUBLISH_SECRET_KEY)
    .update(payload)
    .digest('hex');

  return {
    token: `${expiresAt}.${signature}`,
    expiresAt,
  };
}

/**
 * Verifies an HMAC-SHA256 token against the requested channel scope.
 * Uses constant-time comparison to protect against timing attacks.
 */
export function verifyChannelToken(
  channelScope: string,
  token: string | undefined
): boolean {
  if (!token || typeof token !== 'string') {
    return false;
  }

  const dotIndex = token.indexOf('.');
  if (dotIndex === -1) {
    return false;
  }

  const expiresAtStr = token.slice(0, dotIndex);
  const signature = token.slice(dotIndex + 1);

  const expiresAt = parseInt(expiresAtStr, 10);
  if (isNaN(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) {
    return false;
  }

  const payload = `${channelScope}:${expiresAt}`;
  const expectedSignature = crypto
    .createHmac('sha256', env.PUBLISH_SECRET_KEY)
    .update(payload)
    .digest('hex');

  if (signature.length !== expectedSignature.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'utf8'),
      Buffer.from(expectedSignature, 'utf8')
    );
  } catch {
    return false;
  }
}
