import { createVectorId } from '../../kernel/ids';

export interface CandidateProjectionInput {
  assetId: string;
  representationVersion: string;
  embeddingVersion: string;
  indexGeneration: string;
  caption: string;
  tags: string[];
  docMeta: Record<string, unknown>;
}

/**
 * Generates canonical versioned vector ID per ADR-0006 Section 10.
 */
export function buildVersionedVectorId(
  assetId: string,
  representationVersion: string,
  embeddingVersion: string,
  indexGeneration: string,
): string {
  return createVectorId({
    assetId,
    representationVersion,
    embeddingVersion,
    indexGeneration,
  });
}

/**
 * Prepares statement to insert a pending candidate document in D1.
 */
export function prepareCandidateSearchDocument(db: D1Database, input: CandidateProjectionInput): D1PreparedStatement {
  const docId = `doc_${crypto.randomUUID()}`;
  const vectorId = buildVersionedVectorId(
    input.assetId,
    input.representationVersion,
    input.embeddingVersion,
    input.indexGeneration,
  );

  return db
    .prepare(
      `INSERT INTO search_documents (
        id, asset_id, representation_version, embedding_version, index_generation,
        vector_id, status, caption, tags_json, doc_json, created_at, activated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
    )
    .bind(
      docId,
      input.assetId,
      input.representationVersion,
      input.embeddingVersion,
      input.indexGeneration,
      vectorId,
      input.caption,
      JSON.stringify(input.tags),
      JSON.stringify(input.docMeta),
      Date.now(),
    );
}

/**
 * Atomically activates a search projection in D1:
 * 1. Promotes search_documents to 'active'
 * 2. Marks asset as search_ready = 1 with active versions
 */
export function prepareActivateAssetProjection(
  db: D1Database,
  assetId: string,
  indexGeneration: string,
  representationVersion: string,
  embeddingVersion: string,
): D1PreparedStatement[] {
  const now = Date.now();

  const updateDocStmt = db
    .prepare(
      `UPDATE search_documents 
       SET status = 'active', activated_at = ? 
       WHERE asset_id = ? AND index_generation = ?`,
    )
    .bind(now, assetId, indexGeneration);

  const updateAssetStmt = db
    .prepare(
      `UPDATE assets 
       SET search_ready = 1, 
           status = 'ready',
           active_representation_version = ?,
           active_embedding_version = ?,
           active_index_generation = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(representationVersion, embeddingVersion, indexGeneration, now, assetId);

  return [updateDocStmt, updateAssetStmt];
}

/**
 * Queries the active generation for a given projection type.
 */
export async function getActiveIndexGeneration(
  db: D1Database,
  projectionType: 'vectorize' | 'fts',
): Promise<string | null> {
  const row = await db
    .prepare('SELECT index_generation FROM projection_state WHERE projection_type = ? AND status = "active" LIMIT 1')
    .bind(projectionType)
    .first<{ index_generation: string }>();

  return row?.index_generation ?? null;
}
