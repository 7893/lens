import { AIClassifier } from './ai-classifier.js';

interface DownloadResult {
  success: boolean;
  imageId: string;
  category?: string;
  fileSize?: number;
  duration: number;
  error?: string;
}

export class DownloadManager {
  private r2: R2Bucket;
  private db: D1Database;
  private ai: AIClassifier;

  constructor(r2: R2Bucket, db: D1Database, ai: Ai) {
    this.r2 = r2;
    this.db = db;
    this.ai = new AIClassifier(ai);
  }

  async downloadAndClassify(photo: {
    id: string;
    urls: { raw: string };
    user: { name: string };
    width: number;
    height: number;
    description: string | null;
    alt_description: string | null;
  }): Promise<DownloadResult> {
    const startTime = Date.now();
    try {
      const response = await fetch(photo.urls.raw);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

      const imageBuffer = await response.arrayBuffer();
      const fileSize = imageBuffer.byteLength;

      const result = await this.ai.classifyImage(
        photo.description || photo.alt_description || 'No description'
      );
      const category = result.category || 'uncategorized';

      const key = `images/${category}/${photo.id}.jpg`;

      await this.r2.put(key, imageBuffer, {
        httpMetadata: {
          contentType: 'image/jpeg',
          cacheControl: 'public, max-age=31536000'
        },
        customMetadata: {
          author: photo.user.name,
          width: photo.width.toString(),
          height: photo.height.toString(),
          category,
          downloadedAt: new Date().toISOString()
        }
      });

      await this.db.prepare(`
        INSERT INTO downloads (image_id, download_url, author, description, category, width, height, file_size) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(photo.id, key, photo.user.name, photo.description || photo.alt_description || '', category, photo.width, photo.height, fileSize).run();

      const duration = Date.now() - startTime;
      console.log(`Downloaded ${photo.id} -> ${category} (${duration}ms)`);
      return { success: true, imageId: photo.id, category, fileSize, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Download failed ${photo.id}:`, (error as Error).message);
      return { success: false, imageId: photo.id, error: (error as Error).message, duration };
    }
  }
}
