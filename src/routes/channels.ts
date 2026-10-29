import { Hono } from 'hono';
import { broker } from '../lib/broker';

export const channelsRoute = new Hono();

channelsRoute.get('/channels', (c) => {
  const stats = broker.getStats();
  const prefix = c.req.query('prefix');

  if (prefix) {
    const filteredChannels: Record<string, number> = {};
    let totalClientsCount = 0;

    for (const [ch, count] of Object.entries(stats.channels)) {
      if (ch.startsWith(prefix)) {
        filteredChannels[ch] = count;
        totalClientsCount += count;
      }
    }

    return c.json({
      channelsCount: Object.keys(filteredChannels).length,
      totalClientsCount,
      channels: filteredChannels,
    });
  }

  return c.json({
    channelsCount: stats.channelsCount,
    totalClientsCount: stats.totalClientsCount,
    channels: stats.channels,
  });
});

channelsRoute.get('/channels/:name', (c) => {
  const name = c.req.param('name');
  const stats = broker.getStats();
  const subscribers = stats.channels[name] || 0;

  return c.json({
    channel: name,
    subscribers,
    active: subscribers > 0,
  });
});
