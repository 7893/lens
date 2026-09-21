import { Hono } from 'hono';
import { ApiBindings, DBImage, ImageDetail } from '@lens/shared';
import { toImageResult, toImageDetail } from '../utils/transform';

const images = new Hono<{ Bindings: ApiBindings }>();

/**
 * GET /api/images/latest
 * Fetches the most recent images from the database with KV caching.
 */
images.get('/latest', async (c) => {
  const cacheKey = 'cache:latest';
  const cached = await c.env.SETTINGS.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached));

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100',
  ).all<DBImage>();

  const data = {
    results: results.map((img) => toImageResult(img)),
    total: results.length,
  };

  // Cache for 1 hour
  c.executionCtx.waitUntil(c.env.SETTINGS.put(cacheKey, JSON.stringify(data), { expirationTtl: 3600 }));
  return c.json(data);
});

/**
 * GET /api/images/:id
 * Fetches flagship image details for the modal view.
 */
images.get('/:id', async (c) => {
  const id = c.req.param('id');
  const cacheKey = `cache:detail:${id}`;

  // L1: KV Cache
  const cached = await c.env.SETTINGS.get(cacheKey);
  if (cached) return c.json(JSON.parse(cached));

  // L2: D1 Query
  const image = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<DBImage>();
  if (!image) return c.json({ error: 'Image not found' }, 404);

  const detail: ImageDetail = toImageDetail(image);

  // Cache details for 24 hours
  c.executionCtx.waitUntil(c.env.SETTINGS.put(cacheKey, JSON.stringify(detail), { expirationTtl: 86400 }));

  return c.json(detail);
});

/**
 * Image Proxy Service
 * Serves images directly from R2 with extreme edge caching (1 year).
 * Supports:
 * - Root monthly raw images: /:yearmonth/:filename (e.g. /202609/photo.jpg)
 * - Monthly display thumbnails: /display/:yearmonth/:filename (e.g. /display/202609/photo.jpg)
 * - Legacy flat thumbnails: /display/:filename with transparent fallback to reorganized keys
 */

// 3-segment proxy: /display/:yearmonth/:filename
images.get('/:prefix/:yearmonth/:filename', async (c) => {
  const { prefix, yearmonth, filename } = c.req.param();
  if (prefix !== 'display') return c.text('Invalid asset type', 400);
  if (!/^\d{6}$/.test(yearmonth)) return c.text('Invalid yearmonth', 400);
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const cache = caches.default;
  const cachedResponse = await cache.match(c.req.raw);
  if (cachedResponse) return cachedResponse;

  // 1. Try monthly display key: display/${yearmonth}/${filename}
  let object = await c.env.R2.get(`${prefix}/${yearmonth}/${filename}`);

  // 2. Fallback to flat path if not yet reorganized: display/${filename}
  if (!object) {
    object = await c.env.R2.get(`${prefix}/${filename}`);
  }

  if (!object) return c.text('Asset not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  const response = new Response(object.body, { headers });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));

  return response;
});

// 2-segment proxy: /display/:filename or /:yearmonth/:filename
images.get('/:type/:filename', async (c) => {
  const { type, filename } = c.req.param();

  const isDisplay = type === 'display';
  const isYearMonth = /^\d{6}$/.test(type);

  if (!isDisplay && !isYearMonth) return c.text('Invalid asset type', 400);
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const cache = caches.default;
  const cachedResponse = await cache.match(c.req.raw);
  if (cachedResponse) return cachedResponse;

  let object = null;

  if (isDisplay) {
    // 1. Try legacy flat key first: display/${filename}
    object = await c.env.R2.get(`display/${filename}`);

    // 2. Fallback: if already migrated, find target key from D1
    if (!object) {
      const photoId = filename.replace(/\.jpg$/, '');
      const row = await c.env.DB.prepare('SELECT display_key FROM images WHERE id = ?')
        .bind(photoId)
        .first<{ display_key: string }>();
      if (row?.display_key && row.display_key !== `display/${filename}`) {
        object = await c.env.R2.get(row.display_key);
      }
    }
  } else if (isYearMonth) {
    // Raw image in root monthly archive: ${yearmonth}/${filename}
    object = await c.env.R2.get(`${type}/${filename}`);

    // Fallback: check legacy raw/${filename}
    if (!object) {
      object = await c.env.R2.get(`raw/${filename}`);
    }
  }

  if (!object) return c.text('Asset not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  const response = new Response(object.body, { headers });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));

  return response;
});

export default images;
