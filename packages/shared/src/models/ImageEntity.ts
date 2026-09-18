/* eslint-disable @typescript-eslint/no-explicit-any */
import { DBImage, ImageResult, ImageDetail } from '../types';
import { safeJsonParse } from '../utils/safe-json';

/**
 * ImageEntity - Enriched Domain Model (充血领域模型)
 * Encapsulates image state, validation, parsing, computed attributes, and projection behaviors.
 */
export class ImageEntity {
  public readonly id: string;
  public readonly width: number;
  public readonly height: number;
  public readonly color: string | null;
  public readonly rawKey: string;
  public readonly displayKey: string;
  public readonly aiCaption: string | null;
  public readonly aiModel: string | null;
  public readonly aiQualityScore: number | null;
  public readonly createdAt: number;

  // Enriched, safe-parsed domain properties
  public readonly meta: Record<string, any>;
  public readonly tags: string[];
  public readonly entities: string[];

  constructor(raw: DBImage) {
    this.id = raw.id;
    this.width = raw.width;
    this.height = raw.height;
    this.color = raw.color;
    this.rawKey = raw.raw_key;
    this.displayKey = raw.display_key;
    this.aiCaption = raw.ai_caption;
    this.aiModel = raw.ai_model;
    this.aiQualityScore = raw.ai_quality_score;
    this.createdAt = raw.created_at;

    this.meta = safeJsonParse<Record<string, any>>(raw.meta_json, {});
    this.tags = safeJsonParse<string[]>(raw.ai_tags, []);
    this.entities = safeJsonParse<string[]>(raw.entities_json, []);
  }

  public static fromDBImage(raw: DBImage): ImageEntity {
    return new ImageEntity(raw);
  }

  /**
   * Aspect ratio calculation with division-by-zero protection.
   */
  get aspectRatio(): number {
    return this.height > 0 ? this.width / this.height : 1.0;
  }

  /**
   * Visual orientation of the image.
   */
  get orientation(): 'landscape' | 'portrait' | 'square' {
    const ar = this.aspectRatio;
    if (ar > 1.05) return 'landscape';
    if (ar < 0.95) return 'portrait';
    return 'square';
  }

  /**
   * Edge proxy URL for the display asset.
   */
  get displayUrl(): string {
    return `/image/display/${this.id}.jpg`;
  }

  /**
   * Quality evaluation tier based on ai_quality_score.
   */
  get qualityTier(): 'flagship' | 'standard' | 'unrated' {
    if (this.aiQualityScore === null || this.aiQualityScore === undefined) return 'unrated';
    return this.aiQualityScore >= 8.0 ? 'flagship' : 'standard';
  }

  /**
   * Photographer name safely extracted from metadata.
   */
  get photographerName(): string | undefined {
    return this.meta.user?.name;
  }

  /**
   * Checks if the image was processed by an older AI model version.
   */
  isOutdated(targetModel: string): boolean {
    return !this.aiModel || this.aiModel !== targetModel;
  }

  /**
   * Projects domain entity to an API ImageResult for search/gallery listings.
   */
  toImageResult(score?: number): ImageResult {
    const user = this.meta.user || {};

    return {
      id: this.id,
      url: this.displayUrl,
      width: this.width,
      height: this.height,
      caption: this.aiCaption,
      tags: this.tags,
      score,
      photographer: user.name,
      color: this.color,
      blurHash: this.meta.blur_hash,
      description: this.meta.description || this.meta.alt_description,
      location: this.meta.location?.name,
      topics: Object.keys(this.meta.topic_submissions || {}),
      ai_model: this.aiModel,
      ai_quality_score: this.aiQualityScore,
      entities: this.entities,
    };
  }

  /**
   * Projects domain entity to a full ImageDetail for detailed view modal.
   */
  toImageDetail(): ImageDetail {
    const meta = this.meta;
    const user = meta.user || {};
    const sponsor = meta.sponsorship?.sponsor;

    return {
      id: this.id,
      urls: {
        raw: this.displayUrl,
        display: this.displayUrl,
      },
      width: this.width,
      height: this.height,
      color: this.color,
      blurHash: meta.blur_hash || null,
      description: meta.description || null,
      altDescription: meta.alt_description || null,
      createdAt: meta.created_at || null,
      updatedAt: meta.updated_at || null,
      promotedAt: meta.promoted_at || null,
      alternativeTitles: meta.alternative_slugs
        ? Object.fromEntries(
            Object.entries(meta.alternative_slugs as Record<string, string>).map(([lang, slug]) => [
              lang,
              slug.split('-').slice(0, -1).join(' '),
            ]),
          )
        : null,
      sponsorship: sponsor
        ? {
            name: sponsor.name,
            tagline: meta.sponsorship.tagline,
            url: meta.sponsorship.tagline_url || meta.sponsorship.sponsor?.links?.html,
            logo: sponsor.profile_image?.medium,
            profile: sponsor.links?.html,
          }
        : null,
      photographer: {
        name: user.name || null,
        username: user.username || null,
        bio: user.bio || null,
        location: user.location || null,
        profile: user.links?.html || null,
        profileImage: user.profile_image?.medium || null,
        instagram: user.instagram_username || null,
        twitter: user.twitter_username || null,
        portfolio: user.portfolio_url || null,
        forHire: user.for_hire || false,
        totalPhotos: user.total_photos || null,
        totalLikes: user.total_likes || null,
        totalCollections: user.total_collections || null,
        totalPromotedPhotos: user.total_promoted_photos || null,
      },
      exif: meta.exif
        ? {
            make: meta.exif.make || null,
            model: meta.exif.model || null,
            camera: meta.exif.name || null,
            aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
            exposure: meta.exif.exposure_time || null,
            focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
            iso: meta.exif.iso || null,
          }
        : null,
      location: meta.location
        ? {
            name: meta.location.name || null,
            city: meta.location.city || null,
            country: meta.location.country || null,
            latitude: meta.location.position?.latitude || null,
            longitude: meta.location.position?.longitude || null,
          }
        : null,
      topics: Object.keys(meta.topic_submissions || {}),
      stats: {
        views: meta.views || null,
        downloads: meta.downloads || null,
        likes: meta.likes || null,
      },
      ai: {
        caption: this.aiCaption,
        tags: this.tags,
        model: this.aiModel,
        qualityScore: this.aiQualityScore,
        entities: this.entities,
      },
      source: meta.links?.html || null,
    };
  }
}
