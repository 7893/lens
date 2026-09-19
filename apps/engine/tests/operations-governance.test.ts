import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  recordOperationAudit,
  getRuntimeConfig,
  setRuntimeConfig,
  runReconciliationCheck,
} from '../src/modules/operations';
import internal from '../src/routes/internal';
import { ApiBindings } from '@lens/shared';

describe('Operations Governance & Audit (Phase 6)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Operation Audit Logging', () => {
    it('records immutable audit log with correlation ID and timestamp', async () => {
      const mockRun = vi.fn().mockResolvedValue({ success: true });
      const mockBind = vi.fn().mockReturnValue({ run: mockRun });
      const mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });

      const mockDb = { prepare: mockPrepare } as unknown as D1Database;

      const record = await recordOperationAudit(mockDb, {
        operator: 'admin@example.com',
        action: 'promote_index_generation',
        target_type: 'index_generation',
        target_id: 'gen-2026-02',
        reason: 'Shadow evaluation passed with 99.8% NDCG',
        correlation_id: 'corr-xyz-123',
        status: 'success',
        details_json: JSON.stringify({ score: 0.998 }),
      });

      expect(record.id).toMatch(/^audit_/);
      expect(record.created_at).toBeGreaterThan(0);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO operation_audit'));
      expect(mockBind).toHaveBeenCalledWith(
        record.id,
        'admin@example.com',
        'promote_index_generation',
        'index_generation',
        'gen-2026-02',
        'Shadow evaluation passed with 99.8% NDCG',
        'corr-xyz-123',
        'success',
        JSON.stringify({ score: 0.998 }),
        record.created_at,
      );
      expect(mockRun).toHaveBeenCalled();
    });
  });

  describe('Authoritative Runtime Configuration', () => {
    it('returns default fallback when key does not exist', async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue(null),
          }),
        }),
      } as unknown as D1Database;

      const config = await getRuntimeConfig(mockDb, 'search_rrf_k', 60);
      expect(config).toEqual({ version: 'default', value: 60 });
    });

    it('sets config and writes audit log atomically in D1', async () => {
      const mockBatch = vi.fn().mockResolvedValue([]);
      const mockDb = {
        batch: mockBatch,
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({}),
        }),
      } as unknown as D1Database;

      await setRuntimeConfig(mockDb, {
        key: 'search_rrf_k',
        version: 'v2',
        value: 70,
        description: 'Updated RRF k parameter',
        updatedBy: 'sre@example.com',
        reason: 'Fine-tuning recall balance',
        correlationId: 'corr-update-k',
      });

      expect(mockBatch).toHaveBeenCalled();
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO runtime_config'));
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO operation_audit'));
    });
  });

  describe('Reconciliation Diagnostics', () => {
    it('gathers outbox lag and projection metrics into a health report', async () => {
      const mockDb = {
        prepare: vi.fn().mockImplementation((sql: string) => {
          return {
            bind: vi.fn().mockReturnValue({
              first: vi.fn().mockImplementation(async () => {
                if (sql.includes('created_at < ?')) return { count: 2 };
                return { count: 5 };
              }),
            }),
            first: vi.fn().mockImplementation(async () => {
              if (sql.includes('is_active = 1')) return { index_generation: 'gen-2026-01' };
              if (sql.includes("status = 'active'")) return { count: 120 };
              if (sql.includes("status = 'pending'")) return { count: 3 };
              return { count: 0 };
            }),
          };
        }),
      } as unknown as D1Database;

      const report = await runReconciliationCheck(mockDb);

      expect(report.healthy).toBe(true);
      expect(report.projections.activeGeneration).toBe('gen-2026-01');
      expect(report.projections.activeCount).toBe(120);
      expect(report.outbox.staleEvents).toBe(2);
    });
  });

  describe('Internal Management HTTP Route', () => {
    const mockEnv = {
      ENVIRONMENT: 'production',
      DB: {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            first: vi.fn().mockResolvedValue({ index_generation: 'gen-2026-01' }),
            run: vi.fn().mockResolvedValue({ success: true }),
          }),
          first: vi.fn().mockResolvedValue({ index_generation: 'gen-2026-01' }),
        }),
        batch: vi.fn().mockResolvedValue([]),
      },
      R2: {
        head: vi.fn().mockResolvedValue(null),
      },
      SETTINGS: {
        get: vi.fn().mockResolvedValue(null),
      },
      PHOTO_QUEUE: {
        send: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as ApiBindings;

    it('rejects unauthenticated requests in production', async () => {
      const res = await internal.request('/health', { method: 'GET' }, mockEnv);
      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error).toContain('Unauthorized');
    });

    it('allows access with Cloudflare Access header and returns diagnostic health', async () => {
      const res = await internal.request(
        '/health',
        {
          method: 'GET',
          headers: {
            'cf-access-authenticated-user-email': 'admin@lens.internal',
          },
        },
        mockEnv,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.status).toBe('healthy');
      expect(data.environment).toBe('production');
      expect(data.activeGeneration).toBe('gen-2026-01');
      expect(data.dependencies.d1).toBe('healthy');
    });
  });
});
