import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import search from '../src/routes/search';
import { ApiBindings } from '@lens/shared';

const isValidFilename = (f: string) => /^[a-zA-Z0-9_-]+\.jpg$/.test(f);
const calcThreshold = (topScore: number) => Math.max(topScore * 0.9, 0.6);

describe('filename validation', () => {
  it('accepts valid filenames', () => {
    expect(isValidFilename('abc123.jpg')).toBe(true);
  });
  it('rejects invalid filenames', () => {
    expect(isValidFilename('../etc/passwd')).toBe(false);
  });
});

describe('dynamic relevance threshold', () => {
  it('uses topScore * 0.9 when above floor', () => {
    expect(calcThreshold(0.8)).toBeCloseTo(0.72);
  });
});

describe('Search API Route', () => {
  const mockAi = { run: vi.fn() };
  const mockVectorize = { query: vi.fn() };
  const mockDb = { prepare: vi.fn() };
  const mockSettings = { put: vi.fn(), get: vi.fn() };
  const mockTelemetry = { writeDataPoint: vi.fn() };

  const env = {
    AI: mockAi,
    VECTORIZE: mockVectorize,
    DB: mockDb,
    SETTINGS: mockSettings,
    TELEMETRY: mockTelemetry,
    RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  } as unknown as ApiBindings;

  beforeEach(() => {
    vi.clearAllMocks();
    const mockCache = {
      match: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.caches = { default: mockCache } as any;
  });

  afterEach(() => {
    delete (globalThis as any).caches;
  });

  it('returns 400 if q param is missing', async () => {
    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/', {}, env, executionCtx as any);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing query param "q"');
  });

  it('performs vector search and returns results', async () => {
    mockAi.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
    mockVectorize.query.mockResolvedValue({
      matches: [{ id: 'photo123', score: 0.85 }],
    });
    mockDb.prepare.mockReturnValue({
      bind: () => ({
        all: async () => ({
          results: [
            {
              id: 'photo123',
              display_key: 'display/photo123.jpg',
              width: 800,
              height: 600,
              ai_caption: 'A cute cat',
              color: '#ffffff',
            },
          ],
        }),
      }),
    });

    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/?q=cat', {}, env, executionCtx as any);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].id).toBe('photo123');
    expect(mockTelemetry.writeDataPoint).toHaveBeenCalled();
  });
});
