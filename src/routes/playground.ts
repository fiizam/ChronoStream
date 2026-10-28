import { readFile } from 'node:fs/promises';
import { Hono } from 'hono';

export const playgroundRoute = new Hono();

playgroundRoute.get('/playground', async (c) => {
  const htmlContent = await readFile(new URL('../../examples/client.html', import.meta.url), 'utf8');
  return c.html(htmlContent);
});
