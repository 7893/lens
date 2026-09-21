import { UnsplashPhoto } from '@lens/shared';
import { Logger } from '@lens/shared';

const UNSPLASH_API_URL = 'https://api.unsplash.com';

export class UnsplashRateLimitError extends Error {
  public readonly resetTimeMs: number;
  public readonly remaining: number;

  constructor(message: string, resetTimeMs: number, remaining: number = 0) {
    super(message);
    this.name = 'UnsplashRateLimitError';
    this.resetTimeMs = resetTimeMs;
    this.remaining = remaining;
  }
}

export interface FetchResult {
  photos: UnsplashPhoto[];
  remaining: number;
  resetTimeMs: number;
}

export async function fetchLatestPhotos(
  apiKey: string,
  page: number = 1,
  perPage: number = 30,
  logger: Logger,
): Promise<FetchResult> {
  const url = `${UNSPLASH_API_URL}/photos?order_by=latest&per_page=${perPage}&page=${page}`;
  logger.info(`Fetching latest photos page ${page}`);

  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${apiKey}`, 'Accept-Version': 'v1' },
  });

  const remaining = parseInt(response.headers.get('X-Ratelimit-Remaining') || '0', 10);
  const resetHeader = response.headers.get('X-Ratelimit-Reset');
  // X-Ratelimit-Reset is in unix epoch seconds; fallback to 1 hour from now if missing
  const resetTimeMs = resetHeader ? parseInt(resetHeader, 10) * 1000 : Date.now() + 3600 * 1000;

  if (!response.ok) {
    const errorText = await response.text();
    logger.error(`Unsplash API Error (${response.status})`, errorText);
    if (response.status === 403 || response.status === 429) {
      throw new UnsplashRateLimitError('Unsplash API Rate Limit Exceeded', resetTimeMs, remaining);
    }
    throw new Error(`Unsplash fetch failed: ${response.statusText}`);
  }

  logger.info(`Unsplash Quota Remaining: ${remaining}, reset at: ${new Date(resetTimeMs).toISOString()}`);

  const photos = (await response.json()) as UnsplashPhoto[];
  return { photos, remaining, resetTimeMs };
}
