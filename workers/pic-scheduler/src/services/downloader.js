import { AIClassifier } from './ai-classifier.js';

export class DownloadManager {
  constructor(r2, db, ai) {
    this.r2 = r2;
    this.db = db;
    this.ai = new AIClassifier(ai);
  }

  async downloadAndClassify(photo) {
    const startTime = Date.now();
    try {
      const response = await fetch(photo.urls.raw);
      if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);

      const imageBuffer = await response.arrayBuffer();
      const fileSize = imageBuffer.byteLength;
      
      const category = await this.ai.classifyImage(
        photo.description || photo.alt_description || 'No description',
        []
      ) || 'uncategorized';

      const key = `images/${category}/${photo.id}.jpg`;
      
      // 先写入R2
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

      // R2写入成功后再写数据库
      await this.db.prepare(`
        INSERT INTO downloads (image_id, download_url, author, description, category, width, height, file_size) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(photo.id, key, photo.user.name, photo.description || photo.alt_description || '', category, photo.width, photo.height, fileSize).run();

      const duration = Date.now() - startTime;
      console.log(`Downloaded ${photo.id} -> ${category} (${duration}ms)`);
      return { success: true, imageId: photo.id, category, fileSize, duration };
    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`Download failed ${photo.id}:`, error.message);
      return { success: false, imageId: photo.id, error: error.message, duration };
    }
  }
}
