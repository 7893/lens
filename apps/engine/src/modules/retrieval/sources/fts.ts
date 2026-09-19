import { CandidateMatch, CandidateSource, NormalizedSearchSpec } from '../contracts';
import { Logger } from '@lens/shared';
import { tracing } from 'cloudflare:workers';

export class FtsCandidateSource implements CandidateSource {
  public readonly name = 'fts5' as const;

  constructor(
    private db: D1Database,
    private logger: Logger,
  ) {}

  async recall(spec: NormalizedSearchSpec, convId?: string): Promise<CandidateMatch[]> {
    return tracing.enterSpan('execute_tool', async (toolSpan) => {
      toolSpan.setAttribute('gen_ai.operation.name', 'execute_tool');
      toolSpan.setAttribute('gen_ai.tool.name', 'fts5_keyword_search');
      toolSpan.setAttribute('gen_ai.tool.call.arguments', JSON.stringify({ query: spec.normalizedQuery }));
      if (convId) toolSpan.setAttribute('gen_ai.conversation.id', convId);

      const query = spec.normalizedQuery;
      if (!query) {
        return [];
      }

      try {
        // Query FTS5 index (images_fts for current active index)
        const { results } = await this.db
          .prepare('SELECT id FROM images_fts WHERE images_fts MATCH ? ORDER BY rank LIMIT 60')
          .bind(query)
          .all<{ id: string }>();

        const matches: CandidateMatch[] = results.map((row, idx) => ({
          id: row.id,
          source: 'fts5',
          rank: idx + 1,
        }));

        this.logger.info(`FTS5 Keywords Hit: ${matches.length}`);
        toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ hits: matches.length }));
        return matches;
      } catch (e) {
        this.logger.warn('FTS5 query failed (possibly too many wildcards or table missing)', e);
        toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ error: String(e), hits: 0 }));
        return [];
      }
    });
  }
}
