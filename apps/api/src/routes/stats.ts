import { Hono } from 'hono';
import { ApiBindings } from '@lens/shared';

const stats = new Hono<{ Bindings: ApiBindings }>();

stats.get('/', async (c) => {
  const cacheKey = 'stats:summary';
  const cached = await c.env.SETTINGS.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached));

  const { results } = await c.env.DB.prepare(
    `SELECT 
      (SELECT COUNT(*) FROM images) as total,
      (SELECT COUNT(*) FROM images WHERE created_at > (SELECT MAX(created_at) - 3600000 FROM images)) as recent`,
  ).all();
  const row = results[0] as { total: number; recent: number };
  const data = { total: row.total, recent: row.recent };

  c.executionCtx.waitUntil(c.env.SETTINGS.put(cacheKey, JSON.stringify(data), { expirationTtl: 60 }));
  return c.json(data);
});

export default stats;
