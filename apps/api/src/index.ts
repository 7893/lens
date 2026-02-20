import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SearchResponse, DBImage, ImageResult } from '@lens/shared';

const GATEWAY = { gateway: { id: 'lens-gateway' } };

// Define Bindings
type Bindings = {
  DB: D1Database;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  R2: R2Bucket;
  SETTINGS: KVNamespace;
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
    exif: meta.exif
      ? {
          camera: meta.exif.name || null,
          aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
          exposure: meta.exif.exposure_time ? `${meta.exif.exposure_time}s` : null,
          focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
          iso: meta.exif.iso || null,
        }
      : null,
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
  const hits = (searchHits.get(ip) || []).filter((t) => now - t < 60_000);
  if (hits.length >= 10) return c.json({ error: 'Rate limit exceeded, max 10 searches/min' }, 429);
  hits.push(now);
  searchHits.set(ip, hits);
  await next();
});

// 1. Health Check
app.get('/health', (c) => c.json({ status: 'healthy', name: 'lens' }));

// 1.5 Rebuild embeddings (one-time migration)
app.get('/api/rebuild-embeddings', async (c) => {
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  // Get images that need re-embedding
  const { results } = await c.env.DB.prepare(
    'SELECT id, ai_caption, ai_tags FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at ASC LIMIT ? OFFSET ?',
  )
    .bind(limit, offset)
    .all<{ id: string; ai_caption: string; ai_tags: string }>();

  if (results.length === 0) {
    return c.json({ done: true, processed: 0, offset });
  }

  let processed = 0;
  const vectors: { id: string; values: number[]; metadata: { caption: string } }[] = [];

  for (const row of results) {
    const tags = JSON.parse(row.ai_tags || '[]');
    const text = `${row.ai_caption} ${tags.join(' ')}`;

    const embeddingResp = (await c.env.AI.run('@cf/google/embeddinggemma-300m', { text: [text] }, GATEWAY)) as {
      data: number[][];
    };
    const vector = embeddingResp.data[0];

    // Update D1
    await c.env.DB.prepare('UPDATE images SET ai_embedding = ? WHERE id = ?')
      .bind(JSON.stringify(vector), row.id)
      .run();

    vectors.push({ id: row.id, values: vector, metadata: { caption: row.ai_caption || '' } });
    processed++;
  }

  // Batch upsert to Vectorize
  if (vectors.length > 0) {
    await c.env.VECTORIZE.upsert(vectors);
  }

  return c.json({ done: false, processed, offset, next_offset: offset + limit });
});

// 2. Stats
app.get('/api/stats', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT COUNT(*) as total, MAX(created_at) as last_at, (SELECT COUNT(*) FROM images WHERE created_at > (SELECT MAX(created_at) - 3600000 FROM images)) as recent FROM images',
  ).all();
  const row = results[0] as { total: number; recent: number };
  return c.json({ total: row.total, recent: row.recent });
});

// 3. Latest images (default gallery)
app.get('/api/latest', async (c) => {
  const { results } = await c.env.DB.prepare(
    'SELECT * FROM images WHERE ai_caption IS NOT NULL ORDER BY created_at DESC LIMIT 100',
  ).all<DBImage>();

  const images: ImageResult[] = results.map((img) => toImageResult(img));

  return c.json({ results: images, total: images.length });
});

// 3. Semantic Search
app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  // Cache: same query returns cached result for 10 min
  const cacheKey = new Request(`https://lens-cache/search?q=${encodeURIComponent(q.toLowerCase().trim())}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const start = Date.now();

  try {
    const queryKey = q.toLowerCase().trim();
    const cacheKeyKV = `semantic:cache:${queryKey}`;

    // 1. Level 2 Cache: Try fetching expanded query from KV
    let expandedQuery = await c.env.SETTINGS.get(cacheKeyKV);

    // 2. If not in cache, call AI to expand query
    if (!expandedQuery) {
      if (q.split(/\s+/).length <= 4) {
        const expansion = (await c.env.AI.run(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          '@cf/meta/llama-3.2-3b-instruct' as any,
          {
            prompt: `Expand this image search query with related visual terms. If the query is not in English, translate it to English first, then expand. Reply with ONLY the expanded English query, no explanation. Keep it under 30 words.\nQuery: ${q}`,
            max_tokens: 50,
          },
          GATEWAY,
        )) as { response?: string };
        expandedQuery = expansion.response?.trim() || q;
      } else {
        expandedQuery = q;
      }

      // Store in KV for 7 days asynchronously
      if (expandedQuery && expandedQuery !== q) {
        c.executionCtx.waitUntil(
          c.env.SETTINGS.put(cacheKeyKV, expandedQuery, {
            expirationTtl: 604800,
          }),
        );
      }
    }

    const embeddingResp = (await c.env.AI.run(
      '@cf/google/embeddinggemma-300m',
      { text: [expandedQuery] },
      GATEWAY,
    )) as {
      data: number[][];
    };
    const vector = embeddingResp.data[0];

    const vecResults = await c.env.VECTORIZE.query(vector, { topK: 100 });
    const topScore = vecResults.matches[0]?.score || 0;
    const dynamicThreshold = Math.max(topScore * 0.9, 0.6);
    const relevantMatches = vecResults.matches.filter((m) => m.score >= dynamicThreshold);

    if (relevantMatches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, took: Date.now() - start });
    }

    const ids = relevantMatches.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<DBImage>();

    // Re-rank: LLM scores relevance of top candidates
    const candidates = relevantMatches
      .map((match) => {
        const dbImage = results.find((r) => r.id === match.id);
        if (!dbImage) return null;
        return { dbImage, vecScore: match.score };
      })
      .filter(Boolean) as { dbImage: DBImage; vecScore: number }[];

    let reranked = candidates;
    try {
      // Use BGE Reranker for precise relevance scoring
      const topCandidates = candidates.slice(0, 50);
      const contexts = topCandidates.map((c) => ({ text: c.dbImage.ai_caption || '' }));

      const rerankResp = (await c.env.AI.run(
        '@cf/baai/bge-reranker-base',
        { query: expandedQuery, contexts, top_k: 50 },
        GATEWAY,
      )) as { response: { index: number; score: number }[] };

      if (rerankResp.response?.length) {
        const sorted = rerankResp.response.sort((a, b) => b.score - a.score);
        const rerankedTop = sorted.map((r) => topCandidates[r.index]).filter(Boolean);
        const rest = candidates.slice(50);
        reranked = [...rerankedTop, ...rest];
      }
    } catch (e) {
      console.error('Re-rank failed, using vector order:', e);
    }

    const images: ImageResult[] = reranked.map((c, i) => {
      const score = i < 20 ? 1 - i * 0.01 : c.vecScore; // Re-ranked items get position-based score
      return toImageResult(c.dbImage, score);
    });

    const resp = new Response(JSON.stringify({ results: images, total: images.length, took: Date.now() - start }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, resp.clone()));
    return resp;
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
    exif: meta.exif
      ? {
          make: meta.exif.make,
          model: meta.exif.model,
          camera: meta.exif.name,
          aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
          exposure: meta.exif.exposure_time ? `${meta.exif.exposure_time}s` : null,
          focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
          iso: meta.exif.iso,
        }
      : null,
    location: meta.location
      ? {
          name: meta.location.name,
          city: meta.location.city,
          country: meta.location.country,
          latitude: meta.location.position?.latitude,
          longitude: meta.location.position?.longitude,
        }
      : null,
    topics: Object.entries(meta.topic_submissions || {})
      .filter(([, v]) => (v as { status: string }).status === 'approved')
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
