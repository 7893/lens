import { DBImage, ImageResult, ImageDetail } from '@lens/shared';

/**
 * Transforms a D1 row into a standard ImageResult (for search listings).
 */
export function toImageResult(img: DBImage, score?: number): ImageResult {
  const meta = JSON.parse(img.meta_json || '{}');
  const user = meta.user || {};

  return {
    id: img.id,
    url: `/image/display/${img.id}.jpg`,
    width: img.width,
    height: img.height,
    caption: img.ai_caption,
    tags: JSON.parse(img.ai_tags || '[]'),
    score: score,
    photographer: user.name,
    color: img.color,
    blurHash: meta.blur_hash,
    description: meta.description || meta.alt_description,
    location: meta.location?.name,
    topics: Object.keys(meta.topic_submissions || {}),
    ai_model: img.ai_model,
    ai_quality_score: img.ai_quality_score,
    entities: img.entities_json ? JSON.parse(img.entities_json) : [],
  };
}

/**
 * Transforms a D1 row into a flagship ImageDetail (for modal details).
 * Includes deep parsing of Unsplash metadata.
 */
export function toImageDetail(img: DBImage): ImageDetail {
  const meta = JSON.parse(img.meta_json || '{}');
  const user = meta.user || {};
  const sponsor = meta.sponsorship?.sponsor;

  return {
    id: img.id,
    urls: {
      raw: `/image/display/${img.id}.jpg`,
      display: `/image/display/${img.id}.jpg`,
    },
    width: img.width,
    height: img.height,
    color: img.color,
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
      caption: img.ai_caption,
      tags: JSON.parse(img.ai_tags || '[]'),
      model: img.ai_model,
      qualityScore: img.ai_quality_score,
      entities: img.entities_json ? JSON.parse(img.entities_json) : [],
    },
    source: meta.links?.html || null,
  };
}
