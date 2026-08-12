import { describe, it, expect } from 'vitest';
import { toImageResult, toImageDetail } from '../src/utils/transform';
import { DBImage } from '@lens/shared';

const createMockDBImage = (overrides: Partial<DBImage> = {}): DBImage => ({
  id: 'test-photo-123',
  width: 1920,
  height: 1080,
  color: '#ff5733',
  raw_key: 'raw/test-photo-123.jpg',
  display_key: 'display/test-photo-123.jpg',
  meta_json: JSON.stringify({
    user: {
      name: 'John Doe',
      username: 'johndoe',
      bio: 'Photographer',
      location: 'New York',
      links: { html: 'https://example.com/johndoe' },
      profile_image: { medium: 'https://example.com/avatar.jpg' },
      instagram_username: 'johndoe_ig',
      twitter_username: 'johndoe_tw',
      portfolio_url: 'https://johndoe.com',
      for_hire: true,
      total_photos: 100,
      total_likes: 5000,
      total_collections: 10,
      total_promoted_photos: 5,
    },
    blur_hash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    description: 'A beautiful landscape',
    alt_description: 'Mountain view at sunset',
    created_at: '2024-01-15T10:30:00Z',
    updated_at: '2024-01-16T12:00:00Z',
    promoted_at: '2024-01-17T08:00:00Z',
    alternative_slugs: { en: 'mountain-sunset-view-abc123' },
    exif: {
      make: 'Canon',
      model: 'EOS R5',
      name: 'Canon EOS R5',
      aperture: '2.8',
      exposure_time: '1/250',
      focal_length: '50',
      iso: 400,
    },
    location: {
      name: 'Yosemite National Park',
      city: 'Yosemite Valley',
      country: 'United States',
      position: { latitude: 37.8651, longitude: -119.5383 },
    },
    topic_submissions: { nature: {}, travel: {} },
    views: 10000,
    downloads: 500,
    likes: 250,
    links: { html: 'https://unsplash.com/photos/test' },
  }),
  ai_tags: '["landscape", "mountain", "sunset"]',
  ai_caption: 'A breathtaking mountain landscape bathed in golden sunset light',
  ai_model: 'llama-4-scout',
  ai_quality_score: 8.5,
  entities_json: '["Yosemite", "Half Dome"]',
  created_at: 1705312200000,
  ...overrides,
});

describe('toImageResult', () => {
  it('transforms DBImage to ImageResult with all fields', () => {
    const dbImage = createMockDBImage();
    const result = toImageResult(dbImage, 0.95);

    expect(result.id).toBe('test-photo-123');
    expect(result.url).toBe('/image/display/test-photo-123.jpg');
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);
    expect(result.caption).toBe('A breathtaking mountain landscape bathed in golden sunset light');
    expect(result.tags).toEqual(['landscape', 'mountain', 'sunset']);
    expect(result.score).toBe(0.95);
    expect(result.photographer).toBe('John Doe');
    expect(result.color).toBe('#ff5733');
    expect(result.blurHash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj');
    expect(result.description).toBe('A beautiful landscape');
    expect(result.location).toBe('Yosemite National Park');
    expect(result.topics).toEqual(['nature', 'travel']);
    expect(result.ai_model).toBe('llama-4-scout');
    expect(result.ai_quality_score).toBe(8.5);
    expect(result.entities).toEqual(['Yosemite', 'Half Dome']);
  });

  it('handles missing optional fields gracefully', () => {
    const dbImage = createMockDBImage({
      meta_json: '{}',
      ai_tags: '[]',
      ai_caption: null,
      ai_model: null,
      ai_quality_score: null,
      entities_json: null,
    });

    const result = toImageResult(dbImage);

    expect(result.id).toBe('test-photo-123');
    expect(result.caption).toBeNull();
    expect(result.tags).toEqual([]);
    expect(result.photographer).toBeUndefined();
    expect(result.score).toBeUndefined();
    expect(result.entities).toEqual([]);
  });

  it('handles malformed JSON gracefully', () => {
    const dbImage = createMockDBImage({
      meta_json: '{}',
      ai_tags: '[]',
    });

    const result = toImageResult(dbImage);

    expect(result.tags).toEqual([]);
    expect(result.topics).toEqual([]);
  });
});

