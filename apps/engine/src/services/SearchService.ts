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

    // 2. Hybrid Ranking & Deduplication using Reciprocal Rank Fusion (RRF)
    const k = 60;
    const rrfMap = new Map<string, { ftsRank?: number; vecRank?: number }>();

    ftsResults.forEach((res, idx) => {
      rrfMap.set(res.id, { ftsRank: idx + 1 });
    });

    vectorResults.forEach((match, idx) => {
      const existing = rrfMap.get(match.id) || {};
      existing.vecRank = idx + 1;
      rrfMap.set(match.id, existing);
    });

    const hybridIds = Array.from(rrfMap.entries())
      .map(([id, info]) => {
        const ftsScore = info.ftsRank !== undefined ? 1 / (k + info.ftsRank) : 0;
        const vecScore = info.vecRank !== undefined ? 1 / (k + info.vecRank) : 0;
        return { id, score: ftsScore + vecScore };
      })
      .sort((a, b) => b.score - a.score);

    if (hybridIds.length === 0) {
      return { results: [], total: 0, took: Date.now() - start };
    }

    // 3. Dynamic Cutoff
    const cutoffIdx = this.calculateDynamicCutoff(hybridIds);
    const selectedIds = hybridIds.slice(0, cutoffIdx);

    // 4. Hydrate Metadata from D1 (excluding unused ai_embedding column)
    const ids = selectedIds.map((h) => h.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results: dbRows } = await this.env.DB.prepare(
      `SELECT id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_model, ai_quality_score, entities_json FROM images WHERE id IN (${placeholders})`,
    )
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
        const topN = Math.min(finalResults.length, 8);
        const candidates = finalResults.slice(0, topN);
        const contexts = candidates.map((r) => ({ text: r.caption || r.description || 'untitled image' }));

        const rerankResp = (await (this.env.AI as any).run(
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
              const idx = r.id ?? (r as any).index ?? -1;
              const item = candidates[idx];
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
      telemetry: {
        resultsBeforeCliff: hybridIds.length,
        resultsAfterCliff: selectedIds.length,
        highestScore: hybridIds[0]?.score || 0,
        lowestScore: selectedIds[selectedIds.length - 1]?.score || 0,
        fts5Hits: ftsResults.length,
        vectorHits: vectorResults.length,
      },
    };
  }

  /**
   * Dynamic cutoff based on RRF score distribution.
   * Filters out low-confidence trailing results while preserving top hits.
   */
  private calculateDynamicCutoff(results: { score: number }[]): number {
    const MAX_RESULTS = 60;
    const ABSOLUTE_FLOOR = 0.005;
    const RATIO_CLIFF = 0.65;

    if (results.length === 0) return 0;
    const maxScore = results[0].score;

    for (let i = 1; i < results.length && i < MAX_RESULTS; i++) {
      const score = results[i].score;
      const prevScore = results[i - 1].score;

      // Absolute floor check: discard items scoring less than 15% of top result
      if (score < maxScore * 0.15 || score < ABSOLUTE_FLOOR) return i;

      // Relative cliff check (only apply after preserving at least top 5 results)
      if (i >= 5 && prevScore > 0 && score / prevScore < RATIO_CLIFF) {
        return i;
      }
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
      // Fast-path: skip LLM expansion for clean ASCII/English queries
      const isCleanEnglish = /^[a-zA-Z0-9\s.,'?!-_]+$/.test(query);
      if (!isCleanEnglish) {
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
      } else {
        processedQuery = query;
      }
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
