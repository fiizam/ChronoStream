import { cors } from 'hono/cors';
import { env } from '../config/env.ts';

export const corsMiddleware = cors({
  origin: (origin: string) => {
    if (env.ALLOWED_ORIGINS.includes('*') || !origin) {
      return origin || '*';
    }

    if (env.ALLOWED_ORIGINS.includes(origin)) {
      return origin;
    }

    return null;
  },
  allowMethods: ['GET', 'POST', 'OPTIONS', 'HEAD'],
  allowHeaders: ['Content-Type', 'Authorization', 'Last-Event-ID', 'Cache-Control', 'X-Requested-With'],
  exposeHeaders: ['Content-Type'],
  maxAge: 86400,
});
