import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createDomainEvent,
  prepareAppendOutbox,
  fetchPendingOutboxEvents,
  markOutboxDispatched,
  relayOutboxEvents,
  isEventConsumed,
  recordEventConsumed,
} from '../src/kernel/events';
import { Logger, createTrace } from '@lens/shared';
import { OutboxEventRecord } from '../src/modules/catalog';

describe('Transactional Outbox & Inbox (Phase 3)', () => {
  let mockOutboxTable: Map<string, OutboxEventRecord>;
  let mockConsumedTable: Set<string>;
  let mockDb: D1Database;
  let logger: Logger;

  beforeEach(() => {
    mockOutboxTable = new Map();
    mockConsumedTable = new Set();
    logger = new Logger(createTrace('TEST'));

    mockDb = {
      prepare(query: string) {
        let boundArgs: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            boundArgs = args;
            return stmt;
          },
          async run() {
            if (query.includes('INSERT INTO outbox_events')) {
              const record: OutboxEventRecord = {
                event_id: boundArgs[0] as string,
                type: boundArgs[1] as string,
                schema_version: boundArgs[2] as number,
                aggregate_type: boundArgs[3] as string,
                aggregate_id: boundArgs[4] as string,
                aggregate_version: boundArgs[5] as number,
                correlation_id: boundArgs[6] as string,
                causation_id: boundArgs[7] as string | null,
                payload_json: boundArgs[8] as string,
                occurred_at: boundArgs[9] as number,
                dispatched_at: null,
              };
              mockOutboxTable.set(record.event_id, record);
              return { success: true };
            }
            if (query.includes('UPDATE outbox_events SET dispatched_at')) {
              const [time, id] = boundArgs as [number, string];
              const existing = mockOutboxTable.get(id);
              if (existing) {
                existing.dispatched_at = time;
              }
              return { success: true };
            }
            if (query.includes('INSERT OR IGNORE INTO consumed_events')) {
              const [consumer, eventId] = boundArgs as [string, string];
              mockConsumedTable.add(`${consumer}:${eventId}`);
              return { success: true };
            }
            return { success: true };
          },
          async first() {
            if (query.includes('SELECT 1 FROM consumed_events')) {
              const [consumer, eventId] = boundArgs as [string, string];
              if (mockConsumedTable.has(`${consumer}:${eventId}`)) {
                return { 1: 1 };
              }
              return null;
            }
            return null;
          },
          async all() {
            if (query.includes('SELECT * FROM outbox_events WHERE dispatched_at IS NULL')) {
              const pending = Array.from(mockOutboxTable.values()).filter((r) => r.dispatched_at === null);
              return { results: pending };
            }
            return { results: [] };
          },
        };
        return stmt as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
  });

  describe('Transactional Outbox', () => {
    it('prepares and persists outbox event statement for D1 batch', async () => {
      const event = createDomainEvent({
        type: 'asset.registered',
        aggregateType: 'asset',
        aggregateId: 'ast_101',
        aggregateVersion: 1,
        correlationId: 'trace-101',
        payload: { source: 'unsplash' },
      });

      const stmt = prepareAppendOutbox(mockDb, event);
      await stmt.run();

      const pending = await fetchPendingOutboxEvents(mockDb);
      expect(pending).toHaveLength(1);
      expect(pending[0].event_id).toBe(event.eventId);
      expect(pending[0].type).toBe('asset.registered');
      expect(pending[0].dispatched_at).toBeNull();
    });

    it('relays outbox events to queue and marks dispatched atomically', async () => {
      const event = createDomainEvent({
        type: 'asset.registered',
        aggregateType: 'asset',
        aggregateId: 'ast_102',
        aggregateVersion: 1,
        correlationId: 'trace-102',
        payload: { source: 'unsplash' },
      });

      await prepareAppendOutbox(mockDb, event).run();

      const mockQueue = {
        send: vi.fn().mockResolvedValue(undefined),
      } as unknown as Queue;

      const { dispatched, failed } = await relayOutboxEvents(mockDb, mockQueue, logger);
      expect(dispatched).toBe(1);
      expect(failed).toBe(0);
      expect(mockQueue.send).toHaveBeenCalledTimes(1);

      const pendingAfter = await fetchPendingOutboxEvents(mockDb);
      expect(pendingAfter).toHaveLength(0);
    });

    it('marks outbox event as dispatched manually', async () => {
      const event = createDomainEvent({
        type: 'asset.registered',
        aggregateType: 'asset',
        aggregateId: 'ast_103',
        aggregateVersion: 1,
        correlationId: 'trace-103',
        payload: {},
      });

      await prepareAppendOutbox(mockDb, event).run();
      await markOutboxDispatched(mockDb, event.eventId);

      const pending = await fetchPendingOutboxEvents(mockDb);
      expect(pending).toHaveLength(0);
    });
  });

  describe('Consumer Idempotency (Inbox)', () => {
    it('tracks and prevents duplicate consumption of the same event', async () => {
      const eventId = 'evt_test_999';
      const consumer = 'ingest_worker';

      // First check: not consumed
      const alreadyConsumedBefore = await isEventConsumed(mockDb, consumer, eventId);
      expect(alreadyConsumedBefore).toBe(false);

      // Record consumption
      await recordEventConsumed(mockDb, consumer, eventId);

      // Second check: consumed
      const alreadyConsumedAfter = await isEventConsumed(mockDb, consumer, eventId);
      expect(alreadyConsumedAfter).toBe(true);

      // Different consumer: not consumed
      const otherConsumer = await isEventConsumed(mockDb, 'index_worker', eventId);
      expect(otherConsumer).toBe(false);
    });
  });
});
