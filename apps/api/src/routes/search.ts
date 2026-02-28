import { Hono } from 'hono';
import { ApiBindings, DBImage, SearchResponse, AI_MODELS, AI_GATEWAY } from '@lens/shared';
import { toImageResult } from '../utils/transform';
import { rateLimit } from '../middleware/rateLimit';
import { createTrace, Logger } from '@lens/shared';
import { recordSuggestion } from './suggest';

type AiTextResponse = { response?: string };
type AiEmbeddingResponse = { data: number[][] };
type AiRerankResponse = { response: { id: number; score: number }[] };

const search = new Hono<{ Bindings: ApiBindings }>();

search.use('/', rateLimit);

search.get('/', async (c) => {
  const q = c.req.query('q');
  if (!q) return c.json({ error: 'Missing query param "q"' }, 400);

  const trace = createTrace('SEARCH');
  const logger = new Logger(trace, c.env.TELEMETRY);

  logger.info(`Incoming search request: "${q}"`);

  const cacheKey = new Request(`https://lens-cache/search?q=${encodeURIComponent(q.toLowerCase().trim())}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    logger.info('Edge Cache Hit');
    return cached;
  }

  const start = Date.now();

  try {
    const queryKey = q.toLowerCase().trim();
    const cacheKeyKV = `semantic:cache:${queryKey}`;

    // 1. Query Expansion (use fast 3B model)
    let expandedQuery = await c.env.SETTINGS.get(cacheKeyKV);
    if (!expandedQuery) {
      logger.info('Query Expansion Start');
      if (q.split(/\s+/).length <= 4) {
        const expansion = (await c.env.AI.run(
          AI_MODELS.TEXT_FAST,
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

    // 2. Embedding with BGE-M3
    const embeddingResp = (await c.env.AI.run(
      AI_MODELS.EMBED,
      { text: [expandedQuery] },
      AI_GATEWAY,
    )) as AiEmbeddingResponse;
    const vector = embeddingResp.data[0];

    // 3. Vector Search
    const vecResults = await c.env.VECTORIZE.query(vector, { topK: 100 });
    if (vecResults.matches.length === 0) {
      return c.json<SearchResponse>({ results: [], total: 0, took: Date.now() - start });
    }

    // 4. Dynamic Cutoff (Mathematical Cliff Detection)
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
    logger.info(`Vectorized召回: ${vecResults.matches.length} -> 截断后: ${filteredMatches.length}`);

    // 5. Fetch Metadata from D1
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

    // 6. Rerank only top 20 for speed with Defensive Checks
    let reranked = candidates;
    try {
      const topCandidates = candidates.slice(0, 20);
      if (topCandidates.length > 1) {
        const contexts = topCandidates.map((c) => ({ text: c.dbImage.ai_caption || '' }));
        const rerankResp = (await c.env.AI.run(
          AI_MODELS.RERANK,
          { query: expandedQuery, contexts, top_k: 20 },
          AI_GATEWAY,
        )) as AiRerankResponse;

        if (rerankResp.response?.length) {
          const sorted = rerankResp.response.sort((a, b) => b.score - a.score);
          const rerankedTop = sorted
            .map((r: { id: number; score: number }) => {
              const idx = r.id;
              return idx >= 0 && idx < topCandidates.length ? topCandidates[idx] : null;
            })
            .filter(Boolean) as typeof candidates;

          const seenIds = new Set(rerankedTop.map((c) => c.dbImage.id));
          const rest = candidates.filter((c) => !seenIds.has(c.dbImage.id));
          reranked = [...rerankedTop, ...rest];
        }
      }
    } catch (e) {
      logger.error('Rerank logic failure', e);
    }

    const images = reranked.map((c, i) => {
      const score = i < 20 ? 1 - i * 0.01 : c.vecScore;
      return toImageResult(c.dbImage, score);
    });

    const took = Date.now() - start;
    const resp = new Response(JSON.stringify({ results: images, total: images.length, took }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=600' },
    });
    c.executionCtx.waitUntil(cache.put(cacheKey, resp.clone()));
    c.executionCtx.waitUntil(recordSuggestion(c.env.SETTINGS, q));

    logger.info('Search request fulfilled', { took });
    logger.metric('search_complete', [took, images.length]);
    return resp;
  } catch (err) {
    logger.error('Fatal Search Error', err);
    logger.metric('search_error');
    return c.json({ error: 'Internal Server Error' }, 500);
  }
});

export default search;
