import { createMiddleware } from 'hono/factory';
import { ApiBindings } from '@lens/shared';

// Access may add another perimeter, but identity headers alone are not credentials.
export const adminAuth = createMiddleware<{ Bindings: ApiBindings }>(async (c, next) => {
  const secret = c.env.INTERNAL_API_SECRET;
  if (!secret || secret.length < 32) {
    return c.json({ error: 'Administrative access is not configured' }, 503);
  }
  const header = c.req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || token.length > 1024) return c.json({ error: 'Unauthorized' }, 401);
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
    'verify',
  ]);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(secret));
  // Native HMAC verification avoids a JavaScript string comparison of credentials.
  if (!(await crypto.subtle.verify('HMAC', key, signature, encoder.encode(token)))) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  if (typeof c.env.ADMIN_RATE_LIMITER?.limit !== 'function') {
    return c.json({ error: 'Administrative rate limiting is unavailable' }, 503);
  }
  try {
    const { success } = await c.env.ADMIN_RATE_LIMITER.limit({ key: 'administration' });
    if (!success) return c.json({ error: 'Too many administrative requests' }, 429);
  } catch {
    return c.json({ error: 'Administrative rate limiting is unavailable' }, 503);
  }
  await next();
});
