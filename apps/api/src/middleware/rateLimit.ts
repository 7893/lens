import { MiddlewareHandler } from 'hono';
import { ApiBindings } from '@lens/shared';

const searchHits = new Map<string, number[]>();

export const rateLimit: MiddlewareHandler<{ Bindings: ApiBindings }> = async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const hits = (searchHits.get(ip) || []).filter((t) => now - t < 60_000);

  if (hits.length >= 10) {
    return c.json({ error: 'Rate limit exceeded, max 10 searches/min' }, 429);
  }

  hits.push(now);
  searchHits.set(ip, hits);
  await next();
};
