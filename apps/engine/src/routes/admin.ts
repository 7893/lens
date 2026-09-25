import { bodyLimit } from 'hono/body-limit';
import { adminAuth } from '../middleware/adminAuth';
import { Hono } from 'hono';
import { ApiBindings, UnsplashPhoto, IngestionTask } from '@lens/shared';

const admin = new Hono<{ Bindings: ApiBindings }>();

admin.use('*', adminAuth);
admin.use('*', bodyLimit({ maxSize: 8192 }));

admin.post('/compensate', async (c) => {
  const body = await c.req.json().catch(() => null);
  const photoIds: unknown = body?.photoIds;
  if (
    !Array.isArray(photoIds) ||
    photoIds.length < 1 ||
    photoIds.length > 20 ||
    !photoIds.every((id: unknown) => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id))
  ) {
    return c.json({ error: 'photoIds must contain 1 to 20 valid photo identifiers' }, 400);
  }

  let enqueued = 0;
  const errors = [];

  for (const id of new Set(photoIds)) {
    try {
      const res = await fetch(`https://api.unsplash.com/photos/${id}`, {
        headers: { Authorization: `Client-ID ${c.env.UNSPLASH_API_KEY}`, 'Accept-Version': 'v1' },
      });
      if (!res.ok) {
        errors.push({ id, status: res.status });
        continue;
      }
      const p = (await res.json()) as UnsplashPhoto;
      const task: IngestionTask = {
        type: 'process-photo',
        photoId: p.id,
        downloadUrl: p.urls.raw,
        displayUrl: p.urls.regular,
        photographer: p.user.name,
        source: 'unsplash',
        meta: p,
      };
      await c.env.PHOTO_QUEUE.send(task);
      enqueued++;
    } catch (e: unknown) {
      errors.push({ id, error: e instanceof Error ? e.message : 'Unknown error' });
    }
  }

  return c.json({ enqueued, errors });
});

export default admin;
