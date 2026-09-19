import { CandidateMatch, CandidateSource, NormalizedSearchSpec } from '../contracts';
import { AI_MODELS, AI_GATEWAY, Logger } from '@lens/shared';
import { tracing } from 'cloudflare:workers';

type AiTextResponse = { response?: string };
type AiEmbeddingResponse = { data: number[][] };

const AGENT_NAME = 'lens-search-agent';
const AGENT_ID = 'lens-search-agent-prod';

/**
 * Parses a potentially versioned vector ID into its constituent components.
 * Format: asset:{assetId}:repr:{reprVersion}:embed:{embedVersion}:gen:{indexGeneration}
 * or legacy: {assetId}
 */
export function parseVectorId(rawId: string): { assetId: string; indexGeneration?: string } {
  if (rawId.startsWith('asset:')) {
    const parts = rawId.split(':');
    const assetId = parts[1] || rawId;
    const genIdx = parts.indexOf('gen');
    const indexGeneration = genIdx !== -1 && parts[genIdx + 1] ? parts[genIdx + 1] : undefined;
    return { assetId, indexGeneration };
  }
  return { assetId: rawId };
}

export class VectorCandidateSource implements CandidateSource {
  public readonly name = 'vectorize' as const;

  constructor(
    private ai: Ai,
    private vectorize: VectorizeIndex,
    private settingsKv: KVNamespace,
    private logger: Logger,
  ) {}

  async recall(spec: NormalizedSearchSpec, convId?: string): Promise<CandidateMatch[]> {
    if (!spec.options.enableSemantic) {
      return [];
    }

    try {
      const query = spec.normalizedQuery;
      if (!query) {
        return [];
      }

      // 1. Translation / Expansion with KV Cache
      const processedQuery = await this.expandQueryWithCache(query, convId);

      // 2. Worker AI Embedding Generation
      const vector = await this.generateEmbedding(processedQuery, convId);
      if (!vector || vector.length === 0) {
        return [];
      }

      // 3. Query Vectorize
      const matches = await this.queryVectorize(vector, spec, convId);
      return matches;
    } catch (err) {
      this.logger.warn('VectorCandidateSource recall failed or timed out, degrading gracefully', err);
      return [];
    }
  }

  private async expandQueryWithCache(query: string, convId?: string): Promise<string> {
    const cacheKey = `semantic:cache:${query}`;

    try {
      const cached = await this.settingsKv.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (e) {
      this.logger.warn('KV read failed for query cache', e);
    }

    // Fast-path: skip LLM expansion for clean English queries
    const isCleanEnglish = /^[a-zA-Z0-9\s.,'?!-_]+$/.test(query);
    if (isCleanEnglish) {
      try {
        await this.settingsKv.put(cacheKey, query, { expirationTtl: 604800 });
      } catch {
        // non-blocking
      }
      return query;
    }

    try {
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

        const res = (await this.ai.run(AI_MODELS.TEXT_FAST, { prompt, max_tokens: 40 }, AI_GATEWAY)) as AiTextResponse;

        chatSpan.setAttribute(
          'gen_ai.output.messages',
          JSON.stringify([{ role: 'assistant', content: res.response || '' }]),
        );
        return res;
      });

      const processed = result.response?.trim() || query;
      try {
        await this.settingsKv.put(cacheKey, processed, { expirationTtl: 604800 });
      } catch {
        // non-blocking
      }
      return processed;
    } catch (e) {
      this.logger.warn('Query expansion failed, falling back to raw query', e);
      return query;
    }
  }

  private async generateEmbedding(text: string, convId?: string): Promise<number[]> {
    const embeddingResp = await tracing.enterSpan('chat', async (chatSpan) => {
      chatSpan.setAttribute('gen_ai.operation.name', 'chat');
      chatSpan.setAttribute('gen_ai.agent.name', AGENT_NAME);
      chatSpan.setAttribute('gen_ai.agent.id', AGENT_ID);
      if (convId) chatSpan.setAttribute('gen_ai.conversation.id', convId);
      chatSpan.setAttribute('gen_ai.request.model', AI_MODELS.EMBED);
      chatSpan.setAttribute('gen_ai.system', 'cloudflare-workers-ai');
      chatSpan.setAttribute('gen_ai.input.messages', JSON.stringify({ text: [text] }));

      const res = (await this.ai.run(AI_MODELS.EMBED, { text: [text] }, AI_GATEWAY)) as AiEmbeddingResponse;

      chatSpan.setAttribute('gen_ai.output.messages', JSON.stringify({ dimensions: res.data?.[0]?.length || 0 }));
      return res;
    });

    return embeddingResp.data[0];
  }

  private async queryVectorize(
    vector: number[],
    spec: NormalizedSearchSpec,
    convId?: string,
  ): Promise<CandidateMatch[]> {
    return tracing.enterSpan('execute_tool', async (toolSpan) => {
      toolSpan.setAttribute('gen_ai.operation.name', 'execute_tool');
      toolSpan.setAttribute('gen_ai.tool.name', 'vectorize_query');
      toolSpan.setAttribute('gen_ai.tool.call.arguments', JSON.stringify({ topK: 100 }));
      if (convId) toolSpan.setAttribute('gen_ai.conversation.id', convId);

      const res = await this.vectorize.query(vector, { topK: 100 });
      this.logger.info(`Vectorized Recall: ${res.matches.length}`);

      toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ matchesCount: res.matches.length }));

      const candidates: CandidateMatch[] = [];
      for (let i = 0; i < res.matches.length; i++) {
        const match = res.matches[i];
        const parsed = parseVectorId(match.id);

        // If indexGeneration is specified, ensure candidate matches if versioned
        if (
          spec.options.indexGeneration &&
          parsed.indexGeneration &&
          parsed.indexGeneration !== spec.options.indexGeneration
        ) {
          continue;
        }

        candidates.push({
          id: parsed.assetId,
          rawId: match.id,
          source: 'vectorize',
          score: match.score,
          rank: i + 1,
        });
      }

      return candidates;
    });
  }
}
