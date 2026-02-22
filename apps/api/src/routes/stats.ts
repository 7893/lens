import { Hono } from 'hono';
import { ApiBindings } from '@lens/shared';

const stats = new Hono<{ Bindings: ApiBindings }>();

stats.get('/', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT COUNT(*) as total, MAX(created_at) as last_at, (SELECT COUNT(*) FROM images WHERE created_at > (SELECT MAX(created_at) - 3600000 FROM images)) as recent FROM images',
  ).all();
  const row = results[0] as { total: number; recent: number };
  return c.json({ total: row.total, recent: row.recent });
});

export default stats;
