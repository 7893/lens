import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import images from '../src/routes/images';
import { ApiBindings, DBImage } from '@lens/shared';

describe('Images API Route', () => {
  const mockDb = { prepare: vi.fn() };
  const mockSettings = { get: vi.fn(), put: vi.fn(), list: vi.fn(), delete: vi.fn() };
  const mockR2 = { get: vi.fn() };

  const env = {
    DB: mockDb,
    SETTINGS: mockSettings,
    R2: mockR2,
  } as unknown as ApiBindings;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (globalThis as unknown as Record<string, unknown>).caches;
  });

  describe('GET /latest', () => {
    it('returns cached latest images when available', async () => {
      const cachedData = { results: [{ id: 'cached-1' }], total: 1 };
      mockSettings.get.mockResolvedValue(JSON.stringify(cachedData));

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/latest', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(cachedData);
      expect(mockDb.prepare).not.toHaveBeenCalled();
    });

    it('queries database when cache misses', async () => {
      mockSettings.get.mockResolvedValue(null);
      mockDb.prepare.mockReturnValue({
        all: async () => ({
          results: [
            {
              id: 'photo-1',
              width: 800,
              height: 600,
              color: '#fff',
              meta_json: '{"user":{"name":"Test"}}',
              ai_tags: '["tag1"]',
              ai_caption: 'Test caption',
            },
          ],
        }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/latest', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.results).toHaveLength(1);
      expect(data.results[0].id).toBe('photo-1');
      expect(executionCtx.waitUntil).toHaveBeenCalled();
    });
  });

  describe('GET /:id', () => {
    const mockDBImage: DBImage = {
      id: 'detail-photo',
      width: 1920,
      height: 1080,
      color: '#123456',
      raw_key: 'raw/detail-photo.jpg',
      display_key: 'display/detail-photo.jpg',
      meta_json: JSON.stringify({
        user: { name: 'Photographer', username: 'photo_user' },
        description: 'A test image',
      }),
      ai_tags: '["test", "image"]',
      ai_caption: 'A test image description',
      ai_model: 'llama-4-scout',
      ai_quality_score: 8.0,
      entities_json: '["entity1"]',
      created_at: Date.now(),
    };

    it('returns cached image detail when available', async () => {
      const cachedDetail = { id: 'cached-detail', width: 800 };
      mockSettings.get.mockResolvedValue(JSON.stringify(cachedDetail));

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/detail-photo', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual(cachedDetail);
    });

    it('returns 404 when image not found', async () => {
      mockSettings.get.mockResolvedValue(null);
      mockDb.prepare.mockReturnValue({
        bind: () => ({
          first: async () => null,
        }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/nonexistent', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(404);
      const data = await res.json();
      expect(data.error).toBe('Image not found');
    });

    it('returns image detail from database', async () => {
      mockSettings.get.mockResolvedValue(null);
      mockDb.prepare.mockReturnValue({
        bind: () => ({
          first: async () => mockDBImage,
        }),
      });

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/detail-photo', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.id).toBe('detail-photo');
      expect(data.width).toBe(1920);
      expect(executionCtx.waitUntil).toHaveBeenCalled();
    });
  });

  describe('GET /:type/:filename (Image Proxy)', () => {
    beforeEach(() => {
      const mockCache = {
        match: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };
      globalThis.caches = { default: mockCache } as unknown as CacheStorage;
    });

    it('returns 400 for invalid asset type', async () => {
      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/raw/photo.jpg', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toBe('Invalid asset type');
    });

    it('returns 400 for invalid filename with path traversal', async () => {
      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request(
        '/display/..%2Fetc%2Fpasswd.jpg',
        {},
        env,
        executionCtx as unknown as ExecutionContext,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toBe('Invalid filename');
    });

    it('returns 400 for filename without .jpg extension', async () => {
      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/display/photo.png', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toBe('Invalid filename');
    });

    it('returns 400 for filename with special characters', async () => {
      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request(
        '/display/photo<script>.jpg',
        {},
        env,
        executionCtx as unknown as ExecutionContext,
      );

      expect(res.status).toBe(400);
      const text = await res.text();
      expect(text).toBe('Invalid filename');
    });

    it('returns 404 when R2 object not found', async () => {
      mockR2.get.mockResolvedValue(null);

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/display/photo123.jpg', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toBe('Asset not found');
    });

    it('returns image from R2 with correct headers', async () => {
      const mockBody = new ReadableStream();
      const mockR2Object = {
        body: mockBody,
        httpEtag: '"abc123"',
        writeHttpMetadata: vi.fn((headers: Headers) => {
          headers.set('content-type', 'image/jpeg');
        }),
      };
      mockR2.get.mockResolvedValue(mockR2Object);

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request(
        '/display/valid-photo.jpg',
        {},
        env,
        executionCtx as unknown as ExecutionContext,
      );

      expect(res.status).toBe(200);
      expect(res.headers.get('etag')).toBe('"abc123"');
      expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect(mockR2.get).toHaveBeenCalledWith('display/valid-photo.jpg');
    });

    it('returns cached response on cache hit', async () => {
      const cachedResponse = new Response('cached image data', {
        headers: { 'content-type': 'image/jpeg' },
      });
      const mockCache = {
        match: vi.fn().mockResolvedValue(cachedResponse),
        put: vi.fn(),
      };
      globalThis.caches = { default: mockCache } as unknown as CacheStorage;

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request('/display/cached.jpg', {}, env, executionCtx as unknown as ExecutionContext);

      expect(res.status).toBe(200);
      expect(mockR2.get).not.toHaveBeenCalled();
    });

    it('accepts valid filenames with alphanumeric, dash, and underscore', async () => {
      mockR2.get.mockResolvedValue(null);

      const executionCtx = { waitUntil: vi.fn() };
      const res = await images.request(
        '/display/valid_photo-123.jpg',
        {},
        env,
        executionCtx as unknown as ExecutionContext,
      );

      // Should pass validation and return 404 (not found in R2)
      expect(res.status).toBe(404);
      expect(mockR2.get).toHaveBeenCalledWith('display/valid_photo-123.jpg');
    });
  });
});
