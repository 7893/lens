import { DBImage, ImageResult } from '@lens/shared';

export function toImageResult(img: DBImage, score?: number): ImageResult {
  const meta = JSON.parse(img.meta_json || '{}');
  return {
    id: img.id,
    url: `/image/display/${img.id}.jpg`,
    width: img.width,
    height: img.height,
    caption: img.ai_caption,
    tags: JSON.parse(img.ai_tags || '[]'),
    score,
    photographer: meta.user?.name,
    blurHash: meta.blur_hash,
    color: img.color,
    location: meta.location?.name || null,
    description: meta.alt_description || meta.description || null,
    ai_model: img.ai_model,
    ai_quality_score: img.ai_quality_score,
    entities: img.entities_json ? JSON.parse(img.entities_json) : [],
    exif: meta.exif
      ? {
          camera: meta.exif.name || null,
          aperture: meta.exif.aperture ? `f/${meta.exif.aperture}` : null,
          exposure: meta.exif.exposure_time ? `${meta.exif.exposure_time}s` : null,
          focalLength: meta.exif.focal_length ? `${meta.exif.focal_length}mm` : null,
          iso: meta.exif.iso || null,
        }
      : null,
    topics: Object.keys(meta.topic_submissions || {}),
  };
}
