import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Hono } from 'hono';

export const playgroundRoute = new Hono();

playgroundRoute.get('/playground', async (c) => {
  const htmlContent = await readFile(join(process.cwd(), 'examples', 'client.html'), 'utf8');
  return c.html(htmlContent);
});
