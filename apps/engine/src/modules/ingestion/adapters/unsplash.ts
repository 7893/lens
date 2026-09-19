import { UnsplashPhoto } from '@lens/shared';
import { DiscoveredAsset } from '../contracts';

/**
 * Maps external Unsplash JSON to internal canonical DiscoveredAsset contract.
 */
export function toDiscoveredAssetFromUnsplash(photo: UnsplashPhoto): DiscoveredAsset {
  return {
    source: {
      provider: 'unsplash',
      externalId: photo.id,
      canonicalUrl: photo.links?.html,
    },
    media: {
      downloadUrl: photo.urls?.raw || photo.urls?.full || photo.urls?.regular,
      width: photo.width,
      height: photo.height,
      mimeType: 'image/jpeg',
    },
    attribution: {
      authorName: photo.user?.name || photo.user?.username,
      authorUrl:
        photo.user?.portfolio_url ||
        (photo.user?.username ? `https://unsplash.com/@${photo.user.username}` : undefined),
      license: 'Unsplash License',
      retentionPolicy: 'standard',
    },
    observedAt: new Date().toISOString(),
    rawRef: JSON.stringify({
      color: photo.color,
      description: photo.description,
      alt_description: photo.alt_description,
      exif: photo.exif,
    }),
  };
}
