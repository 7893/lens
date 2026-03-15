import { MiddlewareHandler } from 'hono';
import { ApiBindings } from '@lens/shared';

export const rateLimit: MiddlewareHandler<{ Bindings: ApiBindings }> = async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const { success } = await c.env.RATE_LIMITER.limit({ key: ip });
  if (!success) return c.json({ error: 'Rate limit exceeded, max 10 searches/min' }, 429);
  await next();
};
