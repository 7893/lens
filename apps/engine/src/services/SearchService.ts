import { ApiBindings, DBImage, SearchResponse, AI_MODELS, AI_GATEWAY, ImageResult } from '@lens/shared';
import { toImageResult } from '../utils/transform';
import { Logger } from '@lens/shared';

type AiTextResponse = { response?: string };
type AiEmbeddingResponse = { data: number[][] };

/**
 * LENS Advanced Hybrid Search Service
 * Combines SQLite FTS5 (Keyword) + Vectorize (Semantic)
 */
export class SearchService {
  constructor(
    private env: ApiBindings,
    private logger: Logger,
  ) {}

  async search(query: string): Promise<SearchResponse> {
    const start = Date.now();
    const queryKey = query.toLowerCase().trim();

    // 1. Parallel Search Execution (FTS5 + Vector)
    const [ftsResults, vectorResults] = await Promise.all([
      this.executeKeywordSearch(queryKey),
      this.executeSemanticSearch(queryKey),
    ]);

    // 2. Hybrid Ranking & Deduplication
    const seenIds = new Set<string>();
    const hybridIds: { id: string; source: 'fts' | 'vector'; score: number }[] = [];

    // Add FTS hits first (High relevance for exact matches)
    for (const res of ftsResults) {
      if (!seenIds.has(res.id)) {
        seenIds.add(res.id);
        hybridIds.push({ id: res.id, source: 'fts', score: 1.0 });
      }
    }

    // Supplement with Vector hits
    for (const match of vectorResults) {
      if (!seenIds.has(match.id)) {
        seenIds.add(match.id);
        hybridIds.push({ id: match.id, source: 'vector', score: match.score });
      }
    }

    if (hybridIds.length === 0) {
      return { results: [], total: 0, took: Date.now() - start };
    }

    // 3. Dynamic Cutoff (方案 D)
    const cutoffIdx = this.calculateDynamicCutoff(hybridIds);
    const selectedIds = hybridIds.slice(0, cutoffIdx);

    // 4. Hydrate Metadata from D1
    const ids = selectedIds.map((h) => h.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: dbRows } = await this.env.DB.prepare(`SELECT * FROM images WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<DBImage>();

    // 5. Final Result Mapping (preserve order)
    let finalResults = ids
      .map((id) => {
        const row = dbRows.find((r) => r.id === id);
        const hybridInfo = selectedIds.find((h) => h.id === id);
        if (!row || !hybridInfo) return null;
        return toImageResult(row, hybridInfo.score);
      })
      .filter((r): r is ImageResult => r !== null);

    // 6. BGE Reranker Base (精排)
    if (finalResults.length > 1) {
      try {
        const topN = Math.min(finalResults.length, 20);
        const candidates = finalResults.slice(0, topN);
        const contexts = candidates.map((r) => ({ text: r.caption || r.description || 'untitled image' }));

        const rerankResp = (await this.env.AI.run(
          AI_MODELS.RERANK,
          {
            query: queryKey,
            top_k: topN,
            contexts: contexts,
          },
          AI_GATEWAY,
        )) as { response?: { id?: number; score?: number }[] };

        if (rerankResp.response && rerankResp.response.length > 0) {
          // Sort candidates by rerank score
          const rerankedTop = rerankResp.response
            .sort((a, b) => (b.score || 0) - (a.score || 0))
            .map((r) => {
              const item = candidates[r.id ?? -1];
              if (item && r.score !== undefined) {
                item.score = r.score;
              }
              return item;
            })
            .filter((item): item is ImageResult => !!item);

          // Merge back
          // Fallback for missing ids if AI doesn't return all of them
          const rerankedIds = new Set(rerankedTop.map((item) => item.id));
          const missing = candidates.filter((item) => !rerankedIds.has(item.id));

          finalResults = [...rerankedTop, ...missing, ...finalResults.slice(topN)];
          this.logger.info(`Reranker applied to top ${topN} results`);
        }
      } catch (e) {
        this.logger.warn('Reranker failed, falling back to hybrid order', e);
      }
    }

    return {
      results: finalResults,
      total: finalResults.length,
      took: Date.now() - start,
    };
  }

  /**
   * Dynamic cutoff based on score distribution.
   * Uses Ratio = score[i] / score[i-1] for cliff detection.
   */
  private calculateDynamicCutoff(results: { score: number }[]): number {
    const MAX_RESULTS = 100;
    const ABSOLUTE_FLOOR = 0.5;
    const RATIO_CLIFF = 0.8;

    if (results.length === 0) return 0;

    for (let i = 1; i < results.length && i < MAX_RESULTS; i++) {
      const score = results[i].score;
      const prevScore = results[i - 1].score;

      // Keep all FTS results (score = 1.0)
      if (score >= 0.99) continue;

      // Cutoff conditions
      if (score < ABSOLUTE_FLOOR) return i;

      const ratio = score / prevScore;
      if (ratio < RATIO_CLIFF) return i;
    }

    return Math.min(results.length, MAX_RESULTS);
  }

  /**
   * Executes Keyword Search using SQLite FTS5.
   * Best for: Brands, Cities, Specific Objects, Filenames.
   */
  private async executeKeywordSearch(query: string): Promise<{ id: string }[]> {
    try {
      // Use "MATCH" for FTS5 full-text indexing
      const { results } = await this.env.DB.prepare(
        'SELECT id FROM images_fts WHERE images_fts MATCH ? ORDER BY rank LIMIT 60',
      )
        .bind(query)
        .all<{ id: string }>();

      this.logger.info(`FTS5 Keywords Hit: ${results.length}`);
      return results;
    } catch (e) {
      this.logger.warn('FTS5 query failed (possibly too many wildcards)', e);
      return [];
    }
  }

  /**
   * Executes Semantic Search using Vectorize + Translation/Expansion.
   * Best for: Moods, Actions, Narrative, Abstract Concepts.
   */
  private async executeSemanticSearch(query: string): Promise<{ id: string; score: number }[]> {
    const cacheKey = `semantic:cache:${query}`;

    // 1. Translation + Expansion (cached)
    let processedQuery = await this.env.SETTINGS.get(cacheKey);
    if (!processedQuery) {
      const wordCount = query.split(/\s+/).length;
      const prompt =
        wordCount <= 4
          ? `Translate to English if not English, then expand into a descriptive scene (max 30 words): ${query}`
          : `Translate to English if not English: ${query}`;

      const result = (await this.env.AI.run(
        AI_MODELS.TEXT_FAST,
        { prompt, max_tokens: 40 },
        AI_GATEWAY,
      )) as AiTextResponse;
      processedQuery = result.response?.trim() || query;
      await this.env.SETTINGS.put(cacheKey, processedQuery, { expirationTtl: 604800 });
    }

    // 2. Embedding
    const embeddingResp = (await this.env.AI.run(
      AI_MODELS.EMBED,
      { text: [processedQuery] },
      AI_GATEWAY,
    )) as AiEmbeddingResponse;
    const vector = embeddingResp.data[0];

    // 3. Query Vectorize
    const vecResults = await this.env.VECTORIZE.query(vector, { topK: 100 });
    this.logger.info(`Vectorized Recall: ${vecResults.matches.length}`);
    return vecResults.matches;
  }
}
