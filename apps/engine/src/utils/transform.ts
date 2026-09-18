import { DBImage, ImageResult, ImageDetail, ImageEntity } from '@lens/shared';

/**
 * Transforms a D1 row into a standard ImageResult (for search listings).
 * Delegates to the rich ImageEntity domain model for safe parsing and projection.
 */
export function toImageResult(img: DBImage, score?: number): ImageResult {
  return ImageEntity.fromDBImage(img).toImageResult(score);
}

/**
 * Transforms a D1 row into an ImageDetail (for modal details).
 * Delegates to the rich ImageEntity domain model for safe parsing and projection.
 */
export function toImageDetail(img: DBImage): ImageDetail {
  return ImageEntity.fromDBImage(img).toImageDetail();
}
