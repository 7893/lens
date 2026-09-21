import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IngestionService } from '../src/modules/ingestion';
import { EvolutionService } from '../src/modules/operations';
import { fetchLatestPhotos, UnsplashRateLimitError } from '../src/utils/unsplash';
import { ProcessorBindings, IngestionSettings, Logger, createTrace } from '@lens/shared';

describe('Unsplash Rate Limiting & Circuit Breaker (KI-001)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('fetchLatestPhotos Rate Limit Error Handling', () => {
    it('throws UnsplashRateLimitError on HTTP 403 or 429 with reset time', async () => {
      const mockLogger = new Logger(createTrace('TEST'));
      const futureResetSec = Math.floor((Date.now() + 1800 * 1000) / 1000);

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        headers: new Headers({
          'X-Ratelimit-Remaining': '0',
          'X-Ratelimit-Reset': String(futureResetSec),
        }),
        text: vi.fn().mockResolvedValue('Rate limit exceeded'),
      } as unknown as Response);

      try {
        await expect(fetchLatestPhotos('test-key', 1, 30, mockLogger)).rejects.toThrow(UnsplashRateLimitError);
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('extracts reset time from headers when successful with 0 remaining', async () => {
      const mockLogger = new Logger(createTrace('TEST'));
      const futureResetSec = Math.floor((Date.now() + 3600 * 1000) / 1000);

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        headers: new Headers({
          'X-Ratelimit-Remaining': '0',
          'X-Ratelimit-Reset': String(futureResetSec),
        }),
        json: vi.fn().mockResolvedValue([]),
      } as unknown as Response);

      try {
        const result = await fetchLatestPhotos('test-key', 1, 30, mockLogger);
        expect(result.remaining).toBe(0);
        expect(result.resetTimeMs).toBe(futureResetSec * 1000);
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('IngestionService Circuit Breaker', () => {
    it('bypasses network fetch when circuit breaker is currently open in KV', async () => {
      const logger = new Logger(createTrace('TEST'));
      const futureReset = Date.now() + 1800 * 1000;

      const mockSettingsKV = {
        get: vi.fn().mockResolvedValue(String(futureReset)),
        put: vi.fn(),
        delete: vi.fn(),
      };

      const mockEnv = {
        UNSPLASH_API_KEY: 'test-key',
        SETTINGS: mockSettingsKV,
        DB: {},
        PHOTO_QUEUE: {},
      } as unknown as ProcessorBindings;

      const originalFetch = global.fetch;
      global.fetch = vi.fn();

      try {
        const ingestion = new IngestionService(mockEnv, logger);
        const settings: IngestionSettings = {
          backfill_enabled: true,
          backfill_max_pages: 5,
        };

        const result = await ingestion.run('last_seen_1', 1, settings);

        expect(result.circuitOpen).toBe(true);
        expect(result.rateLimited).toBe(true);
        expect(result.totalAdded).toBe(0);
        expect(result.resetTimeMs).toBe(futureReset);
        expect(global.fetch).not.toHaveBeenCalled();
      } finally {
        global.fetch = originalFetch;
      }
    });

    it('trips circuit breaker and stores reset time in KV upon hitting rate limit', async () => {
      const logger = new Logger(createTrace('TEST'));
      const futureResetSec = Math.floor((Date.now() + 2400 * 1000) / 1000);

      const mockSettingsKV = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn(),
      };

      const mockEnv = {
        UNSPLASH_API_KEY: 'test-key',
        SETTINGS: mockSettingsKV,
        DB: {
          prepare: vi.fn().mockReturnValue({
            bind: vi.fn().mockReturnValue({
              all: vi.fn().mockResolvedValue({ results: [] }),
            }),
          }),
        },
        PHOTO_QUEUE: {},
      } as unknown as ProcessorBindings;

      const originalFetch = global.fetch;
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
        headers: new Headers({
          'X-Ratelimit-Remaining': '0',
          'X-Ratelimit-Reset': String(futureResetSec),
        }),
        text: vi.fn().mockResolvedValue('Too Many Requests'),
      } as unknown as Response);

      try {
        const ingestion = new IngestionService(mockEnv, logger);
        const settings: IngestionSettings = {
          backfill_enabled: false,
          backfill_max_pages: 0,
        };

        const result = await ingestion.run('last_seen_1', 1, settings);

        expect(result.rateLimited).toBe(true);
        expect(mockSettingsKV.put).toHaveBeenCalledWith(
          'circuit:unsplash:reset_until',
          String(futureResetSec * 1000),
          expect.objectContaining({ expirationTtl: expect.any(Number) }),
        );
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('EvolutionService Fallback Handover', () => {
    it('executes fallback evolution regardless of scheduled UTC time', async () => {
      const logger = new Logger(createTrace('TEST'));

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({
              results: [{ id: 'img_legacy_1' }, { id: 'img_legacy_2' }],
            }),
          }),
        }),
      };

      const mockQueue = {
        sendBatch: vi.fn().mockResolvedValue(undefined),
      };

      const mockEnv = {
        DB: mockDb,
        PHOTO_QUEUE: mockQueue,
        SETTINGS: {
          get: vi.fn().mockResolvedValue(JSON.stringify({ evolution_cost_per_image_usd: 0.001 })),
        },
      } as unknown as ProcessorBindings;

      const evolution = new EvolutionService(mockEnv, logger);
      const settings: IngestionSettings = {
        // Scheduled trigger time is set to an arbitrary time that won't match Date.now()
        evolution_trigger_utc: '03:15',
        daily_evolution_limit_usd: 0.5,
      };

      // Regular pulse should return 0 because time does not match
      const normalEvolved = await evolution.pulse(settings);
      expect(normalEvolved).toBe(0);
      expect(mockQueue.sendBatch).not.toHaveBeenCalled();

      // Trigger fallback evolution (bypasses UTC check)
      const fallbackEvolved = await evolution.triggerFallbackEvolution(settings);
      expect(fallbackEvolved).toBe(2);
      expect(mockQueue.sendBatch).toHaveBeenCalledTimes(1);
    });
  });
});
