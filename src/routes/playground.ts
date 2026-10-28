import { Hono } from 'hono';

export const playgroundRoute = new Hono();

playgroundRoute.get('/playground', async (c) => {
  const htmlContent = await Bun.file(new URL('../../examples/client.html', import.meta.url)).text();
  return c.html(htmlContent);
});
