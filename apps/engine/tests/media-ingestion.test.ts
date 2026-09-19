import { describe, it, expect, vi, beforeEach } from 'vitest';
import { toDiscoveredAssetFromUnsplash } from '../src/modules/ingestion';
import { streamMasterToR2, MAX_MEDIA_BYTES } from '../src/platform/cloudflare';
import { UnsplashPhoto, Logger, createTrace } from '@lens/shared';

describe('Media Ingestion & Storage (Phase 2)', () => {
  describe('Provider Anti-Corruption Layer (Unsplash Adapter)', () => {
    it('normalizes raw Unsplash JSON into internal DiscoveredAsset contract', () => {
      const mockUnsplash: UnsplashPhoto = {
        id: 'photo-xyz',
        created_at: '2026-01-01T00:00:00Z',
        promoted_at: null,
        width: 3840,
        height: 2160,
        color: '#1a1a1a',
        description: 'Alpine sunrise',
        alt_description: 'Mountains at sunrise',
        urls: {
          raw: 'https://images.unsplash.com/raw-photo-xyz',
          full: 'https://images.unsplash.com/full-photo-xyz',
          regular: 'https://images.unsplash.com/regular-photo-xyz',
          small: 'https://images.unsplash.com/small-photo-xyz',
          thumb: 'https://images.unsplash.com/thumb-photo-xyz',
        },
        links: {
          self: 'https://api.unsplash.com/photos/photo-xyz',
          html: 'https://unsplash.com/photos/photo-xyz',
          download: 'https://unsplash.com/photos/photo-xyz/download',
          download_location: 'https://api.unsplash.com/photos/photo-xyz/download',
        },
        user: {
          id: 'user-001',
          username: 'photographer_jane',
          name: 'Jane Doe',
          portfolio_url: 'https://janedoe.photo',
        },
      };

      const asset = toDiscoveredAssetFromUnsplash(mockUnsplash);

      expect(asset.source.provider).toBe('unsplash');
      expect(asset.source.externalId).toBe('photo-xyz');
      expect(asset.source.canonicalUrl).toBe('https://unsplash.com/photos/photo-xyz');

      expect(asset.media.downloadUrl).toBe('https://images.unsplash.com/raw-photo-xyz');
      expect(asset.media.width).toBe(3840);
      expect(asset.media.height).toBe(2160);
      expect(asset.media.mimeType).toBe('image/jpeg');

      expect(asset.attribution.authorName).toBe('Jane Doe');
      expect(asset.attribution.authorUrl).toBe('https://janedoe.photo');
      expect(asset.attribution.license).toBe('Unsplash License');
      expect(asset.attribution.retentionPolicy).toBe('standard');

      expect(asset.rawRef).toContain('Alpine sunrise');
      expect(new Date(asset.observedAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe('Canonical Master Streaming Writer', () => {
    let mockStore: Map<string, { body: Uint8Array; metadata?: Record<string, unknown> }>;
    let mockBucket: R2Bucket;
    let logger: Logger;

    beforeEach(() => {
      mockStore = new Map();
      logger = new Logger(createTrace('TEST'));

      mockBucket = {
        async put(key: string, value: ReadableStream | ArrayBuffer | string, options?: R2PutOptions) {
          let bytes: Uint8Array;
          if (value instanceof ReadableStream) {
            const res = new Response(value);
            bytes = new Uint8Array(await res.arrayBuffer());
          } else if (typeof value === 'string') {
            bytes = new TextEncoder().encode(value);
          } else {
            bytes = new Uint8Array(value);
          }
          mockStore.set(key, { body: bytes, metadata: options as Record<string, unknown> });
          return {} as R2Object;
        },
        async get(key: string) {
          const item = mockStore.get(key);
          if (!item) return null;
          return {
            body: new Response(item.body).body,
            arrayBuffer: async () =>
              item.body.buffer.slice(item.body.byteOffset, item.body.byteOffset + item.body.byteLength),
            size: item.body.length,
          } as unknown as R2ObjectBody;
        },
        async head(key: string) {
          const item = mockStore.get(key);
          if (!item) return null;
          return { size: item.body.length } as unknown as R2Object;
        },
        async delete(key: string) {
          mockStore.delete(key);
        },
      } as unknown as R2Bucket;
    });

    it('streams media, calculates content-addressed SHA-256, and stores master', async () => {
      const sampleText = 'hello world lens image stream test';
      const sampleBytes = new TextEncoder().encode(sampleText);

      // Mock global fetch
      const mockFetch = vi.fn().mockImplementation(
        () =>
          new Response(sampleBytes, {
            status: 200,
            headers: { 'content-type': 'image/jpeg' },
          }),
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await streamMasterToR2('https://example.com/test.jpg', mockBucket, logger);

      // Verified SHA-256 for sampleText
      expect(result.contentHash).toBeDefined();
      expect(result.contentHash.length).toBe(64);
      expect(result.masterKey).toBe(`media/${result.contentHash}/master.jpg`);
      expect(result.byteSize).toBe(sampleBytes.length);
      expect(result.isNewUpload).toBe(true);

      // Verify master exists in R2 store and staging is cleaned up
      expect(mockStore.has(result.masterKey)).toBe(true);
      for (const k of mockStore.keys()) {
        expect(k.startsWith('staging/')).toBe(false);
      }

      // Test deduplication on subsequent upload of same content
      const secondResult = await streamMasterToR2('https://example.com/test.jpg', mockBucket, logger);
      expect(secondResult.isNewUpload).toBe(false);
      expect(secondResult.contentHash).toBe(result.contentHash);

      vi.unstubAllGlobals();
    });

    it('throws ExternalServiceError when external fetch fails', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Not Found', { status: 404 })));

      await expect(streamMasterToR2('https://example.com/missing.jpg', mockBucket, logger)).rejects.toThrow(
        /External service MediaDownloader failed/,
      );

      vi.unstubAllGlobals();
    });

    it('throws ValidationError when stream size exceeds limit', async () => {
      const oversizedChunk = new Uint8Array(1024 * 1024); // 1MB
      let emitted = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (emitted <= MAX_MEDIA_BYTES + 1024) {
            controller.enqueue(oversizedChunk);
            emitted += oversizedChunk.byteLength;
          } else {
            controller.close();
          }
        },
      });

      vi.stubGlobal(
        'fetch',
        vi.fn().mockImplementation(() => new Response(stream, { status: 200 })),
      );

      await expect(streamMasterToR2('https://example.com/oversized.jpg', mockBucket, logger)).rejects.toThrow(
        /Media size exceeded maximum limit/,
      );

      vi.unstubAllGlobals();
    });
  });
});
