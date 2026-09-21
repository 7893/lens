import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleScheduled } from '../src/handlers/scheduled';
import { ProcessorBindings } from '@lens/shared';

describe('Scheduled Cron Handler & Self-Healing (KI-007)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('executes scheduled pulse, reconciliation check and auto-relays pending outbox events', async () => {
    // Mock global fetch for Unsplash
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    } as unknown as Response);

    const createMockStmt = (sql: string) => {
      const stmt = {
        bind: vi.fn().mockReturnThis(),
        first: vi.fn().mockImplementation(async () => {
          if (sql.includes('outbox_events WHERE dispatched_at IS NULL AND created_at < ?')) {
            return { count: 3 };
          }
          if (sql.includes('outbox_events WHERE dispatched_at IS NULL')) {
            return { count: 5 };
          }
          if (sql.includes('projection_state')) {
            return { index_generation: 'gen-001' };
          }
          if (sql.includes("status = 'active'")) {
            return { count: 100 };
          }
          return { count: 0 };
        }),
        all: vi.fn().mockImplementation(async () => {
          if (sql.includes('system_config')) {
            return {
              results: [
                { key: 'last_seen_id', value: 'photo-123' },
                { key: 'backfill_next_page', value: '1' },
              ],
            };
          }
          if (sql.includes('outbox_events WHERE dispatched_at IS NULL')) {
            return {
              results: [
                {
                  event_id: 'evt-1',
                  type: 'asset.discovered',
                  schema_version: 1,
                  aggregate_type: 'asset',
                  aggregate_id: 'ast-1',
                  aggregate_version: 1,
                  correlation_id: 'corr-1',
                  payload_json: JSON.stringify({ type: 'process-photo', photoId: 'p1' }),
                  occurred_at: Date.now() - 10000,
                  dispatched_at: null,
                },
              ],
            };
          }
          return { results: [] };
        }),
        run: vi.fn().mockResolvedValue({ success: true }),
      };
      return stmt;
    };

    const mockDb = {
      prepare: vi.fn().mockImplementation((sql: string) => createMockStmt(sql)),
    } as unknown as D1Database;

    const mockQueue = {
      send: vi.fn().mockResolvedValue(undefined),
    };

    const mockSettings = {
      get: vi.fn().mockResolvedValue(
        JSON.stringify({
          backfill_enabled: false,
          backfill_max_pages: 1,
          daily_evolution_limit_usd: 1.0,
          evolution_trigger_utc: '23:00',
        }),
      ),
      list: vi.fn().mockResolvedValue({ keys: [] }),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    const mockEnv = {
      UNSPLASH_API_KEY: 'test-api-key',
      DB: mockDb,
      SETTINGS: mockSettings,
      PHOTO_QUEUE: mockQueue,
      TELEMETRY: { writeDataPoint: vi.fn() },
    } as unknown as ProcessorBindings;

    await handleScheduled(mockEnv);

    // Verify outbox was polled and relayed
    expect(mockQueue.send).toHaveBeenCalledWith(expect.objectContaining({ type: 'process-photo', photoId: 'p1' }));
  });
});
