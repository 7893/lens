import { Logger } from '@lens/shared';
import { createVectorId } from '../../kernel/ids';

export interface BackfillStatus {
  legacyTotal: number;
  migratedTotal: number;
  remaining: number;
  percentage: number;
}

export interface BackfillBatchResult {
  processed: number;
  remaining: number;
}

interface LegacyImageRow {
  id: string;
  width: number;
  height: number;
  color: string | null;
  raw_key: string;
  display_key: string;
  meta_json: string;
  ai_tags: string | null;
  ai_caption: string | null;
  ai_embedding: string | null;
  ai_model: string | null;
  ai_quality_score: number | null;
  entities_json: string | null;
  created_at: number;
  vectorize_synced: number;
}

/**
 * ADR-0006 BackfillService (KI-005)
 * Idempotently migrates legacy `images` table rows into canonical
 * `assets`, `asset_sources`, `representations`, and `search_documents`.
 */
export class BackfillService {
  constructor(
    private db: D1Database,
    private logger?: Logger,
  ) {}

  /**
   * Retrieves current backfill progress status.
   */
  async getStatus(): Promise<BackfillStatus> {
    const [legacyRes, migratedRes] = await Promise.all([
      this.db.prepare('SELECT count(*) as count FROM images').first<{ count: number }>(),
      this.db
        .prepare("SELECT count(*) as count FROM assets WHERE source_provider = 'unsplash'")
        .first<{ count: number }>(),
    ]);

    const legacyTotal = legacyRes?.count ?? 0;
    const migratedTotal = migratedRes?.count ?? 0;
    const remaining = Math.max(0, legacyTotal - migratedTotal);
    const percentage = legacyTotal > 0 ? Number(((migratedTotal / legacyTotal) * 100).toFixed(2)) : 100.0;

    return {
      legacyTotal,
      migratedTotal,
      remaining,
      percentage,
    };
  }

  /**
   * Runs an idempotent migration batch of legacy images.
   */
  async runBatch(batchSize = 50): Promise<BackfillBatchResult> {
    const { results: rows } = await this.db
      .prepare(
        `SELECT i.* FROM images i
         LEFT JOIN assets a ON a.source_external_id = i.id AND a.source_provider = 'unsplash'
         WHERE a.id IS NULL
         ORDER BY i.created_at DESC
         LIMIT ?`,
      )
      .bind(batchSize)
      .all<LegacyImageRow>();

    if (!rows || rows.length === 0) {
      const status = await this.getStatus();
      return { processed: 0, remaining: status.remaining };
    }

    const statements: D1PreparedStatement[] = [];
    const now = Date.now();

    for (const row of rows) {
      const assetId = `ast_${row.id}`;
      const reprVersion = 'v1';
      const embedVersion = 'bge-m3-1024d';
      const indexGeneration = 'gen-001';

      let meta: Record<string, unknown>;
      try {
        meta = JSON.parse(row.meta_json || '{}');
      } catch {
        meta = {};
      }

      const user = meta.user as { name?: string; links?: { html?: string } } | undefined;
      const links = meta.links as { html?: string } | undefined;
      const canonicalUrl = links?.html || null;
      const authorName = user?.name || null;
      const authorUrl = user?.links?.html || null;

      // 1. Insert into assets (Aggregate Root)
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO assets (
              id, source_provider, source_external_id, status, search_ready,
              active_representation_version, active_embedding_version,
              active_index_generation, created_at, updated_at
            ) VALUES (?, 'unsplash', ?, 'ready', 1, ?, ?, ?, ?, ?)`,
          )
          .bind(assetId, row.id, reprVersion, embedVersion, indexGeneration, row.created_at, now),
      );

      // 2. Insert into asset_sources (Provenance & License)
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO asset_sources (
              provider, external_id, asset_id, canonical_url, author_name,
              author_url, license, retention_policy, raw_json, observed_at
            ) VALUES ('unsplash', ?, ?, ?, ?, ?, 'Unsplash License', 'standard', ?, ?)`,
          )
          .bind(row.id, assetId, canonicalUrl, authorName, authorUrl, row.meta_json, row.created_at),
      );

      // 3. Insert into representations
      const reprId = `repr_${assetId}_${reprVersion}`;
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO representations (
              id, asset_id, representation_version, model_name, caption,
              tags_json, entities_json, quality_score, embedding_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            reprId,
            assetId,
            reprVersion,
            row.ai_model || '@cf/meta/llama-4-scout-17b-16e-instruct',
            row.ai_caption || '',
            row.ai_tags || '[]',
            row.entities_json || '[]',
            row.ai_quality_score ?? 8.0,
            embedVersion,
            row.created_at,
          ),
      );

      // 4. Insert into search_documents
      const sdocId = `sdoc_${assetId}_${indexGeneration}`;
      const vectorId = createVectorId({
        assetId,
        representationVersion: reprVersion,
        embeddingVersion: embedVersion,
        indexGeneration,
      });

      const docJson = JSON.stringify({
        id: row.id,
        assetId,
        displayKey: row.display_key,
        width: row.width,
        height: row.height,
        color: row.color,
        photographer: authorName,
      });

      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO search_documents (
              id, asset_id, representation_version, embedding_version, index_generation,
              vector_id, status, caption, tags_json, doc_json, created_at, activated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?)`,
          )
          .bind(
            sdocId,
            assetId,
            reprVersion,
            embedVersion,
            indexGeneration,
            vectorId,
            row.ai_caption || '',
            row.ai_tags || '[]',
            docJson,
            row.created_at,
            row.created_at,
          ),
      );
    }

    // Execute atomic batch
    await this.db.batch(statements);

    const status = await this.getStatus();
    this.logger?.info('Backfill batch executed successfully', {
      migratedBatch: rows.length,
      remaining: status.remaining,
    });

    return {
      processed: rows.length,
      remaining: status.remaining,
    };
  }
}
