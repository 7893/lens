import {
  ApiBindings,
  DBImage,
  SearchResponse,
  AI_MODELS,
  AI_GATEWAY,
  ImageResult,
  SearchRankingPolicy,
} from '@lens/shared';
import { toImageResult } from '../../utils/transform';
import { Logger } from '@lens/shared';
import { tracing } from 'cloudflare:workers';

type AiTextResponse = { response?: string };
type AiEmbeddingResponse = { data: number[][] };

const AGENT_NAME = 'lens-search-agent';
const AGENT_ID = 'lens-search-agent-prod';

/**
 * LENS Advanced Hybrid Search Service
 * Combines SQLite FTS5 (Keyword) + Vectorize (Semantic)
 * Instrumented with Cloudflare Agent Tracing (Custom Harness)
 */
export class SearchService {
  constructor(
    private env: ApiBindings,
    private logger: Logger,
  ) {}

  async search(query: string, conversationId?: string): Promise<SearchResponse> {
    const convId = conversationId || crypto.randomUUID();
    return tracing.enterSpan('invoke_agent', async (agentSpan) => {
      agentSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
      agentSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
      agentSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
      agentSpan.setAttribute('gen_ai.conversation.id', convId);
      agentSpan.setAttribute('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: query }]));

      const start = Date.now();
      const queryKey = query.toLowerCase().trim();

      // 1. Parallel Search Execution (FTS5 + Vector)
      const [ftsResults, vectorResults] = await Promise.all([
        this.executeKeywordSearch(queryKey, convId),
        this.executeSemanticSearch(queryKey, convId),
      ]);

      const response = await this.fuseAndHydrate(ftsResults, vectorResults, start, convId);

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
    query: string,
    onStage: (event: string, data: Record<string, unknown>) => Promise<void>,
    conversationId?: string,
  ): Promise<SearchResponse> {
    const convId = conversationId || crypto.randomUUID();
    return tracing.enterSpan('invoke_agent', async (agentSpan) => {
      agentSpan.setAttribute('gen_ai.operation.name', 'invoke_agent');
      agentSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
      agentSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
      agentSpan.setAttribute('gen_ai.conversation.id', convId);
      agentSpan.setAttribute('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: query }]));

      const start = Date.now();
      const queryKey = query.toLowerCase().trim();

      const ftsPromise = this.executeKeywordSearch(queryKey, convId);
      const vectorPromise = this.executeSemanticSearch(queryKey, convId);

      // Fast-path: as soon as FTS completes, stream initial results if hits exist
      let ftsResults: { id: string }[] = [];
      try {
        ftsResults = await ftsPromise;
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
      const finalResponse = await this.fuseAndHydrate(ftsResults, vectorResults, start, convId);

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

  /**
   * Reciprocal Rank Fusion (RRF) & D1 Hydration without BGE Reranker overhead.
   */
  private async fuseAndHydrate(
    ftsResults: { id: string }[],
    vectorResults: { id: string; score: number }[],
    start: number,
    convId?: string,
  ): Promise<SearchResponse> {
    // 2. Hybrid Ranking & Deduplication using Reciprocal Rank Fusion (RRF)
    const hybridIds = SearchRankingPolicy.calculateRRF(ftsResults, vectorResults);

    if (hybridIds.length === 0) {
      return { results: [], total: 0, took: Date.now() - start };
    }

    // 3. Dynamic Cutoff
    const cutoffIdx = SearchRankingPolicy.calculateDynamicCutoff(hybridIds);
    const selectedIds = hybridIds.slice(0, cutoffIdx);

    // 4. Hydrate Metadata from D1 (excluding unused ai_embedding column)
    const ids = selectedIds.map((h) => h.id);
    const placeholders = ids.map(() => '?').join(',');

    const dbRows = await tracing.enterSpan('execute_tool', async (toolSpan) => {
      toolSpan.setAttribute('gen_ai.operation.name', 'execute_tool');
      toolSpan.setAttribute('gen_ai.tool.name', 'd1_hydrate_metadata');
      toolSpan.setAttribute('gen_ai.tool.call.arguments', JSON.stringify({ idsCount: ids.length }));
      if (convId) toolSpan.setAttribute('gen_ai.conversation.id', convId);

      const { results } = await this.env.DB.prepare(
        `SELECT id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_model, ai_quality_score, entities_json FROM images WHERE id IN (${placeholders})`,
      )
        .bind(...ids)
        .all<DBImage>();

      toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ returnedCount: results.length }));
      return results;
    });

    // 5. Final Result Mapping (preserve order)
    const finalResults = ids
      .map((id) => {
        const row = dbRows.find((r) => r.id === id);
        const hybridInfo = selectedIds.find((h) => h.id === id);
        if (!row || !hybridInfo) return null;
        return toImageResult(row, hybridInfo.score);
      })
      .filter((r): r is ImageResult => r !== null);

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
   * Delegates to SearchRankingPolicy domain model.
   */
  private calculateDynamicCutoff(results: { score: number }[]): number {
    return SearchRankingPolicy.calculateDynamicCutoff(results.map((r, i) => ({ id: String(i), score: r.score })));
  }

  /**
   * Executes Keyword Search using SQLite FTS5.
   * Best for: Brands, Cities, Specific Objects, Filenames.
   */
  private async executeKeywordSearch(query: string, convId?: string): Promise<{ id: string }[]> {
    return tracing.enterSpan('execute_tool', async (toolSpan) => {
      toolSpan.setAttribute('gen_ai.operation.name', 'execute_tool');
      toolSpan.setAttribute('gen_ai.tool.name', 'fts5_keyword_search');
      toolSpan.setAttribute('gen_ai.tool.call.arguments', JSON.stringify({ query }));
      if (convId) toolSpan.setAttribute('gen_ai.conversation.id', convId);

      try {
        // Use "MATCH" for FTS5 full-text indexing
        const { results } = await this.env.DB.prepare(
          'SELECT id FROM images_fts WHERE images_fts MATCH ? ORDER BY rank LIMIT 60',
        )
          .bind(query)
          .all<{ id: string }>();

        this.logger.info(`FTS5 Keywords Hit: ${results.length}`);
        toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ hits: results.length }));
        return results;
      } catch (e) {
        this.logger.warn('FTS5 query failed (possibly too many wildcards)', e);
        toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ error: String(e), hits: 0 }));
        return [];
      }
    });
  }

