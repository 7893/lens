import { WorkflowEntrypoint } from 'cloudflare:workers';
import { UnsplashService } from '../services/unsplash.js';
import { AIClassifier } from '../services/ai-classifier.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { page } = event.payload;
    const workflowId = event.id;
    const startTime = Date.now();
    
    // Step 1: Record start
    await step.do('record-start', async () => {
      await this.env.DB.prepare(
        'INSERT INTO Events (id, event_type, event_data, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(workflowId, 'workflow', JSON.stringify({ page }), 'running', new Date().toISOString()).run();
    });
    
    // Step 2: Fetch photos
    const photos = await step.do('fetch-photos', async () => {
      const unsplash = new UnsplashService(this.env.UNSPLASH_API_KEY);
      return await unsplash.fetchPhotos(page, 30);
    });

    const results = [];

    // Step 3: Process photos
    for (let i = 0; i < Math.min(photos.length, 2); i++) {  // 先只处理2张测试
      const photo = photos[i];
      
      const result = await step.do(`photo-${photo.id}`, async () => {
        try {
          // Check existing
          const existing = await this.env.DB.prepare(
            'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
          ).bind(photo.id).first();
          
          if (existing) {
            return { success: true, skipped: true };
          }

          // Get details
          const detailRes = await fetch(
            `https://api.unsplash.com/photos/${photo.id}?client_id=${this.env.UNSPLASH_API_KEY}`
          );
          const detail = await detailRes.json();
          
          // Download image
          const imgRes = await fetch(detail.urls.raw);
          if (!imgRes.ok) throw new Error('Download failed');
          const imgBuf = await imgRes.arrayBuffer();

          // AI classify
          const ai = await new AIClassifier(this.env.AI).classifyImage(
            detail.alt_description || detail.description || 'No description'
          );

          const cat = ai.category;
          const key = `${cat}/${detail.id}.jpg`;

          // Upload R2
          await this.env.R2.put(key, imgBuf, {
            httpMetadata: { contentType: 'image/jpeg' }
          });

          // Save DB - 确保所有值都不是undefined
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
            detail.id || '', 
            detail.slug || '', 
            key, 
            new Date().toISOString(),
            detail.description || null, 
            detail.alt_description || null, 
            detail.blur_hash || null,
            detail.width || 0, 
            detail.height || 0, 
            detail.color || null, 
            detail.likes || 0,
            detail.created_at || new Date().toISOString(), 
            detail.updated_at || null, 
            detail.promoted_at || null,
            detail.user?.id || '', 
            detail.user?.username || '', 
            detail.user?.name || '',
            detail.user?.bio || null, 
            detail.user?.location || null, 
            detail.user?.portfolio_url || null,
            detail.user?.instagram_username || null, 
            detail.user?.twitter_username || null,
            detail.location?.name || null, 
            detail.location?.city || null, 
            detail.location?.country || null,
            detail.location?.position?.latitude || null, 
            detail.location?.position?.longitude || null,
            detail.exif?.make || null, 
            detail.exif?.model || null, 
            detail.exif?.name || null,
            detail.exif?.exposure_time || null, 
            detail.exif?.aperture || null, 
            detail.exif?.focal_length || null, 
            detail.exif?.iso || null,
            JSON.stringify(detail.tags?.map(t => t.title) || []),
            cat, 
            ai.confidence || 0, 
            JSON.stringify(ai.scores || {})
          ).run();

          return { success: true };
        } catch (error) {
          console.error('Process error:', error);
          return { success: false, error: error.message };
        }
      });

      results.push(result);
    }

    // Step 4: Complete
    await step.do('complete', async () => {
      const ok = results.filter(r => r.success && !r.skipped).length;
      const skip = results.filter(r => r.skipped).length;
      const fail = results.filter(r => !r.success).length;
      
      await this.env.DB.prepare(
        'UPDATE Events SET status = ?, event_data = ?, completed_at = ? WHERE id = ?'
      ).bind(
        fail > 0 ? 'failed' : 'success',
        JSON.stringify({ page, ok, skip, fail, duration: Date.now() - startTime }),
        new Date().toISOString(),
        workflowId
      ).run();
    });

    const ok = results.filter(r => r.success && !r.skipped).length;
    const skip = results.filter(r => r.skipped).length;
    const fail = results.filter(r => !r.success).length;

    return { page, ok, skip, fail, total: photos.length };
  }
}
