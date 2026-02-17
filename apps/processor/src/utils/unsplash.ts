import { UnsplashPhoto } from '@lens/shared';

const UNSPLASH_API_URL = 'https://api.unsplash.com';

export async function fetchLatestPhotos(apiKey: string, page: number = 1, perPage: number = 30): Promise<UnsplashPhoto[]> {
  const url = `${UNSPLASH_API_URL}/photos?order_by=latest&per_page=${perPage}&page=${page}`;
  console.log(`🌐 Fetching latest photos page ${page}`);

  const response = await fetch(url, {
    headers: { 'Authorization': `Client-ID ${apiKey}`, 'Accept-Version': 'v1' }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Unsplash API Error (${response.status}): ${errorText}`);
    if (response.status === 403) throw new Error('Unsplash API Rate Limit Exceeded');
    throw new Error(`Unsplash fetch failed: ${response.statusText}`);
  }

  const remaining = response.headers.get('X-Ratelimit-Remaining');
  console.log(`📊 Unsplash Quota Remaining: ${remaining}`);

  return response.json() as Promise<UnsplashPhoto[]>;
}
