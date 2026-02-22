import { Hono } from 'hono';
import { ApiBindings, DBImage, SearchResponse, AI_MODELS, AI_GATEWAY } from '@lens/shared';
import { toImageResult } from '../utils/transform';
import { rateLimit } from '../middleware/rateLimit';

type AiTextResponse = { response?: string };
type AiEmbeddingResponse = { data: number[][] };
type AiRerankResponse = { response: { id: number; score: number }[] };

const search = new Hono<{ Bindings: ApiBindings }>();

search.use('/', rateLimit);

search.get('/', async (c) => {
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

    // Query Expansion
    let expandedQuery = await c.env.SETTINGS.get(cacheKeyKV);
    if (!expandedQuery) {
      if (q.split(/\s+/).length <= 4) {
        const expansion = (await c.env.AI.run(
          AI_MODELS.TEXT,
          {
            prompt: `Expand this image search query with related visual terms. Translate to English if needed. Reply with ONLY the expanded English query. Under 30 words.\nQuery: ${q}`,
            max_tokens: 50,
          },
          AI_GATEWAY,
        )) as AiTextResponse;
        expandedQuery = expansion.response?.trim() || q;
      } else {
        expandedQuery = q;
      }
      if (expandedQuery && expandedQuery !== q) {
        c.executionCtx.waitUntil(c.env.SETTINGS.put(cacheKeyKV, expandedQuery, { expirationTtl: 604800 }));
      }
    }

    // Embedding
    const embeddingResp = (await c.env.AI.run(
      AI_MODELS.EMBED,
      { text: [expandedQuery] },
      AI_GATEWAY,
    )) as AiEmbeddingResponse;
    const vector = embeddingResp.data[0];

    // Vector Search
    const vecResults = await c.env.VECTORIZE.query(vector, { topK: 100 });
    if (vecResults.matches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, took: Date.now() - start });
    }

    // Dynamic cutoff
    const scores = vecResults.matches.map((m) => m.score);
    const minThreshold = 0.5;
    let cutoffIndex = scores.length;
    for (let i = 1; i < scores.length; i++) {
      if (scores[i] < scores[i - 1] * 0.8 || scores[i] < minThreshold) {
        cutoffIndex = i;
        break;
      }
    }
    const filteredMatches = vecResults.matches.slice(0, Math.max(1, cutoffIndex));

    // Fetch Metadata
    const ids = filteredMatches.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await c.env.DB.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<DBImage>();

    const candidates = filteredMatches
      .map((match) => {
        const dbImage = results.find((r) => r.id === match.id);
        if (!dbImage) return null;
        return { dbImage, vecScore: match.score };
      })
      .filter(Boolean) as { dbImage: DBImage; vecScore: number }[];

    // Re-rank
    let reranked = candidates;
    try {
      const topCandidates = candidates.slice(0, 50);
      const contexts = topCandidates.map((c) => ({ text: c.dbImage.ai_caption || '' }));
      const rerankResp = (await c.env.AI.run(
        AI_MODELS.RERANK,
        { query: expandedQuery, contexts, top_k: 50 },
        AI_GATEWAY,
      )) as AiRerankResponse;

      if (rerankResp.response?.length) {
        const sorted = rerankResp.response.sort((a, b) => b.score - a.score);
        const rerankedTop = sorted.map((r) => topCandidates[r.id]).filter(Boolean);
        const rest = candidates.slice(50);
        reranked = [...rerankedTop, ...rest];
      }
    } catch (e) {
      console.error('Re-rank failed:', e);
    }

    const images = reranked.map((c, i) => {
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

export default search;
