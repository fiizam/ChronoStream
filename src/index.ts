import { Hono } from 'hono';
import { env, getEnvSummary } from './config/env.ts';
import { corsMiddleware } from './middleware/cors.ts';
import { healthRoute } from './routes/health.ts';
import { publishRoute } from './routes/publish.ts';
import { streamRoute } from './routes/stream.ts';
import { authRoute } from './routes/auth.ts';
import { playgroundRoute } from './routes/playground.ts';
import { broker } from './lib/broker.ts';
import { closeRedis } from './lib/redis.ts';

const app = new Hono();

// Global middleware
app.use('*', corsMiddleware);

// Request logger for debugging & observability
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const ms = Date.now() - start;
  // Skip logging long-lived SSE streams every tick
  if (c.req.path !== '/stream') {
    console.log(`[ChronoStream:http] ${c.req.method} ${c.req.path} -> ${c.res.status} (${ms}ms)`);
  }
});

// Root welcome & service metadata
app.get('/', (c) => {
  return c.json({
    service: 'ChronoStream',
    description: 'Server-Sent Events (SSE) Real-Time Broadcasting Engine',
    version: '1.1.0',
    documentation: 'https://github.com/fiizam/ChronoStream',
    endpoints: {
      health: 'GET /health',
      playground: 'GET /playground',
      stream: 'GET /stream?channel=:name[&token=:hmacToken]',
      publish: 'POST /publish (Bearer token required)',
      publishBatch: 'POST /publish/batch (Bearer token required)',
      authToken: 'POST /auth/token (Bearer token required)',
    },
  });
});

// Mount modular sub-routes
app.route('/', healthRoute);
app.route('/', publishRoute);
app.route('/', streamRoute);
app.route('/', authRoute);
app.route('/', playgroundRoute);

// 404 handler
app.notFound((c) => {
  return c.json(
    {
      error: 'Not Found',
      message: `The route "${c.req.path}" does not exist on this server.`,
    },
    404
  );
});

// Global error handler
app.onError((err, c) => {
  console.error('[ChronoStream:server] Uncaught exception:', err);
  return c.json(
    {
      error: 'Internal Server Error',
      message: process.env.NODE_ENV === 'production' ? 'An unexpected error occurred.' : err.message,
    },
    500
  );
});

// Graceful shutdown handling
let isShuttingDown = false;
async function handleShutdown(signal: string) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n[ChronoStream] Received ${signal}. Initiating graceful shutdown...`);

  try {
    await broker.close();
    await closeRedis();
    console.log('[ChronoStream] Shutdown complete. Exiting.');
    process.exit(0);
  } catch (err) {
    console.error('[ChronoStream] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

console.log('----------------------------------------------------');
console.log(' ChronoStream Real-Time SSE Broadcasting Engine     ');
console.log('----------------------------------------------------');
console.log(`Listening on http://localhost:${env.PORT}`);
console.log('Active configuration:', JSON.stringify(getEnvSummary(), null, 2));

export default {
  port: env.PORT,
  fetch: app.fetch,
  // Disable idle timeout for persistent Server-Sent Events connections
  idleTimeout: 0,
};
