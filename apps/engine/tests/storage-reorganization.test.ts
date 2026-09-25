import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StorageReorganizationService } from '../src/modules/operations/StorageReorganizationService';
import internal from '../src/routes/internal';
import { ApiBindings } from '@lens/shared';

describe('StorageReorganizationService', () => {
  let mockDb: { prepare: ReturnType<typeof vi.fn>; batch: ReturnType<typeof vi.fn> };
  let mockR2: {
    get: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    head: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb = {
      prepare: vi.fn(),
      batch: vi.fn().mockResolvedValue([]),
    };
    mockR2 = {
      get: vi.fn(),
      put: vi.fn().mockResolvedValue({}),
      head: vi.fn().mockResolvedValue(null),
      delete: vi.fn().mockResolvedValue(undefined),
    };
  });

  describe('getStatus', () => {
    it('calculates reorganization progress accurately', async () => {
      mockDb.prepare.mockImplementation((query: string) => ({
        first: vi.fn().mockImplementation(async () => {
          if (query.includes("NOT LIKE 'display/%/%'")) {
            return { count: 300 };
          }
          return { count: 1000 };
        }),
      }));

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const status = await service.getStatus();

      expect(status.total).toBe(1000);
      expect(status.pending).toBe(300);
      expect(status.reorganized).toBe(700);
      expect(status.percentage).toBe(70.0);
    });

    it('handles empty database gracefully', async () => {
      mockDb.prepare.mockImplementation(() => ({
        first: vi.fn().mockResolvedValue({ count: 0 }),
      }));

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const status = await service.getStatus();

      expect(status.total).toBe(0);
      expect(status.pending).toBe(0);
      expect(status.reorganized).toBe(0);
      expect(status.percentage).toBe(100.0);
    });
  });

  describe('runBatch', () => {
    it('returns empty result when no pending rows remain', async () => {
      mockDb.prepare.mockImplementation((query: string) => {
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: [] }),
            }),
          };
        }
        return {
          first: async () => ({ count: 0 }),
        };
      });

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const result = await service.runBatch({ limit: 10 });

      expect(result.processed).toBe(0);
      expect(result.migrated).toBe(0);
      expect(result.remaining).toBe(0);
      expect(mockR2.put).not.toHaveBeenCalled();
    });

    it('migrates un-migrated records using meta_json.created_at', async () => {
      const rows = [
        {
          id: 'photo-sep-2020',
          raw_key: 'raw/photo-sep-2020.jpg',
          display_key: 'display/photo-sep-2020.jpg',
          meta_json: JSON.stringify({ created_at: '2020-09-15T10:00:00Z' }),
          created_at: 1770000000000,
        },
        {
          id: 'photo-dec-2025',
          raw_key: 'raw/photo-dec-2025.jpg',
          display_key: 'display/photo-dec-2025.jpg',
          meta_json: JSON.stringify({ created_at: '2025-12-28T22:39:25Z' }),
          created_at: 1771498944278,
        },
      ];

      const mockBody = new ReadableStream();
      mockR2.head.mockResolvedValue(null);
      mockR2.get.mockImplementation(async (key: string) => {
        if (key.startsWith('display/')) {
          return {
            body: mockBody,
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: {},
          };
        }
        // simulate raw object not present
        return null;
      });

      mockDb.prepare.mockImplementation((query: string) => {
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: rows }),
            }),
          };
        }
        if (query.includes('UPDATE images SET display_key = ?')) {
          return {
            bind: vi.fn().mockReturnThis(),
          };
        }
        return {
          first: async () => ({ count: 100 }),
        };
      });

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const result = await service.runBatch({ limit: 10, deleteOld: false });

      expect(result.processed).toBe(2);
      expect(result.migrated).toBe(2);
      expect(result.failed).toBe(0);

      // Verify R2 put calls
      expect(mockR2.put).toHaveBeenCalledWith(
        'display/202009/photo-sep-2020.jpg',
        mockBody,
        expect.objectContaining({ httpMetadata: { contentType: 'image/jpeg' } }),
      );
      expect(mockR2.put).toHaveBeenCalledWith(
        'display/202512/photo-dec-2025.jpg',
        mockBody,
        expect.objectContaining({ httpMetadata: { contentType: 'image/jpeg' } }),
      );

      // Delete should not be called when deleteOld is false
      expect(mockR2.delete).not.toHaveBeenCalled();

      // Verify D1 batch called
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
    });

    it('falls back to created_at timestamp ms when meta_json has no created_at', async () => {
      const rows = [
        {
          id: 'photo-timestamp',
          raw_key: 'raw/photo-timestamp.jpg',
          display_key: 'display/photo-timestamp.jpg',
          meta_json: '{}',
          created_at: new Date('2023-04-10T12:00:00Z').getTime(),
        },
      ];

      const mockBody = new ReadableStream();
      mockR2.head.mockResolvedValue(null);
      mockR2.get.mockImplementation(async (key: string) => {
        if (key === 'display/photo-timestamp.jpg') {
          return {
            body: mockBody,
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: {},
          };
        }
        return null;
      });

      mockDb.prepare.mockImplementation((query: string) => {
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: rows }),
            }),
          };
        }
        if (query.includes('UPDATE images SET display_key = ?')) {
          return {
            bind: vi.fn().mockReturnThis(),
          };
        }
        return {
          first: async () => ({ count: 50 }),
        };
      });

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const result = await service.runBatch({ limit: 5 });

      expect(result.migrated).toBe(1);
      expect(mockR2.put).toHaveBeenCalledWith('display/202304/photo-timestamp.jpg', mockBody, expect.anything());
    });

    it('deletes old keys when deleteOld option is enabled', async () => {
      const rows = [
        {
          id: 'photo-del',
          raw_key: 'raw/photo-del.jpg',
          display_key: 'display/photo-del.jpg',
          meta_json: JSON.stringify({ created_at: '2024-05-01T00:00:00Z' }),
          created_at: 1714521600000,
        },
      ];

      const mockBody = new ReadableStream();
      mockR2.head.mockResolvedValue(null);
      mockR2.get.mockImplementation(async (key: string) => {
        if (key === 'display/photo-del.jpg' || key === 'raw/photo-del.jpg') {
          return {
            body: mockBody,
            httpMetadata: { contentType: 'image/jpeg' },
            customMetadata: {},
          };
        }
        return null;
      });

      mockDb.prepare.mockImplementation((query: string) => {
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: rows }),
            }),
          };
        }
        if (query.includes('UPDATE images SET display_key = ?')) {
          return {
            bind: vi.fn().mockReturnThis(),
          };
        }
        return {
          first: async () => ({ count: 10 }),
        };
      });

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const result = await service.runBatch({ limit: 1, deleteOld: true });

      expect(result.migrated).toBe(1);
      expect(mockR2.delete).toHaveBeenCalledWith(
        expect.arrayContaining(['display/photo-del.jpg', 'raw/photo-del.jpg']),
      );
    });

    it('skips R2 copy if target object already exists', async () => {
      const rows = [
        {
          id: 'photo-exists',
          raw_key: 'raw/photo-exists.jpg',
          display_key: 'display/photo-exists.jpg',
          meta_json: JSON.stringify({ created_at: '2026-01-01T00:00:00Z' }),
          created_at: 1767225600000,
        },
      ];

      mockR2.head.mockImplementation(async (key: string) => {
        if (key === 'display/202601/photo-exists.jpg') return { key };
        return null;
      });

      mockDb.prepare.mockImplementation((query: string) => {
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: rows }),
            }),
          };
        }
        if (query.includes('UPDATE images SET display_key = ?')) {
          return {
            bind: vi.fn().mockReturnThis(),
          };
        }
        return {
          first: async () => ({ count: 10 }),
        };
      });

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      const result = await service.runBatch({ limit: 1 });

      expect(result.migrated).toBe(1);
      expect(mockR2.put).not.toHaveBeenCalled();
      expect(mockDb.batch).toHaveBeenCalledTimes(1);
    });

    it('supports ascending order for dual-worker migration', async () => {
      const executedQueries: string[] = [];
      mockDb.prepare.mockImplementation((query: string) => {
        executedQueries.push(query);
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: [] }),
            }),
          };
        }
        return {
          first: async () => ({ count: 10 }),
        };
      });

      const service = new StorageReorganizationService(mockDb as unknown as D1Database, mockR2 as unknown as R2Bucket);
      await service.runBatch({ limit: 5, order: 'asc' });

      expect(executedQueries.some((q) => q.includes('ORDER BY created_at ASC'))).toBe(true);
    });
  });

  describe('Internal HTTP Endpoints', () => {
    it('GET /internal/storage/reorganize returns reorganization status', async () => {
      mockDb.prepare.mockImplementation((query: string) => ({
        first: vi.fn().mockImplementation(async () => {
          if (query.includes("NOT LIKE 'display/%/%'")) {
            return { count: 500 };
          }
          return { count: 25319 };
        }),
      }));

      const env = {
        DB: mockDb,
        R2: mockR2,
        ENVIRONMENT: 'development',
        INTERNAL_API_SECRET: 'test-only-administrative-secret-32-characters',
        ADMIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
      } as unknown as ApiBindings;

      const res = await internal.request(
        '/storage/reorganize',
        { method: 'GET', headers: { authorization: 'Bearer test-only-administrative-secret-32-characters' } },
        env,
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.total).toBe(25319);
      expect(body.pending).toBe(500);
      expect(body.reorganized).toBe(24819);
      expect(body.percentage).toBe(98.03);
    });

    it('POST /internal/storage/reorganize triggers batch execution with audit log', async () => {
      mockDb.prepare.mockImplementation((query: string) => {
        if (query.includes('LIMIT ?')) {
          return {
            bind: () => ({
              all: async () => ({ results: [] }),
            }),
          };
        }
        return {
          bind: () => ({
            run: async () => ({ success: true }),
            first: async () => ({ count: 0 }),
            all: async () => ({ results: [] }),
          }),
          first: async () => ({ count: 0 }),
        };
      });

      const env = {
        DB: mockDb,
        R2: mockR2,
        ENVIRONMENT: 'development',
        INTERNAL_API_SECRET: 'test-only-administrative-secret-32-characters',
        ADMIN_RATE_LIMITER: { limit: async () => ({ success: true }) },
      } as unknown as ApiBindings;

      const res = await internal.request(
        '/storage/reorganize',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: 'Bearer test-only-administrative-secret-32-characters',
          },
          body: JSON.stringify({ limit: 25, deleteOld: false }),
        },
        env,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('correlationId');
      expect(body.result).toHaveProperty('processed');
    });
  });
});
