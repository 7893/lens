import { describe, it, expect } from 'vitest';
import { safeJsonParse } from '../src/utils/safe-json';
import { ImageEntity } from '../src/models/ImageEntity';
import { SearchRankingPolicy } from '../src/models/SearchRankingPolicy';
import { DBImage } from '../src/types';

describe('safeJsonParse', () => {
  it('parses valid JSON string', () => {
    expect(safeJsonParse('{"a":1}', {})).toEqual({ a: 1 });
    expect(safeJsonParse('[1,2,3]', [])).toEqual([1, 2, 3]);
  });

  it('returns fallback on invalid JSON', () => {
    expect(safeJsonParse('not a json', { default: true })).toEqual({ default: true });
    expect(safeJsonParse('{unclosed', [])).toEqual([]);
  });

  it('returns fallback on null or undefined or empty', () => {
    expect(safeJsonParse(null, 'fallback')).toBe('fallback');
    expect(safeJsonParse(undefined, 42)).toBe(42);
    expect(safeJsonParse('', 'empty')).toBe('empty');
  });
});

describe('ImageEntity', () => {
  const mockDBImage: DBImage = {
    id: 'img-100',
    width: 3840,
    height: 2160,
    color: '#1a1a2e',
    raw_key: 'raw/img-100.jpg',
    display_key: 'display/img-100.jpg',
    meta_json: JSON.stringify({
      user: { name: 'Alice Photographer' },
      blur_hash: 'L6PZfSi_.AyE_3t7t7R**0o#DgR4',
      description: 'Tokyo at dusk',
    }),
    ai_tags: '["tokyo", "dusk", "neon"]',
    ai_caption: 'A vibrant neon street in Shinjuku during twilight',
    ai_model: 'llama-4-scout',
    ai_quality_score: 9.2,
    entities_json: '["Shinjuku", "Tokyo Tower"]',
    created_at: 1700000000000,
  };

  it('computes aspect ratio and orientation correctly', () => {
    const landscape = new ImageEntity(mockDBImage);
    expect(landscape.aspectRatio).toBeCloseTo(16 / 9, 2);
    expect(landscape.orientation).toBe('landscape');

    const portrait = new ImageEntity({ ...mockDBImage, width: 1080, height: 1920 });
    expect(portrait.orientation).toBe('portrait');

    const square = new ImageEntity({ ...mockDBImage, width: 1000, height: 1000 });
    expect(square.orientation).toBe('square');
  });

  it('evaluates quality tiers accurately', () => {
    const high = new ImageEntity({ ...mockDBImage, ai_quality_score: 8.5 });
    expect(high.qualityTier).toBe('flagship');

    const std = new ImageEntity({ ...mockDBImage, ai_quality_score: 7.2 });
    expect(std.qualityTier).toBe('standard');

    const unrated = new ImageEntity({ ...mockDBImage, ai_quality_score: null });
    expect(unrated.qualityTier).toBe('unrated');
  });

  it('detects outdated model versions', () => {
    const entity = new ImageEntity(mockDBImage);
    expect(entity.isOutdated('llama-4-scout')).toBe(false);
    expect(entity.isOutdated('llama-5-pro')).toBe(true);
  });

  it('safely handles corrupted JSON strings without throwing', () => {
    const corrupted: DBImage = {
      ...mockDBImage,
      meta_json: 'CORRUPTED_JSON{',
      ai_tags: '[INVALID_ARRAY',
      entities_json: '{"bad": json',
    };

    const entity = new ImageEntity(corrupted);
    expect(entity.meta).toEqual({});
    expect(entity.tags).toEqual([]);
    expect(entity.entities).toEqual([]);

    // Projections should also succeed without crash
    const result = entity.toImageResult(0.85);
    expect(result.id).toBe('img-100');
    expect(result.tags).toEqual([]);
    expect(result.entities).toEqual([]);
  });

  it('correctly projects to ImageResult and ImageDetail', () => {
    const entity = ImageEntity.fromDBImage(mockDBImage);
    const result = entity.toImageResult(0.99);

    expect(result.id).toBe('img-100');
    expect(result.url).toBe('/image/display/img-100.jpg');
    expect(result.photographer).toBe('Alice Photographer');
    expect(result.score).toBe(0.99);

    const detail = entity.toImageDetail();
    expect(detail.id).toBe('img-100');
    expect(detail.photographer.name).toBe('Alice Photographer');
    expect(detail.ai.qualityScore).toBe(9.2);
  });
});

describe('SearchRankingPolicy', () => {
  it('merges FTS and Vector results with reciprocal rank fusion', () => {
    const fts = [{ id: 'doc-1' }, { id: 'doc-2' }];
    const vec = [
      { id: 'doc-2', score: 0.9 },
      { id: 'doc-3', score: 0.8 },
    ];

    const ranked = SearchRankingPolicy.calculateRRF(fts, vec, 60);

    expect(ranked.length).toBe(3);
    // doc-2 appears in both, should have highest fused score
    expect(ranked[0].id).toBe('doc-2');
    expect(ranked[0].score).toBeCloseTo(1 / 62 + 1 / 61, 5);
  });

  it('returns empty array when both candidate lists are empty', () => {
    expect(SearchRankingPolicy.calculateRRF([], [])).toEqual([]);
  });

  it('detects dynamic cliff and truncates trailing results', () => {
    const candidates = [
      { id: '1', score: 1.0 },
      { id: '2', score: 0.95 },
      { id: '3', score: 0.9 },
      { id: '4', score: 0.88 },
      { id: '5', score: 0.85 },
      { id: '6', score: 0.8 },
      { id: '7', score: 0.3 }, // Cliff drop: 0.3 / 0.8 = 0.375 < 0.65
      { id: '8', score: 0.2 },
    ];

    const cutoff = SearchRankingPolicy.calculateDynamicCutoff(candidates);
    expect(cutoff).toBe(6); // cuts off before index 6 (candidate '7')
  });

  it('preserves at least minimum protected results even if ratio drops early', () => {
    const candidates = [
      { id: '1', score: 1.0 },
      { id: '2', score: 0.2 }, // early drop
      { id: '3', score: 0.18 },
      { id: '4', score: 0.17 },
      { id: '5', score: 0.16 },
    ];

    // Minimum 5 protected results
    const cutoff = SearchRankingPolicy.calculateDynamicCutoff(candidates);
    expect(cutoff).toBe(5);
  });

  it('enforces absolute floor cutoff', () => {
    const candidates = [
      { id: '1', score: 0.05 },
      { id: '2', score: 0.003 }, // below ABSOLUTE_FLOOR (0.005)
    ];

    const cutoff = SearchRankingPolicy.calculateDynamicCutoff(candidates);
    expect(cutoff).toBe(1);
  });
});
