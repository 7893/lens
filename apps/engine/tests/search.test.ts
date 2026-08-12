import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import search from '../src/routes/search';
import { ApiBindings } from '@lens/shared';

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
    globalThis.caches = { default: mockCache } as unknown as CacheStorage;
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).caches;
  });

  it('returns 400 if q param is missing', async () => {
    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/', {}, env, executionCtx as unknown as ExecutionContext);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Missing query param "q"');
  });

  it('returns 429 when rate limited', async () => {
    const limitedEnv = {
      ...env,
      RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
    } as unknown as ApiBindings;

    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/?q=test', {}, limitedEnv, executionCtx as unknown as ExecutionContext);
    expect(res.status).toBe(429);
  });

  it('returns cached response on cache hit', async () => {
    const cachedData = { results: [{ id: 'cached-photo' }], total: 1, took: 5 };
    const cachedResponse = new Response(JSON.stringify(cachedData), {
      headers: { 'Content-Type': 'application/json' },
    });

    const mockCache = {
      match: vi.fn().mockResolvedValue(cachedResponse),
      put: vi.fn().mockResolvedValue(undefined),
    };
    globalThis.caches = { default: mockCache } as unknown as CacheStorage;

    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/?q=cat', {}, env, executionCtx as unknown as ExecutionContext);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0].id).toBe('cached-photo');
    expect(mockAi.run).not.toHaveBeenCalled();
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
              ai_tags: '["cat", "cute"]',
              meta_json: '{}',
              color: '#ffffff',
            },
          ],
        }),
      }),
    });

    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/?q=cat', {}, env, executionCtx as unknown as ExecutionContext);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(1);
    expect(data.results[0].id).toBe('photo123');
    expect(mockTelemetry.writeDataPoint).toHaveBeenCalled();
  });

  it('returns empty results when no matches found', async () => {
    mockAi.run.mockResolvedValue({ data: [[0.1, 0.2, 0.3]] });
    mockVectorize.query.mockResolvedValue({ matches: [] });
    mockDb.prepare.mockReturnValue({
      bind: () => ({
        all: async () => ({ results: [] }),
      }),
    });

    const executionCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() };
    const res = await search.request('/?q=nonexistent', {}, env, executionCtx as unknown as ExecutionContext);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toHaveLength(0);
    expect(data.total).toBe(0);
  });
});
