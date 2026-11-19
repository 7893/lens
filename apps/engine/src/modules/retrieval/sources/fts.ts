import { CandidateMatch, CandidateSource, NormalizedSearchSpec } from '../contracts';
import { Logger } from '@lens/shared';
import { tracing } from 'cloudflare:workers';
import { isMysqlDatabase } from '../../../platform/cloudflare';

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
        let results: { id: string }[];

        if (isMysqlDatabase(this.db)) {
          const hasCjk = /[\u3400-\u9fff]/.test(query);
          if (hasCjk) {
            const pattern = `%${query.replace(/[%_\\]/g, '\\$&')}%`;
            const res = await this.db
              .prepare(
                `SELECT id FROM images
                 WHERE ai_caption LIKE ? OR ai_tags LIKE ? OR location LIKE ? OR photographer LIKE ? OR alt_description LIKE ?
                 ORDER BY created_at DESC
                 LIMIT 60`,
              )
              .bind(pattern, pattern, pattern, pattern, pattern)
              .all<{ id: string }>();
            results = res.results;
          } else {
            const res = await this.db
              .prepare(
                `SELECT id FROM images
                 WHERE MATCH(ai_caption, ai_tags, photographer, location, alt_description)
                       AGAINST (? IN NATURAL LANGUAGE MODE)
                 LIMIT 60`,
              )
              .bind(query)
              .all<{ id: string }>();
            results = res.results;
          }
        } else {
          // Query SQLite FTS5 index (legacy D1 & unit test mocks)
          const res = await this.db
            .prepare('SELECT id FROM images_fts WHERE images_fts MATCH ? ORDER BY rank LIMIT 60')
            .bind(query)
            .all<{ id: string }>();
          results = res.results;
        }

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