describe('toImageDetail', () => {
  it('transforms DBImage to full ImageDetail', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.id).toBe('test-photo-123');
    expect(detail.urls.raw).toBe('/image/display/test-photo-123.jpg');
    expect(detail.urls.display).toBe('/image/display/test-photo-123.jpg');
    expect(detail.width).toBe(1920);
    expect(detail.height).toBe(1080);
    expect(detail.color).toBe('#ff5733');
    expect(detail.blurHash).toBe('LEHV6nWB2yk8pyo0adR*.7kCMdnj');
    expect(detail.description).toBe('A beautiful landscape');
    expect(detail.altDescription).toBe('Mountain view at sunset');
    expect(detail.createdAt).toBe('2024-01-15T10:30:00Z');
    expect(detail.updatedAt).toBe('2024-01-16T12:00:00Z');
    expect(detail.promotedAt).toBe('2024-01-17T08:00:00Z');
  });

  it('parses photographer details correctly', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.photographer.name).toBe('John Doe');
    expect(detail.photographer.username).toBe('johndoe');
    expect(detail.photographer.bio).toBe('Photographer');
    expect(detail.photographer.location).toBe('New York');
    expect(detail.photographer.profile).toBe('https://example.com/johndoe');
    expect(detail.photographer.profileImage).toBe('https://example.com/avatar.jpg');
    expect(detail.photographer.instagram).toBe('johndoe_ig');
    expect(detail.photographer.twitter).toBe('johndoe_tw');
    expect(detail.photographer.portfolio).toBe('https://johndoe.com');
    expect(detail.photographer.forHire).toBe(true);
    expect(detail.photographer.totalPhotos).toBe(100);
  });

  it('parses EXIF data correctly', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.exif).not.toBeNull();
    expect(detail.exif!.make).toBe('Canon');
    expect(detail.exif!.model).toBe('EOS R5');
    expect(detail.exif!.camera).toBe('Canon EOS R5');
    expect(detail.exif!.aperture).toBe('f/2.8');
    expect(detail.exif!.exposure).toBe('1/250');
    expect(detail.exif!.focalLength).toBe('50mm');
    expect(detail.exif!.iso).toBe(400);
  });

  it('parses location data correctly', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.location).not.toBeNull();
    expect(detail.location!.name).toBe('Yosemite National Park');
    expect(detail.location!.city).toBe('Yosemite Valley');
    expect(detail.location!.country).toBe('United States');
    expect(detail.location!.latitude).toBe(37.8651);
    expect(detail.location!.longitude).toBe(-119.5383);
  });

  it('parses AI metadata correctly', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.ai.caption).toBe('A breathtaking mountain landscape bathed in golden sunset light');
    expect(detail.ai.tags).toEqual(['landscape', 'mountain', 'sunset']);
    expect(detail.ai.model).toBe('llama-4-scout');
    expect(detail.ai.qualityScore).toBe(8.5);
    expect(detail.ai.entities).toEqual(['Yosemite', 'Half Dome']);
  });

  it('parses stats correctly', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.stats.views).toBe(10000);
    expect(detail.stats.downloads).toBe(500);
    expect(detail.stats.likes).toBe(250);
  });

  it('parses alternative titles from slugs', () => {
    const dbImage = createMockDBImage();
    const detail = toImageDetail(dbImage);

    expect(detail.alternativeTitles).not.toBeNull();
    expect(detail.alternativeTitles!.en).toBe('mountain sunset view');
  });

  it('handles missing meta gracefully', () => {
    const dbImage = createMockDBImage({
      meta_json: '{}',
      ai_caption: null,
      ai_tags: '[]',
      ai_model: null,
      ai_quality_score: null,
      entities_json: null,
    });

    const detail = toImageDetail(dbImage);

    expect(detail.exif).toBeNull();
    expect(detail.location).toBeNull();
    expect(detail.blurHash).toBeNull();
    expect(detail.description).toBeNull();
    expect(detail.sponsorship).toBeNull();
    expect(detail.ai.caption).toBeNull();
    expect(detail.ai.tags).toEqual([]);
  });

  it('parses sponsorship data when present', () => {
    const dbImage = createMockDBImage({
      meta_json: JSON.stringify({
        user: { name: 'Test' },
        sponsorship: {
          tagline: 'Sponsored by Brand',
          tagline_url: 'https://brand.com',
          sponsor: {
            name: 'Brand Inc',
            profile_image: { medium: 'https://brand.com/logo.jpg' },
            links: { html: 'https://brand.com/profile' },
          },
        },
      }),
    });

    const detail = toImageDetail(dbImage);

    expect(detail.sponsorship).not.toBeNull();
    expect(detail.sponsorship!.name).toBe('Brand Inc');
    expect(detail.sponsorship!.tagline).toBe('Sponsored by Brand');
    expect(detail.sponsorship!.url).toBe('https://brand.com');
    expect(detail.sponsorship!.logo).toBe('https://brand.com/logo.jpg');
  });
});
