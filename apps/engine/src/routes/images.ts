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
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100'
  ).all<DBImage>();

  const data = { 
    results: results.map((img) => toImageResult(img)), 
    total: results.length 
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
 * Supports both /display/ and /raw/ paths.
 */
const proxyHandler = async (c: any) => {
  const { type, filename } = c.req.param();
  if (!['display', 'raw'].includes(type)) return c.text('Invalid asset type', 400);
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);

  const cache = caches.default;
  const cachedResponse = await cache.match(c.req.raw);
  if (cachedResponse) return cachedResponse;

  const object = await c.env.R2.get(`${type}/${filename}`);
  if (!object) return c.text('Asset not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  
  const response = new Response(object.body, { headers });
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  
  return response;
};

// Registered on both /api/images/proxy and root /image (aliased in index.ts)
images.get('/:type/:filename', proxyHandler);

export default images;
