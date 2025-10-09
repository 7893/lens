import { WorkflowEntrypoint, WorkflowStep } from 'cloudflare:workers';
import { FetchPhotosTask } from '../tasks/fetch-photos.js';
import { ProcessPhotoTask } from '../tasks/process-photo.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const { page } = event.payload;
    const workflowId = event.id;
    
    // Step 1: Record workflow start
    await step.do('record-start', async () => {
      await this.env.DB.prepare(
        'INSERT INTO Events (id, event_type, event_data, status, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(
        workflowId, 
        'workflow', 
        JSON.stringify({ page: page || 1 }), 
        'running', 
        new Date().toISOString()
      ).run();
    });
    
    // Step 2: Fetch photos using task
    const photos = await step.do('fetch-photos', async () => {
      const task = new FetchPhotosTask();
      return await task.run(this.env, { page: page || 1, perPage: 30 });
    });

    // Step 3: Process each photo in parallel
    const results = [];
    for (let i = 0; i < Math.min(photos.length, 2); i++) {
      const photo = photos[i];
      
      const result = await step.do(`photo-${photo.id}`, async () => {
        const task = new ProcessPhotoTask();
        return await task.run(this.env, { 
          photoId: photo.id, 
          apiKey: this.env.UNSPLASH_API_KEY 
        });
      });
      
      results.push(result);
    }

    // Step 4: Record completion
    await step.do('complete', async () => {
      const successful = results.filter(r => r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => !r.success).length;
      
      await this.env.DB.prepare(
        'UPDATE Events SET status = ?, event_data = ?, completed_at = ? WHERE id = ?'
      ).bind(
        failed > 0 ? 'failed' : 'success',
        JSON.stringify({ page, successful, skipped, failed }),
        new Date().toISOString(),
        workflowId
      ).run();
    });

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { page, successful, skipped, failed, total: photos.length };
  }
}
