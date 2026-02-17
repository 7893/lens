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
app.use('/*', cors({ origin: ['https://lens.53.workers.dev'], allowMethods: ['GET'] }));

// Rate limit: simple per-IP sliding window for search (AI-heavy)
const searchHits = new Map<string, number[]>();
app.use('/api/search', async (c, next) => {
  const ip = c.req.header('cf-connecting-ip') || 'unknown';
  const now = Date.now();
  const hits = (searchHits.get(ip) || []).filter(t => now - t < 60_000);
  if (hits.length >= 10) return c.json({ error: 'Rate limit exceeded, max 10 searches/min' }, 429);
  hits.push(now);
  searchHits.set(ip, hits);
  await next();
});

// 1. Health Check
app.get('/health', (c) => c.json({ status: 'healthy', name: 'lens' }));

// 2. Stats
app.get('/api/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT COUNT(*) as total, MAX(created_at) as last_at, (SELECT COUNT(*) FROM images WHERE created_at > (SELECT MAX(created_at) - 3600000 FROM images)) as recent FROM images'
  ).all();
  const row = results[0] as any;
  return c.json({ total: row.total, recent: row.recent });
});

// 3. Latest images (default gallery)
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
        prompt: `Expand this image search query with related visual terms. If the query is not in English, translate it to English first, then expand. Reply with ONLY the expanded English query, no explanation. Keep it under 30 words.\nQuery: ${q}`,
        max_tokens: 50,
      }) as { response?: string };
      expandedQuery = expansion.response?.trim() || q;
    }

    const embeddingResp = await c.env.AI.run('@cf/baai/bge-large-en-v1.5', {
      text: [expandedQuery]
    }) as { data: number[][] };
    const vector = embeddingResp.data[0];

    const vecResults = await c.env.VECTORIZE.query(vector, { topK: 100 });
    const topScore = vecResults.matches[0]?.score || 0;
    const dynamicThreshold = Math.max(topScore * 0.9, 0.6);
    const relevantMatches = vecResults.matches.filter(m => m.score >= dynamicThreshold);

    if (relevantMatches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, took: Date.now() - start });
    }

    const ids = relevantMatches.map(m => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM images WHERE id IN (${placeholders})`
    ).bind(...ids).all<DBImage>();

    // Re-rank: LLM scores relevance of top candidates
    const candidates = relevantMatches.map(match => {
      const dbImage = results.find(r => r.id === match.id);
      if (!dbImage) return null;
      return { dbImage, vecScore: match.score };
    }).filter(Boolean) as { dbImage: DBImage; vecScore: number }[];

    const summaries = candidates.slice(0, 50).map((c, i) => {
      const meta = JSON.parse(c.dbImage.meta_json || '{}');
      return `${i}: ${c.dbImage.ai_caption || ''} | ${meta.alt_description || ''} | ${meta.location?.name || ''}`;
    }).join('\n');

    let reranked = candidates;
    try {
      const rankResp = await c.env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct' as any, {
        prompt: `Given the search query "${q}", rank the most relevant images by their index number. Return ONLY a comma-separated list of index numbers from most to least relevant. Only include the top 20 most relevant.\n\nImages:\n${summaries}`,
        max_tokens: 100,
      }) as { response?: string };

      const rankedIndices = (rankResp.response || '').match(/\d+/g)?.map(Number).filter(i => i < candidates.length) || [];
      if (rankedIndices.length >= 5) {
        const seen = new Set<number>();
        const top: typeof candidates = [];
        for (const i of rankedIndices) {
          if (!seen.has(i)) { seen.add(i); top.push(candidates[i]); }
        }
        // Append remaining candidates not in re-ranked list
        const rest = candidates.filter((_, i) => !seen.has(i));
        reranked = [...top, ...rest];
      }
    } catch (e) {
      console.error('Re-rank failed, using vector order:', e);
    }

    const images: ImageResult[] = reranked.map((c, i) => {
      const score = i < 20 ? 1 - i * 0.01 : c.vecScore; // Re-ranked items get position-based score
      return toImageResult(c.dbImage, score);
    });

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
  const type = c.req.param('type');
  const filename = c.req.param('filename');
  if (!/^[a-zA-Z0-9_-]+\.jpg$/.test(filename)) return c.text('Invalid filename', 400);
  const key = `${type === 'raw' ? 'raw' : 'display'}/${filename}`;

  const object = await c.env.R2.get(key);
  if (!object) return c.text('Image not found', 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('cache-control', 'public, max-age=31536000, immutable');

  return new Response(object.body, { headers });
});

export default app;
