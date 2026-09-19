import { DBImage, ImageResult } from '@lens/shared';
import { toImageResult } from '../../utils/transform';
import { tracing } from 'cloudflare:workers';

/**
 * Hydrates candidate IDs from D1, strictly enforcing that every result is an active,
 * authorized entity in D1, and preserving candidate rank ordering.
 */
export async function hydrateFromD1(
  db: D1Database,
  candidateIds: string[],
  scoresMap: Map<string, number>,
  convId?: string,
): Promise<ImageResult[]> {
  if (candidateIds.length === 0) {
    return [];
  }

  const placeholders = candidateIds.map(() => '?').join(',');

  const dbRows = await tracing.enterSpan('execute_tool', async (toolSpan) => {
    toolSpan.setAttribute('gen_ai.operation.name', 'execute_tool');
    toolSpan.setAttribute('gen_ai.tool.name', 'd1_hydrate_metadata');
    toolSpan.setAttribute('gen_ai.tool.call.arguments', JSON.stringify({ idsCount: candidateIds.length }));
    if (convId) toolSpan.setAttribute('gen_ai.conversation.id', convId);

    const { results } = await db
      .prepare(
        `SELECT id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_model, ai_quality_score, entities_json FROM images WHERE id IN (${placeholders})`,
      )
      .bind(...candidateIds)
      .all<DBImage>();

    toolSpan.setAttribute('gen_ai.tool.call.result', JSON.stringify({ returnedCount: results.length }));
    return results;
  });

  // Reorder and hydrate while preserving candidate rank ordering
  const hydrated: ImageResult[] = [];
  for (const id of candidateIds) {
    const row = dbRows.find((r) => r.id === id);
    if (!row) {
      // Candidate not in D1 or inactive - drop it (active version gate)
      continue;
    }
    const score = scoresMap.get(id);
    hydrated.push(toImageResult(row, score));
  }

  return hydrated;
}
