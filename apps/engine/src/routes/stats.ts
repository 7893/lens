import { Hono } from 'hono';
import { ApiBindings } from '@lens/shared';

const stats = new Hono<{ Bindings: ApiBindings }>();

stats.get('/', async (c) => {
  const cacheKey = 'stats:summary';
  const cached = await c.env.SETTINGS.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached));

  const { results } = await c.env.DB.prepare(
    `SELECT 
      COUNT(*) as total,
      SUM(CASE WHEN ai_model = 'llama-4-scout' THEN 1 ELSE 0 END) as evolved,
      SUM(CASE WHEN created_at > strftime('%s','now')*1000 - 86400000 THEN 1 ELSE 0 END) as last_24h
    FROM images`,
  ).all();

  const row = results[0] as { total: number; evolved: number; last_24h: number };
  const data = {
    total: row.total,
    recent: row.last_24h,
    evolved: row.evolved,
  };

  c.executionCtx.waitUntil(c.env.SETTINGS.put(cacheKey, JSON.stringify(data), { expirationTtl: 60 }));
  return c.json(data);
});

export default stats;
