import { describe, it, expect, vi, beforeEach } from 'vitest';
import stats from '../src/routes/stats';
import { ApiBindings } from '@lens/shared';

describe('Stats API Route', () => {
  const mockDb = { prepare: vi.fn() };
  const mockSettings = { get: vi.fn(), put: vi.fn() };
  const mockTelemetry = { writeDataPoint: vi.fn() };

  const env = {
    DB: mockDb,
    SETTINGS: mockSettings,
    TELEMETRY: mockTelemetry,
  } as unknown as ApiBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /', () => {
    it('returns cached stats when available', async () => {
      const cachedData = { total: 100, recent: 10, evolved: 50 };
      mockSettings.get.mockResolvedValue(JSON.stringify(cachedData));

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request('/', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(cachedData);
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    it('queries database when cache misses', async () => {
      mockSettings.get.mockResolvedValue(null);
      mockDb.prepare.mockReturnValue({
        all: async () => ({
          results: [{ total: 200, evolved: 100, last_24h: 20 }],
        }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request('/', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.total).toBe(200);
      expect(data.recent).toBe(20);
      expect(data.evolved).toBe(100);
      expect(executionCtx.waitUntil).toHaveBeenCalled();
    });
  });

  describe('POST /track', () => {
    it('returns 400 for invalid JSON body', async () => {
      const req = new Request('http://localhost/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not valid json',
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request(req, {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Invalid JSON body');
    });

    it('returns 400 when sessionId is missing', async () => {
      const req = new Request('http://localhost/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'click' }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request(req, {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Missing sessionId or action');
    });

    it('returns 400 when action is missing', async () => {
      const req = new Request('http://localhost/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: 'sess-123' }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request(req, {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error).toBe('Missing sessionId or action');
    });

    it('tracks engagement successfully with all fields', async () => {
      const req = new Request('http://localhost/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-abc',
          action: 'click',
          query: 'sunset',
          photoId: 'photo-123',
          timeToClickMs: 1500,
        }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request(req, {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
      expect(mockTelemetry.writeDataPoint).toHaveBeenCalled();
    });

    it('tracks engagement with minimal required fields', async () => {
      const req = new Request('http://localhost/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'sess-minimal',
          action: 'view',
        }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await stats.request(req, {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.ok).toBe(true);
    });
  });
});