  /**
   * Executes Semantic Search using Vectorize + Translation/Expansion.
   * Best for: Moods, Actions, Narrative, Abstract Concepts.
   */
  private async executeSemanticSearch(query: string, convId?: string): Promise<{ id: string; score: number }[]> {
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

        const result = await tracing.enterSpan('chat', async (chatSpan) => {
          chatSpan.setAttribute('gen_ai.operation.name', 'chat');
          chatSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
          chatSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
          if (convId) chatSpan.setAttribute('gen_ai.conversation.id', convId);
          chatSpan.setAttribute('gen_ai.request.model', AI_MODELS.TEXT_FAST);
          chatSpan.setAttribute('gen_ai.system', 'cloudflare-workers-ai');
          chatSpan.setAttribute('gen_ai.input.messages', JSON.stringify([{ role: 'user', content: prompt }]));

          const res = (await this.env.AI.run(
            AI_MODELS.TEXT_FAST,
            { prompt, max_tokens: 40 },
            AI_GATEWAY,
          )) as AiTextResponse;

          chatSpan.setAttribute(
            'gen_ai.output.messages',
            JSON.stringify([{ role: 'assistant', content: res.response || '' }]),
          );
          return res;
        });

        processedQuery = result.response?.trim() || query;
      } else {
        processedQuery = query;
      }
      await this.env.SETTINGS.put(cacheKey, processedQuery, { expirationTtl: 604800 });
    }

    // 2. Embedding
    const embeddingResp = await tracing.enterSpan('chat', async (chatSpan) => {
      chatSpan.setAttribute('gen_ai.operation.name', 'chat');
      chatSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
      chatSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
      if (convId) chatSpan.setAttribute('gen_ai.conversation.id', convId);
      chatSpan.setAttribute('gen_ai.request.model', AI_MODELS.EMBED);
      chatSpan.setAttribute('gen_ai.system', 'cloudflare-workers-ai');
      chatSpan.setAttribute('gen_ai.input.messages', JSON.stringify({ text: [processedQuery] }));

      const res = (await this.env.AI.run(
        AI_MODELS.EMBED,
        { text: [processedQuery] },
        AI_GATEWAY,
      )) as AiEmbeddingResponse;

      chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify({ dimensions: res.data?.[0]?.length || 0 }));
      return res;
    });
    const vector = embeddingResp.data[0];

    // 3. Query Vectorize
    const vecResults = await tracing.enterSpan('execute_tool', async (toolSpan) => {
      toolSpan.setAttribute('gen_ai.operation.name', 'execute_tool');
      toolSpan.setAttribute('gen_ai.tool.name', 'vectorize_query');
      toolSpan.setAttribute('gen_ai.tool.call.arguments', JSON.stringify({ topK: 100 }));

      const res = await this.env.VECTORIZE.query(vector, { topK: 100 });
      this.logger.info(`Vectorized Recall: ${res.matches.length}`);

      toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ matchesCount: res.matches.length }));
      return res.matches;
    });

    return vecResults;
  }
}
