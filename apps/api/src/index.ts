import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SearchResponse, ImageDetailResponse, DBImage, ImageResult } from '@lens/shared';

// Define Bindings
type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  R2: R2Bucket;
};

const app = new Hono<{ Bindings: Bindings }>();

function toImageResult(img: DBImage, score?: number): ImageResult {
  const meta = JSON.parse(img.meta_json || '{}');
  return {
    id: img.id,
    url: `/image/display/${img.id}.jpg`,
    width: img.width,
    height: img.height,
    caption: img.ai_caption,
    tags: JSON.parse(img.ai_tags || '[]'),
    score,
    photographer: meta.user?.name,
    blurHash: meta.blur_hash,
    color: img.color,
    location: meta.location?.name || null,
    description: meta.alt_description || meta.description || null,
    exif: meta.exif ? {
      camera: meta.exif.name || null,
      aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
      exposure: meta.exif.exposure_time ? `${meta.exif.exposure_time}s` : null,
      focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
      iso: meta.exif.iso || null,
    } : null,
    topics: Object.keys(meta.topic_submissions || {}),
  };
}

// Middleware
app.use('/*', cors());

// 1. Health Check
app.get('/health', (c) => c.json({ status: 'healthy', name: 'lens' }));

// 2. Latest images (default gallery)
app.get('/api/latest', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100'
  ).all<DBImage>();

  const images: ImageResult[] = results.map(img => toImageResult(img));

  return c.json({ results: images, total: images.length });
});

// 3. Semantic Search
app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const start = Date.now();

  try {
    // Query expansion: enrich short queries with related terms
    let expandedQuery = q;
    if (q.split(/\s+/).length <= 4) {
      const expansion = await c.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct' as any, {
        prompt: `Expand this image search query with related visual terms. Reply with ONLY the expanded query, no explanation. Keep it under 30 words.\nQuery: ${q}`,
        max_tokens: 50,
      }) as { response?: string };
      expandedQuery = expansion.response?.trim() || q;
    }

    const embeddingResp = await c.env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: [expandedQuery]
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
      return toImageResult(dbImage, match.score);
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
      display: `/image/display/${image.id}.jpg`,
    },
    width: image.width,
    height: image.height,
    color: image.color,
    blurHash: meta.blur_hash,
    description: meta.description,
    altDescription: meta.alt_description,
    createdAt: meta.created_at,
    promotedAt: meta.promoted_at,
    photographer: {
      name: meta.user?.name,
      username: meta.user?.username,
      bio: meta.user?.bio,
      location: meta.user?.location,
      profile: meta.user?.links?.html,
      profileImage: meta.user?.profile_image?.medium,
      instagram: meta.user?.instagram_username,
      twitter: meta.user?.twitter_username,
      portfolio: meta.user?.portfolio_url,
      totalPhotos: meta.user?.total_photos,
    },
    exif: meta.exif ? {
      make: meta.exif.make,
      model: meta.exif.model,
      camera: meta.exif.name,
      aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
      exposure: meta.exif.exposure_time ? `${meta.exif.exposure_time}s` : null,
      focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
      iso: meta.exif.iso,
    } : null,
    location: meta.location ? {
      name: meta.location.name,
      city: meta.location.city,
      country: meta.location.country,
      latitude: meta.location.position?.latitude,
      longitude: meta.location.position?.longitude,
    } : null,
    topics: Object.entries(meta.topic_submissions || {})
      .filter(([, v]: [string, any]) => v.status === 'approved')
      .map(([k]) => k),
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

// Temporary: regenerate all embeddings with bge-large 1024d
app.post('/api/backfill', async (c) => {
  const offset = Number(c.req.query('offset') || '0');
  const limit = Number(c.req.query('limit') || '5');
  const { results } = await c.env.DB.prepare(
    'SELECT id, ai_caption, ai_tags, meta_json FROM images WHERE ai_caption IS NOT NULL ORDER BY id LIMIT ? OFFSET ?'
  ).bind(limit, offset).all<DBImage>();

  let done = 0;
  for (const img of results) {
    const meta = JSON.parse(img.meta_json || '{}');
    const tags = JSON.parse(img.ai_tags || '[]');
    const parts = [img.ai_caption || ''];
    if (tags.length) parts.push(`Tags: ${tags.join(', ')}`);
    if (meta.alt_description) parts.push(meta.alt_description);
    if (meta.description) parts.push(meta.description);
    if (meta.user?.name) parts.push(`Photographer: ${meta.user.name}`);
    if (meta.location?.name) parts.push(`Location: ${meta.location.name}`);
    const topics = Object.keys(meta.topic_submissions || {});
    if (topics.length) parts.push(`Topics: ${topics.join(', ')}`);

    const resp = await c.env.AI.run('@cf/baai/bge-large-en-v1.5', { text: [parts.join(' | ')] }) as { data: number[][] };
    await c.env.DB.prepare('UPDATE images SET ai_embedding = ? WHERE id = ?')
      .bind(JSON.stringify(resp.data[0]), img.id).run();
    await c.env.VECTORIZE.upsert([{ id: img.id, values: resp.data[0] }]);
    done++;
  }
  return c.json({ offset, limit, done, hasMore: results.length === limit });
});

export default app;
