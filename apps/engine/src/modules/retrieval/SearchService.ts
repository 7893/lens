import { ApiBindings, DBImage, SearchResponse, ImageResult, Logger } from '@lens/shared';
import { toImageResult } from '../../utils/transform';
import { tracing } from 'cloudflare:workers';
import { SearchSpec, NormalizedSearchSpec, RETRIEVAL_DEFAULTS } from './contracts';
import { FtsCandidateSource } from './sources/fts';
import { VectorCandidateSource } from './sources/vector';
import { fuseCandidatesWithRRF } from './policies/fusion';
import { calculateDynamicCutoff } from './policies/cutoff';
import { filterResults, applyDiversityPolicy } from './policies/diversity';
import { hydrateFromD1 } from './hydration';
import { decodeCursor, encodeCursor, hashQuery } from './cursor';

const AGENT_NAME = 'lens-search-agent';
const AGENT_ID = 'lens-search-agent-prod';

/**
 * Normalizes input SearchSpec or string into a standardized, validated retrieval spec.
 */
export function normalizeSearchSpec(queryOrSpec: string | SearchSpec): NormalizedSearchSpec {
  const spec: SearchSpec = typeof queryOrSpec === 'string' ? { query: queryOrSpec } : queryOrSpec;
  const rawQuery = (spec.query || '').trim();
  const normalizedQuery = rawQuery.toLowerCase().replace(/\s+/g, ' ');

  return {
    query: rawQuery,
    normalizedQuery,
    cursor: spec.cursor,
    filters: spec.filters || {},
    options: {
      enableSemantic: spec.options?.enableSemantic ?? true,
      retrievalVersion: spec.options?.retrievalVersion ?? RETRIEVAL_DEFAULTS.VERSION,
      indexGeneration: spec.options?.indexGeneration ?? RETRIEVAL_DEFAULTS.INDEX_GENERATION,
      limit: Math.min(spec.options?.limit ?? RETRIEVAL_DEFAULTS.DEFAULT_LIMIT, RETRIEVAL_DEFAULTS.MAX_LIMIT),
      k: spec.options?.k ?? RETRIEVAL_DEFAULTS.DEFAULT_RRF_K,
      diversityFactor: spec.options?.diversityFactor ?? RETRIEVAL_DEFAULTS.DEFAULT_DIVERSITY_FACTOR,
      timeoutMs: spec.options?.timeoutMs ?? RETRIEVAL_DEFAULTS.DEFAULT_TIMEOUT_MS,
    },
  };
}

/**
 * LENS Advanced Hybrid Search Service (Phase 5: Retrieval Kernel)
 * Combines SQLite FTS5 (Keyword) + Vectorize (Semantic) via CandidateSources,
 * pure RRF fusion, dynamic cliff cutoff, D1 active version hydration, and stable cursor pagination.
 */
export class SearchService {
  private ftsSource: FtsCandidateSource;
  private vectorSource: VectorCandidateSource;

  constructor(
    private env: ApiBindings,
    private logger: Logger,
  ) {
    this.ftsSource = new FtsCandidateSource(env.DB, logger);
    this.vectorSource = new VectorCandidateSource(env.AI, env.VECTORIZE, env.SETTINGS, logger);
  }

