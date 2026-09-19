import { DomainEvent } from './index';
import { OutboxEventRecord } from '../../modules/catalog/models';
import { Logger } from '@lens/shared';

/**
 * ADR-0006 Transactional Outbox Pattern
 * Prepares an INSERT statement for outbox_events to be bundled into a D1 atomic batch.
 */
export function prepareAppendOutbox(db: D1Database, event: DomainEvent): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO outbox_events (
        event_id, type, schema_version, aggregate_type, aggregate_id, 
        aggregate_version, correlation_id, causation_id, payload_json, occurred_at, dispatched_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      event.eventId,
      event.type,
      event.schemaVersion,
      event.aggregateType,
      event.aggregateId,
      event.aggregateVersion,
      event.correlationId,
      event.causationId ?? null,
      JSON.stringify(event.payload),
      new Date(event.occurredAt).getTime(),
    );
}

/**
 * Reads undispatched events from outbox ordered by occurrence time.
 */
export async function fetchPendingOutboxEvents(db: D1Database, limit: number = 50): Promise<OutboxEventRecord[]> {
  const { results } = await db
    .prepare('SELECT * FROM outbox_events WHERE dispatched_at IS NULL ORDER BY occurred_at ASC LIMIT ?')
    .bind(limit)
    .all<OutboxEventRecord>();

  return results;
}

/**
 * Marks an outbox event as dispatched.
 */
export async function markOutboxDispatched(db: D1Database, eventId: string): Promise<void> {
  await db.prepare('UPDATE outbox_events SET dispatched_at = ? WHERE event_id = ?').bind(Date.now(), eventId).run();
}

/**
 * Outbox Relay Processor:
 * Pushes pending outbox events to a Queue and marks them dispatched.
 */
export async function relayOutboxEvents<T>(
  db: D1Database,
  queue: Queue<T>,
  logger: Logger,
  limit: number = 20,
): Promise<{ dispatched: number; failed: number }> {
  const pending = await fetchPendingOutboxEvents(db, limit);
  let dispatched = 0;
  let failed = 0;

  for (const record of pending) {
    try {
      const payload = JSON.parse(record.payload_json) as T;
      await queue.send(payload);
      await markOutboxDispatched(db, record.event_id);
      dispatched++;
    } catch (err) {
      failed++;
      logger.error(`Failed to relay outbox event ${record.event_id}`, err);
    }
  }

  if (dispatched > 0 || failed > 0) {
    logger.info(`Outbox relay cycle complete: ${dispatched} dispatched, ${failed} failed`);
  }

  return { dispatched, failed };
}
