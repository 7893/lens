const UNSPLASH_API = 'https://api.unsplash.com';

export class UnsplashService {
  constructor(apiKey) {
    this.apiKey = apiKey;
  }

  async fetchPhotos(page = 1, perPage = 30) {
    const response = await fetch(
      `${UNSPLASH_API}/photos?order_by=latest&per_page=${perPage}&page=${page}&client_id=${this.apiKey}`
    );
    
    if (!response.ok) {
      throw new Error(`Unsplash API failed: ${response.status}`);
    }
    
    return await response.json();
  }

  async triggerDownload(downloadUrl) {
    // 触发 Unsplash 下载端点（统计用）
    await fetch(`${downloadUrl}?client_id=${this.apiKey}`);
  }

  getRawImageUrl(photo) {
    // 获取原始最大尺寸图片
    return photo.urls.raw;
  }
}