  async search(queryOrSpec: string | SearchSpec, conversationId?: string): Promise<SearchResponse> {
    const convId = conversationId || crypto.randomUUID();
    const spec = normalizeSearchSpec(queryOrSpec);

    return tracing.enterSpan('invoke_agent', async (agentSpan) => {
      agentSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
      agentSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
      agentSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
      agentSpan.setAttribute('gen_ai.conversation.id', convId);
      agentSpan.setAttribute('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: spec.query }]));

      const start = Date.now();

      // 1. Parallel Candidate Recall (FTS5 + Vectorize)
      const [ftsResults, vectorResults] = await Promise.all([
        this.ftsSource.recall(spec, convId),
        this.vectorSource.recall(spec, convId),
      ]);

      const response = await this.fuseCutoffAndHydrate(spec, ftsResults, vectorResults, start, convId);

      agentSpan.setAttribute(
        'gen_ai.output.messages',
        JSON.stringify([{ role: 'assistant', content: `Found ${response.total} images in ${response.took}ms` }]),
      );

      return response;
    });
  }

  /**
   * Streaming search execution using Server-Sent Events (SSE).
   * Emits fast keyword results first (Phase 1), then fused semantic results (Phase 2).
   */
  async searchStream(
    queryOrSpec: string | SearchSpec,
    onStage: (event: string, data: Record<string, unknown>) => Promise<void>,
    conversationId?: string,
  ): Promise<SearchResponse> {
    const convId = conversationId || crypto.randomUUID();
    const spec = normalizeSearchSpec(queryOrSpec);

    return tracing.enterSpan('invoke_agent', async (agentSpan) => {
      agentSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
      agentSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
      agentSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
      agentSpan.setAttribute('gen_ai.conversation.id', convId);
      agentSpan.setAttribute('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: spec.query }]));

      const start = Date.now();

      const ftsPromise = this.ftsSource.recall(spec, convId);
      const vectorPromise = this.vectorSource.recall(spec, convId);

      // Fast-path: as soon as FTS completes, stream initial results if hits exist
      let ftsResults: { id: string }[] = [];
      try {
        const rawFtsMatches = await ftsPromise;
        ftsResults = rawFtsMatches;
        if (ftsResults.length > 0) {
          const topFtsIds = ftsResults.slice(0, 30).map((r) => r.id);
          const placeholders = topFtsIds.map(() => '?').join(',');
          const { results: dbRows } = await this.env.DB.prepare(
            `SELECT id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_model, ai_quality_score, entities_json FROM images WHERE id IN (${placeholders})`,
          )
            .bind(...topFtsIds)
            .all<DBImage>();

          const ftsMapped = topFtsIds
            .map((id) => {
              const row = dbRows.find((r) => r.id === id);
              return row ? toImageResult(row, 1.0) : null;
            })
            .filter((r): r is ImageResult => r !== null);

          await onStage('stage', {
            stage: 'keyword',
            results: ftsMapped,
            took: Date.now() - start,
          });
        }
      } catch (e) {
        this.logger.warn('FTS stream stage failed', e);
      }

      // Wait for vector search to complete, then fuse
      const vectorResults = await vectorPromise;
      const finalResponse = await this.fuseCutoffAndHydrate(spec, ftsResults, vectorResults, start, convId);

      await onStage('stage', {
        stage: 'complete',
        ...finalResponse,
      });
      await onStage('done', {});

      agentSpan.setAttribute(
        'gen_ai.output.messages',
        JSON.stringify([
          { role: 'assistant', content: `Streamed ${finalResponse.total} images in ${finalResponse.took}ms` },
        ]),
      );

      return finalResponse;
    });
  }

  private async fuseCutoffAndHydrate(
    spec: NormalizedSearchSpec,
    ftsMatches: { id: string; rank?: number }[],
    vectorMatches: { id: string; rank?: number; score?: number }[],
    start: number,
    convId?: string,
  ): Promise<SearchResponse> {
    // 2. Hybrid Ranking & Deduplication using pure Reciprocal Rank Fusion (RRF)
    const hybridCandidates = fuseCandidatesWithRRF(
      ftsMatches.map((m, idx) => ({ id: m.id, rank: m.rank ?? idx + 1, source: 'fts5' as const })),
      vectorMatches.map((m, idx) => ({
        id: m.id,
        rank: m.rank ?? idx + 1,
        source: 'vectorize' as const,
        score: m.score,
      })),
      spec.options.k,
    );

    if (hybridCandidates.length === 0) {
      return { results: [], total: 0, took: Date.now() - start };
    }

    // 3. Dynamic Cutoff on candidate pool
    const cutoffCount = calculateDynamicCutoff(hybridCandidates, {
      maxResults: Math.max(spec.options.limit, RETRIEVAL_DEFAULTS.DEFAULT_LIMIT),
    });
    const selectedCandidates = hybridCandidates.slice(0, cutoffCount);

    // 4. Stable Cursor Pagination
    let offset = 0;
    if (spec.cursor) {
      const decoded = decodeCursor(spec.cursor);
      if (decoded && decoded.queryHash === hashQuery(spec.normalizedQuery)) {
        offset = decoded.offset;
      }
    }

    const pagedCandidates = selectedCandidates.slice(offset, offset + spec.options.limit);
    const hasMore = offset + spec.options.limit < selectedCandidates.length;
    const nextCursor = hasMore
      ? encodeCursor({
          offset: offset + spec.options.limit,
          queryHash: hashQuery(spec.normalizedQuery),
          version: spec.options.retrievalVersion,
        })
      : undefined;

    // 5. Hydrate from D1 (active version gate)
    const scoresMap = new Map(pagedCandidates.map((h) => [h.id, h.score]));
    const candidateIds = pagedCandidates.map((h) => h.id);
    const hydratedRows = await hydrateFromD1(this.env.DB, candidateIds, scoresMap, convId);

    // 6. Filter & Diversity Policy
    let finalResults = filterResults(hydratedRows, spec.filters);
    if (spec.options.diversityFactor > 0) {
      finalResults = applyDiversityPolicy(finalResults);
    }

    return {
      results: finalResults,
      total: finalResults.length,
      nextCursor,
      took: Date.now() - start,
      telemetry: {
        resultsBeforeCliff: hybridCandidates.length,
        resultsAfterCliff: selectedCandidates.length,
        highestScore: hybridCandidates[0]?.score || 0,
        lowestScore: selectedCandidates[selectedCandidates.length - 1]?.score || 0,
        fts5Hits: ftsMatches.length,
        vectorHits: vectorMatches.length,
      },
    };
  }
}
