import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { SearchResponse, DBImage, ImageResult } from '@lens/shared';

const GATEWAY = { gateway: { id: 'lens-gateway' } };
const TEXT_MODEL = '@cf/meta/llama-4-scout-17b-16e-instruct';
const EMBED_MODEL = '@cf/baai/bge-m3';
const RERANK_MODEL = '@cf/baai/bge-reranker-base';

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
    ai_model: img.ai_model,
    ai_quality_score: img.ai_quality_score,
    entities: img.entities_json ? JSON.parse(img.entities_json) : [],
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

// Rate limit: simple per-IP sliding window for search
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

// 4. Semantic Search
app.get('/api/search', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const cacheKey = new Request(`https://lens-cache/search?q=${encodeURIComponent(q.toLowerCase().trim())}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const start = Date.now();

  try {
    const queryKey = q.toLowerCase().trim();
    const cacheKeyKV = `semantic:cache:${queryKey}`;

    // A. Query Expansion with Llama 4
    let expandedQuery = await c.env.SETTINGS.get(cacheKeyKV);
    if (!expandedQuery) {
      if (q.split(/\s+/).length <= 4) {
        const expansion = (await c.env.AI.run(
          TEXT_MODEL as any,
          {
            prompt: `Expand this image search query with related visual terms. Translate to English if needed. Reply with ONLY the expanded English query. Under 30 words.\nQuery: ${q}`,
            max_tokens: 50,
          },
          GATEWAY,
        )) as { response?: string };
        expandedQuery = expansion.response?.trim() || q;
      } else {
        expandedQuery = q;
      }
      if (expandedQuery && expandedQuery !== q) {
        c.executionCtx.waitUntil(c.env.SETTINGS.put(cacheKeyKV, expandedQuery, { expirationTtl: 604800 }));
      }
    }

    // B. Embedding with BGE-M3
    const embeddingResp = (await c.env.AI.run(EMBED_MODEL, { text: [expandedQuery] }, GATEWAY)) as { data: number[][] };
    const vector = embeddingResp.data[0];

    // C. Vector Search
    const vecResults = await c.env.VECTORIZE.query(vector, { topK: 100 });
    if (vecResults.matches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, took: Date.now() - start });
    }

    // D. Fetch Metadata
    const ids = vecResults.matches.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<DBImage>();

    const candidates = vecResults.matches
      .map((match) => {
        const dbImage = results.find((r) => r.id === match.id);
        if (!dbImage) return null;
        return { dbImage, vecScore: match.score };
      })
      .filter(Boolean) as { dbImage: DBImage; vecScore: number }[];

    // E. Re-rank with BGE-Reranker
    let reranked = candidates;
    try {
      const topCandidates = candidates.slice(0, 50);
      const contexts = topCandidates.map((c) => ({ text: c.dbImage.ai_caption || '' }));
      const rerankResp = (await c.env.AI.run(RERANK_MODEL, { query: expandedQuery, contexts, top_k: 50 }, GATEWAY)) as {
        response: { id: number; score: number }[];
      };

      if (rerankResp.response?.length) {
        const sorted = rerankResp.response.sort((a, b) => b.score - a.score);
        const rerankedTop = sorted.map((r) => topCandidates[r.id]).filter(Boolean);
        const rest = candidates.slice(50);
        reranked = [...rerankedTop, ...rest];
      }
    } catch (e) {
      console.error('Re-rank failed:', e);
    }

    const images: ImageResult[] = reranked.map((c, i) => {
      const score = i < 20 ? 1 - i * 0.01 : c.vecScore;
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

// 5. Image Details
app.get('/api/images/:id', async (c) => {
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

// 6. Image Proxy
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
