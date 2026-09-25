import { adminAuth } from '../middleware/adminAuth';
import { Hono } from 'hono';
import { ApiBindings, Logger, createTrace } from '@lens/shared';
import {
  getRuntimeConfig,
  setRuntimeConfig,
  runReconciliationCheck,
  recordOperationAudit,
  StorageReorganizationService,
} from '../modules/operations';
import { relayOutboxEvents } from '../kernel/events';
import { getActiveIndexGeneration } from '../modules/indexing';
import { BackfillService } from '../modules/catalog';

const internal = new Hono<{ Bindings: ApiBindings }>();

internal.use('*', adminAuth);

/**
 * GET /internal/health
 * Comprehensive diagnostic check of all platform dependencies and active versions.
 */
internal.get('/health', async (c) => {
  const start = Date.now();
  let d1Status: string;
  let activeGeneration: string | null = null;

  try {
    activeGeneration = await getActiveIndexGeneration(c.env.DB, 'vectorize');
    d1Status = 'healthy';
  } catch {
    d1Status = 'unhealthy';
  }

  let r2Status = 'healthy';
  try {
    await c.env.R2.head('healthcheck-probe');
  } catch {
    r2Status = 'unhealthy';
  }

  let kvStatus = 'healthy';
  try {
    await c.env.SETTINGS.get('healthcheck-probe');
  } catch {
    kvStatus = 'unhealthy';
  }

  return c.json({
    status: d1Status === 'healthy' && kvStatus === 'healthy' ? 'healthy' : 'degraded',
    environment: c.env.ENVIRONMENT || 'development',
    activeGeneration,
    dependencies: {
      d1: d1Status,
      r2: r2Status,
      kv: kvStatus,
    },
    latencyMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /internal/reconciliation
 * Returns reconciliation and lag report across Outbox and Search Projections.
 */
internal.get('/reconciliation', async (c) => {
  const report = await runReconciliationCheck(c.env.DB);
  return c.json(report);
});

/**
 * POST /internal/reconciliation/run
 * Forces an explicit reconciliation audit and records the operator event.
 */
internal.post('/reconciliation/run', async (c) => {
  const operator = 'internal-service';
  const correlationId = crypto.randomUUID();

  const report = await runReconciliationCheck(c.env.DB);

  await recordOperationAudit(c.env.DB, {
    operator,
    action: 'trigger_reconciliation',
    target_type: 'system',
    target_id: 'reconciliation',
    reason: 'Manual or automated periodic reconciliation trigger',
    correlation_id: correlationId,
    status: 'success',
    details_json: JSON.stringify(report),
  });

  return c.json({ correlationId, report });
});

/**
 * GET /internal/config/:key
 * Retrieves authoritative runtime config.
 */
internal.get('/config/:key', async (c) => {
  const key = c.req.param('key');
  const result = await getRuntimeConfig(c.env.DB, key, null);
  return c.json(result);
});

/**
 * POST /internal/config
 * Sets runtime config with full audit trail.
 */
internal.post('/config', async (c) => {
  const operator = 'internal-service';
  const correlationId = crypto.randomUUID();

  const body = await c.req.json<{
    key: string;
    version: string;
    value: unknown;
    description?: string;
    reason: string;
  }>();

  if (!body.key || !body.version || !body.value || !body.reason) {
    return c.json({ error: 'Missing required fields: key, version, value, reason' }, 400);
  }

  await setRuntimeConfig(c.env.DB, {
    key: body.key,
    version: body.version,
    value: body.value,
    description: body.description,
    updatedBy: operator,
    reason: body.reason,
    correlationId,
  });

  return c.json({ status: 'updated', key: body.key, version: body.version, correlationId });
});

/**
 * POST /internal/outbox/relay
 * Triggers immediate outbox event dispatch cycle.
 */
internal.post('/outbox/relay', async (c) => {
  const operator = 'internal-service';
  const correlationId = crypto.randomUUID();
  const logger = new Logger(createTrace('OUTBOX_RELAY'), c.env.TELEMETRY);

  const result = await relayOutboxEvents(c.env.DB, c.env.PHOTO_QUEUE, logger);

  await recordOperationAudit(c.env.DB, {
    operator,
    action: 'manual_outbox_relay',
    target_type: 'outbox',
    target_id: 'pending_batch',
    reason: 'Manual outbox relay triggered from internal endpoint',
    correlation_id: correlationId,
    status: 'success',
    details_json: JSON.stringify(result),
  });

  return c.json({ correlationId, result });
});

/**
 * GET /internal/backfill
 * Returns backfill status report for migrating legacy images to canonical tables (KI-005).
 */
internal.get('/backfill', async (c) => {
  const backfillService = new BackfillService(c.env.DB);
  const status = await backfillService.getStatus();
  return c.json(status);
});

/**
 * POST /internal/backfill
 * Executes a batch migration of legacy images to canonical assets with audit logging (KI-005).
 */
internal.post('/backfill', async (c) => {
  const operator = 'internal-service';
  const correlationId = crypto.randomUUID();
  const logger = new Logger(createTrace('BACKFILL_BATCH'), c.env.TELEMETRY);

  let limit = 50;
  try {
    const body = await c.req.json<{ limit?: number }>();
    if (body && typeof body.limit === 'number' && body.limit > 0) {
      limit = Math.min(body.limit, 500);
    }
  } catch {
    // optional body, fallback to default 50
  }

  const backfillService = new BackfillService(c.env.DB, logger);
  const result = await backfillService.runBatch(limit);

  await recordOperationAudit(c.env.DB, {
    operator,
    action: 'run_legacy_backfill_batch',
    target_type: 'catalog',
    target_id: 'legacy_images',
    reason: `Legacy images backfill batch processed limit=${limit}`,
    correlation_id: correlationId,
    status: 'success',
    details_json: JSON.stringify(result),
  });

  return c.json({ correlationId, result });
});

/**
 * GET /internal/storage/reorganize
 * Returns status report for monthly directory reorganization of R2 and D1 image keys.
 */
internal.get('/storage/reorganize', async (c) => {
  const service = new StorageReorganizationService(c.env.DB, c.env.R2);
  const status = await service.getStatus();
  return c.json(status);
});

/**
 * POST /internal/storage/reorganize
 * Executes a batch reorganization of legacy flat images into monthly directories.
 */
internal.post('/storage/reorganize', async (c) => {
  const operator = 'internal-service';
  const correlationId = crypto.randomUUID();
  const logger = new Logger(createTrace('STORAGE_REORG_BATCH'), c.env.TELEMETRY);

  let limit = 50;
  let deleteOld = false;
  let order: 'asc' | 'desc' = 'desc';
  try {
    const body = await c.req.json<{ limit?: number; deleteOld?: boolean; order?: 'asc' | 'desc' }>();
    if (body) {
      if (typeof body.limit === 'number' && body.limit > 0) {
        limit = Math.min(body.limit, 500);
      }
      if (typeof body.deleteOld === 'boolean') {
        deleteOld = body.deleteOld;
      }
      if (body.order === 'asc' || body.order === 'desc') {
        order = body.order;
      }
    }
  } catch {
    // optional body
  }

  const service = new StorageReorganizationService(c.env.DB, c.env.R2, logger);
  const result = await service.runBatch({ limit, deleteOld, order });

  try {
    await recordOperationAudit(c.env.DB, {
      operator,
      action: 'run_storage_reorganization_batch',
      target_type: 'storage',
      target_id: 'monthly_archive',
      reason: `Storage reorganization batch processed limit=${limit} deleteOld=${deleteOld}`,
      correlation_id: correlationId,
      status: 'success',
      details_json: JSON.stringify(result),
    });
  } catch {
    // optional audit logging in case migration 0005 is not yet applied
  }

  return c.json({ correlationId, result });
});

export default internal;
