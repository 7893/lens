import { ApiBindings, DBImage, SearchResponse, AI_MODELS, AI_GATEWAY } from '@lens/shared';
import { toImageResult } from '../utils/transform';
import { Logger } from '@lens/shared';

type AiTextResponse = { response?: string };
type AiEmbeddingResponse = { data: number[][] };
type AiRerankResponse = { response: { id: number; score: number }[] };

/**
 * LENS Core Search Service
 * Orchestrates Query Expansion -> Embedding -> Vector Search -> Reranking
 */
export class SearchService {
  constructor(private env: ApiBindings, private logger: Logger) {}

  /**
   * Executes a hybrid semantic search with reranking.
   */
  async search(query: string): Promise<SearchResponse> {
    const start = Date.now();
    const queryKey = query.toLowerCase().trim();
    const expansionCacheKey = `semantic:cache:${queryKey}`;

    // 1. Query Expansion (AI-native search enhancement)
    let expandedQuery = await this.env.SETTINGS.get(expansionCacheKey);
    if (!expandedQuery) {
      this.logger.info('Query Expansion Start');
      const isShort = query.split(/\s+/).length <= 4;
      const prompt = isShort
        ? `Expand this image search query with related visual terms. Reply with ONLY the expanded English query. Under 30 words.\nQuery: ${query}`
        : `Translate to English if needed. Reply with ONLY the translated text.\nQuery: ${query}`;

      const expansion = (await this.env.AI.run(
        AI_MODELS.TEXT_FAST,
        { prompt, max_tokens: 50 },
        AI_GATEWAY
      )) as AiTextResponse;
      
      expandedQuery = expansion.response?.trim() || query;
      if (expandedQuery && expandedQuery !== query) {
        // Cache expansion for 7 days
        await this.env.SETTINGS.put(expansionCacheKey, expandedQuery, { expirationTtl: 604800 });
      }
    }

    // 2. Dense Vectorization (BGE-M3)
    const embeddingResp = (await this.env.AI.run(
      AI_MODELS.EMBED,
      { text: [expandedQuery!] },
      AI_GATEWAY
    )) as AiEmbeddingResponse;
    const vector = embeddingResp.data[0];

    // 3. Vector Database Retrieval
    const vecResults = await this.env.VECTORIZE.query(vector, { topK: 100 });
    if (vecResults.matches.length === 0) {
      return { results: [], total: 0, took: Date.now() - start };
    }

    // 4. Mathematical Cliff Detection (Dynamic Cutoff)
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
    this.logger.info(`Vector Recall: ${vecResults.matches.length} -> Cutoff: ${filteredMatches.length}`);

    // 5. Metadata Hydration (D1)
    const ids = filteredMatches.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: dbRows } = await this.env.DB.prepare(
      `SELECT * FROM images WHERE id IN (${placeholders})`
    )
      .bind(...ids)
      .all<DBImage>();

    const candidates = filteredMatches
      .map((match) => {
        const dbImage = dbRows.find((r) => r.id === match.id);
        if (!dbImage) return null;
        return { dbImage, vecScore: match.score };
      })
      .filter(Boolean) as { dbImage: DBImage; vecScore: number }[];

    // 6. Cross-Attention Reranking (BGE-Reranker)
    let finalCandidates = candidates;
    try {
      const topCandidates = candidates.slice(0, 20);
      if (topCandidates.length > 1) {
        const contexts = topCandidates.map((c) => ({ text: c.dbImage.ai_caption || '' }));
        const rerankResp = (await this.env.AI.run(
          AI_MODELS.RERANK,
          { query: expandedQuery, contexts, top_k: 20 },
          AI_GATEWAY
        )) as AiRerankResponse;

        if (rerankResp.response?.length) {
          const sorted = rerankResp.response.sort((a, b) => b.score - a.score);
          const rerankedTop = sorted
            .map((r) => {
              const idx = r.id;
              return idx >= 0 && idx < topCandidates.length ? topCandidates[idx] : null;
            })
            .filter(Boolean) as typeof candidates;

          const seenIds = new Set(rerankedTop.map((c) => c.dbImage.id));
          const rest = candidates.filter((c) => !seenIds.has(c.dbImage.id));
          finalCandidates = [...rerankedTop, ...rest];
        }
      }
    } catch (e) {
      this.logger.error('Rerank logic failed', e);
    }

    const images = finalCandidates.map((c, i) => {
      // Approximate search score based on rank for top 20, or raw vector score
      const score = i < 20 ? 1 - i * 0.01 : c.vecScore;
      return toImageResult(c.dbImage, score);
    });

    return {
      results: images,
      total: images.length,
      took: Date.now() - start,
    };
  }
}
