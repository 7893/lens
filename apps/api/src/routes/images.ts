import { Hono } from 'hono';
import { ApiBindings, DBImage } from '@lens/shared';
import { toImageResult } from '../utils/transform';

const images = new Hono<{ Bindings: ApiBindings }>();

// Latest images
images.get('/latest', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100',
  ).all<DBImage>();

  return c.json({ results: results.map((img) => toImageResult(img)), total: results.length });
});

// Image details
images.get('/:id', async (c) => {
  const id = c.req.param('id');
  const image = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<DBImage>();
  if (!image) return c.json({ error: 'Not found' }, 404);

  const meta = JSON.parse(image.meta_json || '{}');
  return c.json({
    ...toImageResult(image),
    stats: { views: meta.views, downloads: meta.downloads, likes: meta.likes },
    source: meta.links?.html,
  });
});

// Image proxy
images.get('/display/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const object = await c.env.R2.get(`display/${filename}`);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

images.get('/raw/:filename', async (c) => {
  const filename = c.req.param('filename');
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const object = await c.env.R2.get(`raw/${filename}`);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  return new Response(object.body, { headers });
});

export default images;
