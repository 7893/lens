import { WorkflowEntrypoint } from 'cloudflare:workers';
import { FetchPhotosTask } from '../tasks/fetch-photos.js';
import { ProcessPhotoTask } from '../tasks/process-photo.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const inputPage = event.payload?.page || 1;
    const workflowId = `wf-${Date.now()}`;
    
    const photos = await step.do('fetch-photo-list', async () => {
      const task = new FetchPhotosTask();
      return await task.run(this.env, { page: inputPage, perPage: 30 });
    });

    console.log(`Fetched ${photos.length} photos`);

    const results = [];
    for (let i = 0; i < Math.min(photos.length, 2); i++) {
      const photo = photos[i];
      
      const result = await step.do(`process-photo-${photo.id}`, async () => {
        const task = new ProcessPhotoTask();
        return await task.run(this.env, { 
          photoId: photo.id, 
          apiKey: this.env.UNSPLASH_API_KEY 
        });
      });
      
      results.push(result);
    }

    await step.do('update-stats', async () => {
      const successful = results.filter(r => r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => !r.success).length;
      
      await this.env.DB.prepare(`
        INSERT INTO WorkflowRuns (id, page, status, photos_success, photos_failed, photos_skipped, started_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        workflowId,
        inputPage,
        failed > 0 ? 'failed' : 'success',
        successful,
        failed,
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
    });

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { 
      page: inputPage, 
      successful, 
      skipped, 
      failed, 
      total: photos.length
    };
  }
}
