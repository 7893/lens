const UNSPLASH_API = 'https://api.unsplash.com';

export class UnsplashService {
  private apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async fetchPhotos(page: number = 1, perPage: number = 30): Promise<unknown[]> {
    const response = await fetch(
      `${UNSPLASH_API}/photos?order_by=latest&per_page=${perPage}&page=${page}&client_id=${this.apiKey}`
    );

    if (!response.ok) {
      throw new Error(`Unsplash API failed: ${response.status}`);
    }

    return await response.json();
  }

  async triggerDownload(downloadUrl: string): Promise<void> {
    await fetch(`${downloadUrl}?client_id=${this.apiKey}`);
  }

  getRawImageUrl(photo: { urls: { raw: string } }): string {
    return photo.urls.raw;
  }
}
