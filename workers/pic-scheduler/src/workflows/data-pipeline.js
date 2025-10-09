import { WorkflowEntrypoint } from 'cloudflare:workers';
import { FetchPhotosTask } from '../tasks/fetch-photos.js';
import { ProcessPhotoTask } from '../tasks/process-photo.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const inputPage = event.payload?.page || 1;
    const inputOffset = event.payload?.offset || 0;
    const workflowId = `wf-${Date.now()}`;
    const batchSize = 10;
    
    const failedPhotos = await step.do('check-failed-queue', async () => {
      const failed = await this.env.DB.prepare(
        'SELECT unsplash_id FROM ProcessingQueue WHERE status="failed" AND retry_count < 3 ORDER BY created_at LIMIT ?'
      ).bind(batchSize).all();
      return failed.results || [];
    });

    let photosToProcess = [];
    
    if (failedPhotos.length > 0) {
      console.log(`Retrying ${failedPhotos.length} failed photos`);
      photosToProcess = failedPhotos.map(p => ({ id: p.unsplash_id }));
    } else {
      const photos = await step.do('fetch-photo-list', async () => {
        const task = new FetchPhotosTask();
        return await task.run(this.env, { page: inputPage, perPage: 30 });
      });

      console.log(`Fetched ${photos.length} photos, processing from offset ${inputOffset}`);
      photosToProcess = photos.slice(inputOffset, inputOffset + batchSize);
    }

    const results = [];

    for (let i = 0; i < photosToProcess.length; i++) {
      const photo = photosToProcess[i];
      
      const result = await step.do(`process-photo-${photo.id}`, async () => {
        const task = new ProcessPhotoTask();
        return await task.run(this.env, { 
          photoId: photo.id, 
          apiKey: this.env.UNSPLASH_API_KEY,
          page: inputPage
        });
      });
      
      results.push(result);
    }

    await step.do('update-progress', async () => {
      const successful = results.filter(r => r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => !r.success && !r.giveUp).length;
      const gaveUp = results.filter(r => r.giveUp).length;
      
      let nextPage = inputPage;
      let nextOffset = inputOffset;

      if (failedPhotos.length === 0) {
        nextOffset = inputOffset + batchSize;
        if (nextOffset >= 30) {
          nextPage = inputPage + 1;
          nextOffset = 0;
        }
      }

      await this.env.DB.prepare(`
        INSERT INTO WorkflowRuns (id, page, status, photos_success, photos_failed, photos_skipped, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        workflowId,
        inputPage,
        failed > 0 ? 'failed' : 'success',
        successful,
        failed + gaveUp,
        skipped,
        new Date().toISOString(),
        new Date().toISOString()
      ).run();

      await this.env.DB.prepare(`
        UPDATE GlobalStats SET 
          total_workflows = total_workflows + 1,
          successful_workflows = successful_workflows + ?,
          failed_workflows = failed_workflows + ?,
          total_downloads = total_downloads + ?,
          successful_downloads = successful_downloads + ?,
          skipped_downloads = skipped_downloads + ?,
          updated_at = ?
        WHERE id = 1
      `).bind(
        failed > 0 ? 0 : 1,
        failed > 0 ? 1 : 0,
        results.length,
        successful,
        skipped,
        new Date().toISOString()
      ).run();

      await this.env.DB.prepare(`
        INSERT INTO State (key, value, updated_at) VALUES ('last_page', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
      `).bind(String(nextPage), new Date().toISOString(), String(nextPage), new Date().toISOString()).run();

      await this.env.DB.prepare(`
        INSERT INTO State (key, value, updated_at) VALUES ('page_offset', ?, ?)
        ON CONFLICT(key) DO UPDATE SET value = ?, updated_at = ?
      `).bind(String(nextOffset), new Date().toISOString(), String(nextOffset), new Date().toISOString()).run();

      console.log(`Progress: page ${inputPage} offset ${inputOffset} -> next page ${nextPage} offset ${nextOffset}`);
    });

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { 
      page: inputPage,
      offset: inputOffset,
      successful, 
      skipped, 
      failed, 
      total: results.length
    };
  }
}
