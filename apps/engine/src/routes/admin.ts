import { Hono } from 'hono';
import { ApiBindings, UnsplashPhoto, IngestionTask } from '@lens/shared';

const admin = new Hono<{ Bindings: ApiBindings }>();

admin.post('/compensate', async (c) => {
  const { photoIds } = await c.req.json<{ photoIds: string[] }>();
  if (!photoIds || !Array.isArray(photoIds)) {
    return c.json({ error: 'photoIds must be an array of strings' }, 400);
  }

  let enqueued = 0;
  const errors = [];

  for (const id of photoIds) {
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
