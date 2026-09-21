import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BackfillService } from '../src/modules/catalog/BackfillService';
import internal from '../src/routes/internal';
import { ApiBindings } from '@lens/shared';

describe('Legacy Images Backfill Service (ADR-0006 / KI-005)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('BackfillService.getStatus', () => {
    it('calculates legacy, migrated, remaining count and completion percentage', async () => {
      const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          return {
            first: vi.fn().mockImplementation(async () => {
              if (sql.includes('FROM images')) {
                return { count: 100 };
              }
              if (sql.includes('FROM assets')) {
                return { count: 40 };
              }
              return { count: 0 };
            }),
          };
        }),
      } as unknown as D1Database;

      const service = new BackfillService(mockDb);
      const status = await service.getStatus();

      expect(status).toEqual({
        legacyTotal: 100,
        migratedTotal: 40,
        remaining: 60,
        percentage: 40.0,
      });
    });

    it('handles zero legacy items gracefully (100% complete)', async () => {
      const mockDb = {
        prepare: vi.fn().mockImplementation(() => ({
          first: vi.fn().mockResolvedValue({ count: 0 }),
        })),
      } as unknown as D1Database;

      const service = new BackfillService(mockDb);
      const status = await service.getStatus();

      expect(status).toEqual({
        legacyTotal: 0,
        migratedTotal: 0,
        remaining: 0,
        percentage: 100.0,
      });
    });

    it('handles null returns from db queries', async () => {
      const mockDb = {
        prepare: vi.fn().mockImplementation(() => ({
          first: vi.fn().mockResolvedValue(null),
        })),
      } as unknown as D1Database;

      const service = new BackfillService(mockDb);
      const status = await service.getStatus();

      expect(status).toEqual({
        legacyTotal: 0,
        migratedTotal: 0,
        remaining: 0,
        percentage: 100.0,
      });
    });
  });

  describe('BackfillService.runBatch', () => {
    it('returns processed: 0 when no unmigrated rows remain', async () => {
      const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => ({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [] }),
          }),
          first: vi.fn().mockImplementation(async () => {
            if (sql.includes('FROM images')) return { count: 50 };
            if (sql.includes('FROM assets')) return { count: 50 };
            return { count: 0 };
          }),
        })),
        batch: vi.fn(),
      } as unknown as D1Database;

      const service = new BackfillService(mockDb);
      const result = await service.runBatch(50);

      expect(result).toEqual({ processed: 0, remaining: 0 });
      expect(mockDb.batch).not.toHaveBeenCalled();
    });

    it('transforms legacy images and executes atomic D1 batch insertions', async () => {
      const mockLegacyRow = {
        id: 'legacy_img_1',
        width: 1920,
        height: 1080,
        color: '#aabbcc',
        raw_key: 'raw/1.jpg',
        display_key: 'display/1.webp',
        meta_json: JSON.stringify({
          user: { name: 'Alice Photographer', links: { html: 'https://unsplash.com/@alice' } },
          links: { html: 'https://unsplash.com/photos/legacy_img_1' },
        }),
        ai_tags: JSON.stringify(['sunset', 'ocean']),
        ai_caption: 'A golden sunset over the tranquil ocean',
        ai_embedding: null,
        ai_model: '@cf/meta/llama-4-scout-17b-16e-instruct',
        ai_quality_score: 8.8,
        entities_json: JSON.stringify(['ocean', 'sun']),
        created_at: 1700000000000,
        vectorize_synced: 1,
      };

      const mockBatch = vi.fn().mockResolvedValue([]);
      const mockPrepare = vi.fn().mockImplementation((sql: string) => {
        return {
          bind: vi.fn().mockImplementation((...args: unknown[]) => {
            return {
              all: vi.fn().mockResolvedValue({ results: [mockLegacyRow] }),
              args,
            };
          }),
          first: vi.fn().mockImplementation(async () => {
            if (sql.includes('FROM images')) return { count: 10 };
            if (sql.includes('FROM assets')) return { count: 1 };
            return { count: 0 };
          }),
        };
      });

      const mockDb = {
        prepare: mockPrepare,
        batch: mockBatch,
      } as unknown as D1Database;

      const service = new BackfillService(mockDb);
      const result = await service.runBatch(10);

      expect(result.processed).toBe(1);
      expect(result.remaining).toBe(9);
      expect(mockBatch).toHaveBeenCalledTimes(1);

      // Verify batch statements array contains 4 statements: assets, asset_sources, representations, search_documents
      const batchStatements = mockBatch.mock.calls[0][0];
      expect(batchStatements).toHaveLength(4);

      // Verify statements targeted canonical tables
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO assets'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO asset_sources'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO representations'));
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR IGNORE INTO search_documents'));
    });

    it('gracefully handles malformed meta_json in legacy rows', async () => {
      const mockMalformedRow = {
        id: 'legacy_img_broken',
        width: 800,
        height: 600,
        color: null,
        raw_key: 'raw/broken.jpg',
        display_key: 'display/broken.webp',
        meta_json: '{ bad json',
        ai_tags: null,
        ai_caption: null,
        ai_embedding: null,
        ai_model: null,
        ai_quality_score: null,
        entities_json: null,
        created_at: 1700000000000,
        vectorize_synced: 0,
      };

      const mockBatch = vi.fn().mockResolvedValue([]);
      const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => ({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: [mockMalformedRow] }),
          }),
          first: vi.fn().mockImplementation(async () => {
            if (sql.includes('FROM images')) return { count: 1 };
            if (sql.includes('FROM assets')) return { count: 1 };
            return { count: 0 };
          }),
        })),
        batch: mockBatch,
      } as unknown as D1Database;

      const service = new BackfillService(mockDb);
      const result = await service.runBatch(10);

      expect(result.processed).toBe(1);
      expect(mockBatch).toHaveBeenCalledTimes(1);
      expect(mockBatch.mock.calls[0][0]).toHaveLength(4);
    });
  });

  describe('Internal Backfill Endpoints', () => {
    const mockEnv = {
      ENVIRONMENT: 'production',
      DB: {
        prepare: vi.fn().mockImplementation((_sql: string) => {
          return {
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [] }),
              first: vi.fn().mockResolvedValue({ count: 50 }),
              run: vi.fn().mockResolvedValue({ success: true }),
            }),
            first: vi.fn().mockResolvedValue({ count: 50 }),
          };
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
      TELEMETRY: undefined,
    } as unknown as ApiBindings;

    it('rejects unauthenticated requests in production', async () => {
      const res = await internal.request('/backfill', { method: 'GET' }, mockEnv);
      expect(res.status).toBe(401);
    });

    it('returns backfill status on GET /internal/backfill when authenticated', async () => {
      const res = await internal.request(
        '/backfill',
        {
          method: 'GET',
          headers: {
            'cf-access-authenticated-user-email': 'sre@lens.internal',
          },
        },
        mockEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveProperty('legacyTotal');
      expect(data).toHaveProperty('migratedTotal');
      expect(data).toHaveProperty('percentage');
    });

    it('triggers batch execution on POST /internal/backfill with audit logging', async () => {
      const res = await internal.request(
        '/backfill',
        {
          method: 'POST',
          headers: {
            'cf-access-authenticated-user-email': 'sre@lens.internal',
            'content-type': 'application/json',
          },
          body: JSON.stringify({ limit: 25 }),
        },
        mockEnv,
      );

      expect(res.status).toBe(200);
      const data = (await res.json()) as { correlationId: string; result: { processed: number } };
      expect(data).toHaveProperty('correlationId');
      expect(data).toHaveProperty('result');
      expect(data.result).toHaveProperty('processed');
    });
  });
});
