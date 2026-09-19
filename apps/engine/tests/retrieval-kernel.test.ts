import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  normalizeSearchSpec,
  encodeCursor,
  decodeCursor,
  hashQuery,
  fuseCandidatesWithRRF,
  calculateDynamicCutoff,
  filterResults,
  applyDiversityPolicy,
  parseVectorId,
  hydrateFromD1,
  FtsCandidateSource,
  VectorCandidateSource,
  SearchService,
  CandidateMatch,
  RETRIEVAL_DEFAULTS,
} from '../src/modules/retrieval';
import { Logger, ImageResult, DBImage, ApiBindings } from '@lens/shared';

describe('Retrieval Kernel (Phase 5)', () => {
  const mockLogger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trackSearch: vi.fn(),
    metric: vi.fn(),
  } as unknown as Logger;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('SearchSpec Normalization', () => {
    it('normalizes string queries with defaults', () => {
      const spec = normalizeSearchSpec('  Mountain Sunset  ');
      expect(spec.query).toBe('Mountain Sunset');
      expect(spec.normalizedQuery).toBe('mountain sunset');
      expect(spec.options.enableSemantic).toBe(true);
      expect(spec.options.limit).toBe(RETRIEVAL_DEFAULTS.DEFAULT_LIMIT);
      expect(spec.options.retrievalVersion).toBe(RETRIEVAL_DEFAULTS.VERSION);
      expect(spec.options.indexGeneration).toBe(RETRIEVAL_DEFAULTS.INDEX_GENERATION);
    });

    it('clamps limit to MAX_LIMIT', () => {
      const spec = normalizeSearchSpec({
        query: 'ocean',
        options: { limit: 500 },
      });
      expect(spec.options.limit).toBe(RETRIEVAL_DEFAULTS.MAX_LIMIT);
    });
  });

  describe('Cursor Pagination Codec', () => {
    it('encodes and decodes valid search cursor', () => {
      const cursor = {
        offset: 20,
        queryHash: hashQuery('mountain sunset'),
        version: 'v2',
      };
      const encoded = encodeCursor(cursor);
      expect(typeof encoded).toBe('string');

      const decoded = decodeCursor(encoded);
      expect(decoded).toEqual(cursor);
    });

    it('returns null for corrupted or malformed cursors', () => {
      expect(decodeCursor('invalid-base-64-content')).toBeNull();
      expect(decodeCursor(btoa(JSON.stringify({ notAnOffset: 1 })))).toBeNull();
    });
  });

  describe('Pure RRF Fusion Policy', () => {
    it('calculates reciprocal rank scores and merges disjoint sources', () => {
      const ftsMatches: CandidateMatch[] = [
        { id: 'img-1', rank: 1, source: 'fts5' },
        { id: 'img-2', rank: 2, source: 'fts5' },
      ];
      const vecMatches: CandidateMatch[] = [
        { id: 'img-2', rank: 1, source: 'vectorize', score: 0.9 },
        { id: 'img-3', rank: 2, source: 'vectorize', score: 0.8 },
      ];

      const k = 60;
      const fused = fuseCandidatesWithRRF(ftsMatches, vecMatches, k);

      // img-2 appeared in both sources: 1/(60+2) + 1/(60+1)
      const expectedImg2Score = 1 / 62 + 1 / 61;
      const expectedImg1Score = 1 / 61;
      const expectedImg3Score = 1 / 62;

      expect(fused[0].id).toBe('img-2');
      expect(fused[0].score).toBeCloseTo(expectedImg2Score, 5);
      expect(fused[0].sources).toEqual(expect.arrayContaining(['fts5', 'vectorize']));

      expect(fused[1].id).toBe('img-1');
      expect(fused[1].score).toBeCloseTo(expectedImg1Score, 5);

      expect(fused[2].id).toBe('img-3');
      expect(fused[2].score).toBeCloseTo(expectedImg3Score, 5);
    });
  });

  describe('Dynamic Cutoff Policy', () => {
    it('cuts off results below relative and absolute floors', () => {
      const candidates = [
        { id: '1', score: 1.0, sources: ['fts5' as const] },
        { id: '2', score: 0.9, sources: ['fts5' as const] },
        { id: '3', score: 0.8, sources: ['fts5' as const] },
        { id: '4', score: 0.1, sources: ['fts5' as const] }, // < 1.0 * 0.15 relative floor
      ];

      const count = calculateDynamicCutoff(candidates);
      expect(count).toBe(3);
    });

    it('cuts off results on cliff drop-off after minProtected', () => {
      const candidates = [
        { id: '1', score: 1.0, sources: ['fts5' as const] },
        { id: '2', score: 0.98, sources: ['fts5' as const] },
        { id: '3', score: 0.95, sources: ['fts5' as const] },
        { id: '4', score: 0.92, sources: ['fts5' as const] },
        { id: '5', score: 0.9, sources: ['fts5' as const] },
        { id: '6', score: 0.5, sources: ['fts5' as const] }, // cliff: 0.50 / 0.90 < 0.65
        { id: '7', score: 0.48, sources: ['fts5' as const] },
      ];

      const count = calculateDynamicCutoff(candidates, { minProtected: 5, ratioCliff: 0.65 });
      expect(count).toBe(5);
    });

    it('returns 0 for empty list', () => {
      expect(calculateDynamicCutoff([])).toBe(0);
    });
  });

  describe('Filter and Diversity Policies', () => {
    const sampleResults: ImageResult[] = [
      {
        id: 'img-1',
        url: '/display/1.jpg',
        width: 1920,
        height: 1080,
        color: '#ff0000',
        photographer: 'Alice',
        caption: 'Sunset',
        tags: ['sunset', 'nature'],
      },
      {
        id: 'img-2',
        url: '/display/2.jpg',
        width: 1080,
        height: 1920,
        color: '#00ff00',
        photographer: 'Alice',
        caption: 'Tree',
        tags: ['forest', 'nature'],
      },
      {
        id: 'img-3',
        url: '/display/3.jpg',
        width: 1080,
        height: 1080,
        color: '#0000ff',
        photographer: 'Alice',
        caption: 'River',
        tags: ['water'],
      },
      {
        id: 'img-4',
        url: '/display/4.jpg',
        width: 1200,
        height: 800,
        color: '#ff0000',
        photographer: 'Bob',
        caption: 'City',
        tags: ['urban'],
      },
    ];

    it('filters by orientation and color', () => {
      const landscape = filterResults(sampleResults, { orientation: 'landscape' });
      expect(landscape.map((r) => r.id)).toEqual(['img-1', 'img-4']);

      const red = filterResults(sampleResults, { color: '#ff' });
      expect(red.map((r) => r.id)).toEqual(['img-1', 'img-4']);

      const tagFiltered = filterResults(sampleResults, { tag: 'water' });
      expect(tagFiltered.map((r) => r.id)).toEqual(['img-3']);
    });

    it('limits consecutive author items via diversity policy', () => {
      // Alice has 3 consecutive items. With maxConsecutive=2, img-3 should be deferred
      const diversified = applyDiversityPolicy(sampleResults, 2);
      expect(diversified[0].id).toBe('img-1');
      expect(diversified[1].id).toBe('img-2');
      expect(diversified[2].id).toBe('img-4'); // Bob brought forward
      expect(diversified[3].id).toBe('img-3'); // Alice deferred to tail
    });
  });

  describe('Vector Candidate Source & Versioned IDs', () => {
    it('parses versioned vector IDs correctly', () => {
      const parsed = parseVectorId('asset:ast-123:repr:v2:embed:bge-v1:gen:gen-2026-01');
      expect(parsed.assetId).toBe('ast-123');
      expect(parsed.indexGeneration).toBe('gen-2026-01');

      const plain = parseVectorId('legacy-photo-456');
      expect(plain.assetId).toBe('legacy-photo-456');
      expect(plain.indexGeneration).toBeUndefined();
    });

    it('gracefully degrades to empty results when Vectorize or AI throws', async () => {
      const mockAi = {
        run: vi.fn().mockRejectedValue(new Error('Workers AI rate limit or timeout')),
      };
      const mockVectorize = {
        query: vi.fn(),
      };
      const mockSettings = {
        get: vi.fn().mockResolvedValue(null),
        put: vi.fn().mockResolvedValue(undefined),
      };

      const source = new VectorCandidateSource(
        mockAi as unknown as Ai,
        mockVectorize as unknown as VectorizeIndex,
        mockSettings as unknown as KVNamespace,
        mockLogger,
      );

      const spec = normalizeSearchSpec('a fast test query');
      const results = await source.recall(spec);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('FTS Candidate Source', () => {
    it('gracefully degrades to empty results when FTS5 query throws', async () => {
      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockRejectedValue(new Error('FTS5 syntax error: MATCH wildcard')),
          }),
        }),
      };

      const source = new FtsCandidateSource(mockDb as unknown as D1Database, mockLogger);
      const spec = normalizeSearchSpec('wildcard* syntax');
      const results = await source.recall(spec);

      expect(results).toEqual([]);
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  describe('D1 Active Version Hydration', () => {
    it('drops candidates missing from D1 (active version gate) and preserves rank order', async () => {
      const mockRows: DBImage[] = [
        {
          id: 'cand-2',
          width: 800,
          height: 600,
          color: '#000',
          raw_key: 'raw/2.jpg',
          display_key: 'display/2.jpg',
          ai_caption: 'Photo 2',
          ai_tags: '[]',
          ai_model: 'v1',
          ai_quality_score: 8,
          entities_json: '[]',
          meta_json: '{}',
          created_at: 1000,
        },
        {
          id: 'cand-1',
          width: 1000,
          height: 800,
          color: '#fff',
          raw_key: 'raw/1.jpg',
          display_key: 'display/1.jpg',
          ai_caption: 'Photo 1',
          ai_tags: '[]',
          ai_model: 'v1',
          ai_quality_score: 9,
          entities_json: '[]',
          meta_json: '{}',
          created_at: 1000,
        },
      ];

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockRows }),
          }),
        }),
      };

      // cand-1 is rank 1, cand-missing is rank 2 (not in DB), cand-2 is rank 3
      const candidateIds = ['cand-1', 'cand-missing', 'cand-2'];
      const scores = new Map([
        ['cand-1', 0.95],
        ['cand-missing', 0.85],
        ['cand-2', 0.75],
      ]);

      const hydrated = await hydrateFromD1(mockDb as unknown as D1Database, candidateIds, scores);

      // Must strictly preserve candidate ordering: cand-1 first, cand-2 second; cand-missing dropped
      expect(hydrated).toHaveLength(2);
      expect(hydrated[0].id).toBe('cand-1');
      expect(hydrated[0].score).toBe(0.95);
      expect(hydrated[1].id).toBe('cand-2');
      expect(hydrated[1].score).toBe(0.75);
    });
  });

  describe('SearchService Cursor Pagination Flow', () => {
    it('produces nextCursor when results exceed limit and allows resuming', async () => {
      const mockAi = {
        run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }),
      };
      const mockVectorize = {
        query: vi.fn().mockResolvedValue({
          matches: [
            { id: 'p1', score: 0.99 },
            { id: 'p2', score: 0.98 },
            { id: 'p3', score: 0.97 },
          ],
        }),
      };

      const mockDbRows: DBImage[] = ['p1', 'p2', 'p3'].map((id) => ({
        id,
        width: 800,
        height: 600,
        color: '#fff',
        raw_key: `raw/${id}.jpg`,
        display_key: `display/${id}.jpg`,
        ai_caption: `Photo ${id}`,
        ai_tags: '[]',
        ai_model: 'v1',
        ai_quality_score: 9,
        entities_json: '[]',
        meta_json: '{}',
        created_at: 1000,
      }));

      const mockDb = {
        prepare: vi.fn().mockReturnValue({
          bind: vi.fn().mockReturnValue({
            all: vi.fn().mockResolvedValue({ results: mockDbRows }),
          }),
        }),
      };

      const mockSettings = {
        get: vi.fn().mockResolvedValue('clean english query'),
        put: vi.fn().mockResolvedValue(undefined),
      };

      const env = {
        AI: mockAi,
        VECTORIZE: mockVectorize,
        DB: mockDb,
        SETTINGS: mockSettings,
      } as unknown as ApiBindings;

      const service = new SearchService(env, mockLogger);

      // Request page 1 with limit = 2
      const page1 = await service.search({
        query: 'clean english query',
        options: { limit: 2 },
      });

      expect(page1.results).toHaveLength(2);
      expect(page1.results.map((r) => r.id)).toEqual(['p1', 'p2']);
      expect(page1.nextCursor).toBeDefined();

      // Resume page 2 with cursor
      const page2 = await service.search({
        query: 'clean english query',
        cursor: page1.nextCursor,
        options: { limit: 2 },
      });

      expect(page2.results).toHaveLength(1);
      expect(page2.results[0].id).toBe('p3');
      expect(page2.nextCursor).toBeUndefined(); // no more results
    });
  });
});
