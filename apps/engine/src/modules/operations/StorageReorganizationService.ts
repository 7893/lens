import { Logger, formatYearMonth } from '@lens/shared';

export interface StorageReorganizationStatus {
  total: number;
  reorganized: number;
  pending: number;
  percentage: number;
}

export interface StorageReorganizationBatchResult {
  processed: number;
  migrated: number;
  skipped: number;
  failed: number;
  remaining: number;
  errors?: string[];
}

export interface StorageReorganizationOptions {
  limit?: number;
  deleteOld?: boolean;
}

interface ImageStorageRow {
  id: string;
  raw_key: string;
  display_key: string;
  meta_json: string;
  created_at: number;
}

/**
 * StorageReorganizationService
 * Organizes historical flat R2 display images and raw keys into monthly directory archives:
 * - Raw: {YYYYMM}/${photoId}.jpg
 * - Display: display/{YYYYMM}/${photoId}.jpg
 * Performs idempotent, zero-downtime batch migrations with dual-path compatibility.
 */
export class StorageReorganizationService {
  constructor(
    private db: D1Database,
    private r2: R2Bucket,
    private logger?: Logger,
  ) {}

  /**
   * Retrieves current storage reorganization progress status.
   * Reorganized records have display_key formatted as 'display/%/%'.
   */
  async getStatus(): Promise<StorageReorganizationStatus> {
    const [totalRes, pendingRes] = await Promise.all([
      this.db.prepare('SELECT count(*) as count FROM images').first<{ count: number }>(),
      this.db
        .prepare("SELECT count(*) as count FROM images WHERE display_key NOT LIKE 'display/%/%'")
        .first<{ count: number }>(),
    ]);

    const total = totalRes?.count ?? 0;
    const pending = pendingRes?.count ?? 0;
    const reorganized = Math.max(0, total - pending);
    const percentage = total > 0 ? Number(((reorganized / total) * 100).toFixed(2)) : 100.0;

    return {
      total,
      reorganized,
      pending,
      percentage,
    };
  }

  /**
   * Runs an idempotent batch reorganization of images.
   */
  async runBatch(options: StorageReorganizationOptions = {}): Promise<StorageReorganizationBatchResult> {
    const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
    const deleteOld = options.deleteOld ?? false;

    const { results: rows } = await this.db
      .prepare(
        `SELECT id, raw_key, display_key, meta_json, created_at
         FROM images
         WHERE display_key NOT LIKE 'display/%/%'
         ORDER BY created_at DESC
         LIMIT ?`,
      )
      .bind(limit)
      .all<ImageStorageRow>();

    if (!rows || rows.length === 0) {
      const status = await this.getStatus();
      return {
        processed: 0,
        migrated: 0,
        skipped: 0,
        failed: 0,
        remaining: status.pending,
      };
    }

    let migrated = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];
    const updateStatements: D1PreparedStatement[] = [];
    const keysToDelete: string[] = [];
    const CHUNK_SIZE = 6;

    for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
      const chunk = rows.slice(i, i + CHUNK_SIZE);
      await Promise.all(
        chunk.map(async (row) => {
          try {
            let photoCreatedAt: string | undefined;
            try {
              const meta = JSON.parse(row.meta_json || '{}');
              photoCreatedAt = meta.created_at;
            } catch {
              // ignore parse error
            }

            const yearMonth = formatYearMonth(photoCreatedAt || row.created_at);
            const targetDisplayKey = `display/${yearMonth}/${row.id}.jpg`;
            const targetRawKey = `${yearMonth}/${row.id}.jpg`;

            // Check if display object already exists in new target
            let displayExists = false;
            try {
              const head = await this.r2.head(targetDisplayKey);
              if (head) displayExists = true;
            } catch {
              // not found
            }

            if (!displayExists) {
              // Read from old display_key
              const oldDisplayObj = await this.r2.get(row.display_key);
              if (oldDisplayObj) {
                await this.r2.put(targetDisplayKey, oldDisplayObj.body, {
                  httpMetadata: oldDisplayObj.httpMetadata,
                  customMetadata: oldDisplayObj.customMetadata,
                });
                if (deleteOld && row.display_key !== targetDisplayKey) {
                  keysToDelete.push(row.display_key);
                }
              }
            } else {
              skipped++;
            }

            // Check if raw object exists at old raw_key
            if (row.raw_key && row.raw_key !== targetRawKey) {
              try {
                const oldRawObj = await this.r2.get(row.raw_key);
                if (oldRawObj) {
                  await this.r2.put(targetRawKey, oldRawObj.body, {
                    httpMetadata: oldRawObj.httpMetadata,
                    customMetadata: oldRawObj.customMetadata,
                  });
                  if (deleteOld) {
                    keysToDelete.push(row.raw_key);
                  }
                }
              } catch {
                // raw object might not exist
              }
            }

            // Prepare D1 update statement
            updateStatements.push(
              this.db
                .prepare('UPDATE images SET display_key = ?, raw_key = ? WHERE id = ?')
                .bind(targetDisplayKey, targetRawKey, row.id),
            );

            migrated++;
          } catch (err) {
            failed++;
            const msg = `Failed reorganizing image ${row.id}: ${err instanceof Error ? err.message : String(err)}`;
            errors.push(msg);
            this.logger?.error('Storage reorganization image failed', { photoId: row.id, error: String(err) });
          }
        }),
      );
    }

    // Execute batch update in D1
    if (updateStatements.length > 0) {
      await this.db.batch(updateStatements);
    }

    // Delete old keys in R2 if deleteOld requested
    if (deleteOld && keysToDelete.length > 0) {
      try {
        await this.r2.delete(keysToDelete);
      } catch (delErr) {
        this.logger?.warn('Failed deleting old R2 keys', { count: keysToDelete.length, error: String(delErr) });
      }
    }

    const currentStatus = await this.getStatus();

    return {
      processed: rows.length,
      migrated,
      skipped,
      failed,
      remaining: currentStatus.pending,
      ...(errors.length > 0 ? { errors } : {}),
    };
  }
}
