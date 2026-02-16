import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SearchResponse, ImageDetailResponse, DBImage, ImageResult } from '@pic/shared';

// Define Bindings
type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  R2: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

// Middleware
app.use('/*', cors());

// 1. Health Check
app.get('/health', (c) => c.json({ status: 'healthy', version: '6.0.0' }));

// 2. Latest images (default gallery)
app.get('/api/latest', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100'
  ).all<DBImage>();

  const images: ImageResult[] = results.map(img => {
    const meta = JSON.parse(img.meta_json || '{}');
    return {
      id: img.id,
      url: `/image/display/${img.id}.jpg`,
      width: img.width,
      height: img.height,
      caption: img.ai_caption,
      tags: JSON.parse(img.ai_tags || '[]'),
      photographer: meta.user?.name,
      blurHash: meta.blur_hash,
      color: img.color,
    };
  });

  return c.json({ results: images, total: images.length });
});

// 3. Semantic Search
app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const start = Date.now();

  try {
    const embeddingResp = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', {
      text: [q]
    }) as { data: number[][] };
    const vector = embeddingResp.data[0];

    const vecResults = await c.env.VECTORIZE.query(vector, { topK: 100 });

    if (vecResults.matches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, took: Date.now() - start });
    }

    const ids = vecResults.matches.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM images WHERE id IN (${placeholders})`
    ).bind(...ids).all<DBImage>();

    const images: ImageResult[] = vecResults.matches.map(match => {
      const dbImage = results.find(r => r.id === match.id);
      if (!dbImage) return null;
      const meta = JSON.parse(dbImage.meta_json || '{}');
      return {
        id: dbImage.id,
        url: `/image/display/${dbImage.id}.jpg`,
        width: dbImage.width,
        height: dbImage.height,
        caption: dbImage.ai_caption,
        tags: JSON.parse(dbImage.ai_tags || '[]'),
        score: match.score,
        photographer: meta.user?.name,
        blurHash: meta.blur_hash,
        color: dbImage.color,
      };
    }).filter(Boolean) as ImageResult[];

    return c.json<SearchResponse>({ results: images, total: images.length, took: Date.now() - start });
  } catch (err) {
    console.error('Search error:', err);
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

// 3. Image Details
app.get('/api/images/:id', async (c) => {
  const id = c.req.param('id');
  
  const image = await c.env.DB.prepare('SELECT * FROM images WHERE id = ?').bind(id).first<DBImage>();
  
  if (!image) return c.json({ error: 'Not found' }, 404);

  const meta = JSON.parse(image.meta_json || '{}');

  return c.json({
    id: image.id,
    urls: {
      raw: `/image/raw/${image.id}.jpg`,
      display: `/image/display/${image.id}.jpg`
    },
    width: image.width,
    height: image.height,
    color: image.color,
    description: meta.alt_description || meta.description,
    photographer: {
      name: meta.user?.name,
      username: meta.user?.username,
      location: meta.user?.location,
      profile: meta.user?.links?.html,
    },
    exif: meta.exif ? {
      camera: meta.exif.name,
      aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
      exposure: meta.exif.exposure_time ? `${meta.exif.exposure_time}s` : null,
      focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
      iso: meta.exif.iso,
    } : null,
    location: meta.location?.name || null,
    stats: {
      views: meta.views,
      downloads: meta.downloads,
      likes: meta.likes,
    },
    ai: {
      caption: image.ai_caption,
      tags: JSON.parse(image.ai_tags || '[]'),
    },
    source: meta.links?.html,
    createdAt: meta.created_at,
  });
});

// 4. Image Proxy (Optional: if R2 is not public)
// GET /image/:type/:filename
app.get('/image/:type/:filename', async (c) => {
  const type = c.req.param('type'); // 'raw' or 'display'
  const filename = c.req.param('filename');
  const key = `${type === 'raw' ? 'raw' : 'display'}/${filename}`;

  const object = await c.env.R2.get(key);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000'); // Cache 1 year

  return new Response(object.body, { headers });
});

export default app;
