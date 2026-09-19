import { RuntimeConfigRecord, OperationAuditRecord, ReconciliationReport } from './models';
import { safeJsonParse } from '@lens/shared';

/**
 * Records an immutable audit log entry for high-risk operations.
 */
export async function recordOperationAudit(
  db: D1Database,
  entry: Omit<OperationAuditRecord, 'id' | 'created_at'>,
): Promise<OperationAuditRecord> {
  const id = `audit_${crypto.randomUUID()}`;
  const now = Date.now();

  const record: OperationAuditRecord = {
    ...entry,
    id,
    created_at: now,
  };

  await db
    .prepare(
      `INSERT INTO operation_audit (id, operator, action, target_type, target_id, reason, correlation_id, status, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      record.id,
      record.operator,
      record.action,
      record.target_type,
      record.target_id,
      record.reason,
      record.correlation_id,
      record.status,
      record.details_json,
      record.created_at,
    )
    .run();

  return record;
}

/**
 * Fetches runtime configuration from authoritative D1 storage.
 */
export async function getRuntimeConfig<T>(
  db: D1Database,
  key: string,
  fallback: T,
): Promise<{ version: string; value: T }> {
  try {
    const row = await db
      .prepare('SELECT key, version, value_json, description, updated_by, updated_at FROM runtime_config WHERE key = ?')
      .bind(key)
      .first<RuntimeConfigRecord>();

    if (!row) {
      return { version: 'default', value: fallback };
    }

    const value = safeJsonParse<T>(row.value_json, fallback);
    return { version: row.version, value };
  } catch {
    return { version: 'default', value: fallback };
  }
}

/**
 * Sets runtime configuration and automatically records an audit log entry in the same sequence.
 */
export async function setRuntimeConfig<T>(
  db: D1Database,
  params: {
    key: string;
    version: string;
    value: T;
    description?: string;
    updatedBy: string;
    reason: string;
    correlationId: string;
  },
): Promise<void> {
  const now = Date.now();
  const valueJson = JSON.stringify(params.value);

  await db.batch([
    db
      .prepare(
        `INSERT INTO runtime_config (key, version, value_json, description, updated_by, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           version = excluded.version,
           value_json = excluded.value_json,
           description = excluded.description,
           updated_by = excluded.updated_by,
           updated_at = excluded.updated_at`,
      )
      .bind(params.key, params.version, valueJson, params.description || null, params.updatedBy, now),
    db
      .prepare(
        `INSERT INTO operation_audit (id, operator, action, target_type, target_id, reason, correlation_id, status, details_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        `audit_${crypto.randomUUID()}`,
        params.updatedBy,
        'set_runtime_config',
        'config',
        params.key,
        params.reason,
        params.correlationId,
        'success',
        JSON.stringify({ version: params.version }),
        now,
      ),
  ]);
}

/**
 * Performs a lightweight background reconciliation check across Outbox and Projections.
 */
export async function runReconciliationCheck(db: D1Database): Promise<ReconciliationReport> {
  const now = Date.now();
  const fiveMinutesAgo = now - 5 * 60 * 1000;

  try {
    const [outboxPending, outboxStale, activeGenRow, projActive, projPending] = await Promise.all([
      db.prepare('SELECT count(*) as count FROM outbox_events WHERE dispatched_at IS NULL').first<{ count: number }>(),
      db
        .prepare('SELECT count(*) as count FROM outbox_events WHERE dispatched_at IS NULL AND created_at < ?')
        .bind(fiveMinutesAgo)
        .first<{ count: number }>(),
      db.prepare('SELECT index_generation FROM projection_state WHERE is_active = 1').first<{
        index_generation: string;
      }>(),
      db.prepare("SELECT count(*) as count FROM search_documents WHERE status = 'active'").first<{ count: number }>(),
      db.prepare("SELECT count(*) as count FROM search_documents WHERE status = 'pending'").first<{ count: number }>(),
    ]);

    const pendingEvents = outboxPending?.count || 0;
    const staleEvents = outboxStale?.count || 0;
    const activeGeneration = activeGenRow?.index_generation || null;
    const activeCount = projActive?.count || 0;
    const pendingCount = projPending?.count || 0;

    // Healthy if stale outbox events <= 10 and no severe indexing backlog
    const healthy = staleEvents <= 10;

    return {
      timestamp: now,
      outbox: {
        pendingEvents,
        staleEvents,
      },
      projections: {
        activeGeneration,
        activeCount,
        pendingCount,
        staleCount: 0,
      },
      healthy,
    };
  } catch {
    return {
      timestamp: now,
      outbox: { pendingEvents: 0, staleEvents: 0 },
      projections: { activeGeneration: null, activeCount: 0, pendingCount: 0, staleCount: 0 },
      healthy: false,
    };
  }
}
