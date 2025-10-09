import { WorkflowEntrypoint } from 'cloudflare:workers';
import { UnsplashService } from '../services/unsplash.js';
import { AIClassifier } from '../services/ai-classifier.js';
import { ExifParser } from '../services/exif-parser.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { page } = event.payload;
    
    const photos = await step.do('fetch-photos', async () => {
      const unsplash = new UnsplashService(this.env.UNSPLASH_API_KEY);
      return await unsplash.fetchPhotos(page, 30);
    });

    const results = [];

    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      
      const result = await step.do(`process-${photo.id}`, async () => {
        const existing = await this.env.DB.prepare(
          'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
        ).bind(photo.id).first();
        
        if (existing) {
          return { success: true, skipped: true, id: photo.id };
        }

        try {
          const unsplash = new UnsplashService(this.env.UNSPLASH_API_KEY);
          await unsplash.triggerDownload(photo.links.download_location);

          const imageUrl = unsplash.getRawImageUrl(photo);
          const imageResponse = await fetch(imageUrl);
          if (!imageResponse.ok) throw new Error('Image download failed');
          
          const imageBuffer = await imageResponse.arrayBuffer();

          const [aiResult, exifResult] = await Promise.all([
            new AIClassifier(this.env.AI).classifyImage(
              photo.alt_description || photo.description || 'No description'
            ),
            new ExifParser().parse(imageBuffer)
          ]);

          const category = aiResult.category;
          const r2Key = `${category}/${photo.id}.jpg`;

          await this.env.R2.put(r2Key, imageBuffer, {
            httpMetadata: { contentType: 'image/jpeg' }
          });

          await this.env.DB.prepare(`
            INSERT INTO Photos (
              unsplash_id, r2_key, downloaded_at,
              description, alt_description, width, height, color, likes,
              photographer_name, photographer_username, photographer_url, unsplash_created_at,
              ai_category, ai_confidence, ai_model_scores,
              exif_make, exif_model, exif_exposure_time, exif_f_number, 
              exif_focal_length, exif_iso, exif_datetime, exif_gps_lat, exif_gps_lon
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            photo.id, r2Key, new Date().toISOString(),
            photo.description, photo.alt_description, photo.width, photo.height,
            photo.color, photo.likes, photo.user.name, photo.user.username,
            photo.user.links.html, photo.created_at,
            category, aiResult.confidence, JSON.stringify(aiResult.scores),
            exifResult.camera_make, exifResult.camera_model, exifResult.exposure_time,
            exifResult.f_number, exifResult.focal_length, exifResult.iso,
            exifResult.taken_at, exifResult.gps_latitude, exifResult.gps_longitude
          ).run();

          return { success: true, id: photo.id, category };
        } catch (error) {
          return { success: false, id: photo.id, error: error.message };
        }
      });

      results.push(result);
    }

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { page, successful, skipped, failed, total: photos.length };
  }
}
