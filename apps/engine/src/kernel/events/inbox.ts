/**
 * ADR-0006 Consumer Idempotency (Inbox Pattern)
 * Ensures consumers do not process duplicate events.
 */

/**
 * Checks if an event has already been consumed by a specific consumer.
 */
export async function isEventConsumed(db: D1Database, consumer: string, eventId: string): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM consumed_events WHERE consumer = ? AND event_id = ?')
    .bind(consumer, eventId)
    .first();

  return !!row;
}

/**
 * Prepares statement to record event consumption (to be bundled with business mutation).
 */
export function prepareRecordEventConsumed(db: D1Database, consumer: string, eventId: string): D1PreparedStatement {
  return db
    .prepare('INSERT OR IGNORE INTO consumed_events (consumer, event_id, consumed_at) VALUES (?, ?, ?)')
    .bind(consumer, eventId, Date.now());
}

/**
 * Records event consumption directly.
 */
export async function recordEventConsumed(db: D1Database, consumer: string, eventId: string): Promise<void> {
  await prepareRecordEventConsumed(db, consumer, eventId).run();
}
