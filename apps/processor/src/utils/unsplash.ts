import { UnsplashPhoto } from '@lens/shared';

const UNSPLASH_API_URL = 'https://api.unsplash.com';

export async function fetchRandomPhotos(apiKey: string, count: number = 10): Promise<UnsplashPhoto[]> {
  const url = `${UNSPLASH_API_URL}/photos/random?count=${count}&orientation=landscape`;
  
  console.log(`🌐 Fetching from Unsplash: ${url}`);
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Client-ID ${apiKey}`,
      'Accept-Version': 'v1'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`❌ Unsplash API Error (${response.status}): ${errorText}`);
    
    if (response.status === 403) {
      throw new Error('Unsplash API Rate Limit Exceeded or Invalid Key');
    }
    throw new Error(`Unsplash fetch failed: ${response.statusText}`);
  }

  // Check Rate Limit Headers (Optional: log them)
  const remaining = response.headers.get('X-Ratelimit-Remaining');
  console.log(`📊 Unsplash Quota Remaining: ${remaining}`);

  return response.json() as Promise<UnsplashPhoto[]>;
}
