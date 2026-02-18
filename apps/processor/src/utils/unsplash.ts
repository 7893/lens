import { UnsplashPhoto } from '@lens/shared';

const UNSPLASH_API_URL = 'https://api.unsplash.com';

export interface FetchResult {
  photos: UnsplashPhoto[];
  remaining: number;
}

export async function fetchLatestPhotos(apiKey: string, page: number = 1, perPage: number = 30): Promise<FetchResult> {
  const url = `${UNSPLASH_API_URL}/photos?order_by=latest&per_page=${perPage}&page=${page}`;
  console.log(`🌐 Fetching latest photos page ${page}`);

  const response = await fetch(url, {
    headers: { Authorization: `Client-ID ${apiKey}`, 'Accept-Version': 'v1' },
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Unsplash API Error (${response.status}): ${errorText}`);
    if (response.status === 403) throw new Error('Unsplash API Rate Limit Exceeded');
    throw new Error(`Unsplash fetch failed: ${response.statusText}`);
  }

  const remaining = parseInt(response.headers.get('X-Ratelimit-Remaining') || '0', 10);
  console.log(`📊 Unsplash Quota Remaining: ${remaining}`);

  const photos = (await response.json()) as UnsplashPhoto[];
  return { photos, remaining };
}
