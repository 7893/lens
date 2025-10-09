import { WorkflowEntrypoint } from 'cloudflare:workers';
import { UnsplashService } from '../services/unsplash.js';
import { AIClassifier } from '../services/ai-classifier.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { page } = event.payload;
    const workflowId = event.id;
    const startTime = Date.now();
    
    // Record workflow start
    await step.do('record-start', async () => {
      await this.env.DB.prepare(`
        INSERT INTO Events (id, event_type, event_data, status, created_at)
        VALUES (?, 'workflow', ?, 'running', ?)
      `).bind(workflowId, JSON.stringify({ page }), new Date().toISOString()).run();
    });
    
    // Fetch photos
    const photos = await step.do('fetch-photos', async () => {
      const unsplash = new UnsplashService(this.env.UNSPLASH_API_KEY);
      return await unsplash.fetchPhotos(page, 30);
    });

    const results = [];

    // Process each photo
    for (let i = 0; i < photos.length; i++) {
      const photo = photos[i];
      
      const result = await step.do(`process-${photo.id}`, async () => {
        try {
          const existing = await this.env.DB.prepare(
            'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
          ).bind(photo.id).first();
          
          if (existing) {
            return { success: true, skipped: true };
          }

          const detailResponse = await fetch(
            `https://api.unsplash.com/photos/${photo.id}?client_id=${this.env.UNSPLASH_API_KEY}`
          );
          const photoDetail = await detailResponse.json();
          
          const imageResponse = await fetch(photoDetail.urls.raw);
          if (!imageResponse.ok) throw new Error('Download failed');
          
          const imageBuffer = await imageResponse.arrayBuffer();

          const aiResult = await new AIClassifier(this.env.AI).classifyImage(
            photoDetail.alt_description || photoDetail.description || 'No description'
          );

          const category = aiResult.category;
          const r2Key = `${category}/${photoDetail.id}.jpg`;

          await this.env.R2.put(r2Key, imageBuffer, {
            httpMetadata: { contentType: 'image/jpeg' }
          });

          await this.env.DB.prepare(`
            INSERT INTO Photos (
              unsplash_id, slug, r2_key, downloaded_at,
              description, alt_description, blur_hash, width, height, color, likes,
              created_at, updated_at, promoted_at,
              photographer_id, photographer_username, photographer_name, 
              photographer_bio, photographer_location, photographer_portfolio_url,
              photographer_instagram, photographer_twitter,
              photo_location_name, photo_location_city, photo_location_country,
              photo_location_latitude, photo_location_longitude,
              exif_make, exif_model, exif_name, exif_exposure_time,
              exif_aperture, exif_focal_length, exif_iso,
              tags, ai_category, ai_confidence, ai_model_scores
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).bind(
            photoDetail.id, photoDetail.slug, r2Key, new Date().toISOString(),
            photoDetail.description, photoDetail.alt_description, photoDetail.blur_hash,
            photoDetail.width, photoDetail.height, photoDetail.color, photoDetail.likes,
            photoDetail.created_at, photoDetail.updated_at, photoDetail.promoted_at,
            photoDetail.user.id, photoDetail.user.username, photoDetail.user.name,
            photoDetail.user.bio, photoDetail.user.location, photoDetail.user.portfolio_url,
            photoDetail.user.instagram_username, photoDetail.user.twitter_username,
            photoDetail.location?.name, photoDetail.location?.city, photoDetail.location?.country,
            photoDetail.location?.position?.latitude, photoDetail.location?.position?.longitude,
            photoDetail.exif?.make, photoDetail.exif?.model, photoDetail.exif?.name,
            photoDetail.exif?.exposure_time, photoDetail.exif?.aperture, photoDetail.exif?.focal_length, photoDetail.exif?.iso,
            JSON.stringify(photoDetail.tags?.map(t => t.title) || []),
            category, aiResult.confidence, JSON.stringify(aiResult.scores)
          ).run();

          return { success: true };
        } catch (error) {
          console.error(`Error:`, error);
          return { success: false, error: error.message };
        }
      });

      results.push(result);
    }

    // Record completion
    await step.do('record-complete', async () => {
      const successful = results.filter(r => r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => !r.success).length;
      const duration = Date.now() - startTime;
      
      await this.env.DB.batch([
        this.env.DB.prepare(`
          UPDATE Events SET status = ?, event_data = ?, completed_at = ? WHERE id = ?
        `).bind(
          failed > 0 ? 'failed' : 'success',
          JSON.stringify({ page, successful, skipped, failed, duration }),
          new Date().toISOString(),
          workflowId
        ),
        
        this.env.DB.prepare(`
          INSERT INTO Metrics (metric_key, metric_value, dimension, updated_at)
          VALUES ('workflows.total', '1', 'global', ?)
          ON CONFLICT(metric_key) DO UPDATE SET 
            metric_value = CAST(CAST(metric_value AS INTEGER) + 1 AS TEXT),
            updated_at = ?
        `).bind(new Date().toISOString(), new Date().toISOString())
      ]);
    });

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { page, successful, skipped, failed, total: photos.length };
  }
}
