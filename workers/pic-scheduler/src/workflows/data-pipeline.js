import { WorkflowEntrypoint } from 'cloudflare:workers';
import { FetchPhotosTask } from '../tasks/fetch-photos.js';
import { ProcessPhotoTask } from '../tasks/process-photo.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const page = event.payload?.page || 1;
    const workflowId = event.id;
    
    // Step 1: Fetch photo list (1 call)
    const photos = await step.do('fetch-photo-list', async () => {
      const task = new FetchPhotosTask();
      return await task.run(this.env, { page, perPage: 30 });
    });

    console.log(`Fetched ${photos.length} photos`);

    // Step 2: Process each photo in parallel (30 calls)
    const results = [];
    for (let i = 0; i < Math.min(photos.length, 2); i++) {  // 先测试2张
      const photo = photos[i];
      
      // Each process-single-photo will internally:
      // - Call classify-with-model 4 times (4 models)
      // - Call extract-exif-data 1 time
      // - Call save-metadata-to-d1 1 time
      const result = await step.do(`process-photo-${photo.id}`, async () => {
        const task = new ProcessPhotoTask();
        return await task.run(this.env, { 
          photoId: photo.id, 
          apiKey: this.env.UNSPLASH_API_KEY 
        });
      });
      
      results.push(result);
    }

    // Step 3: Record workflow completion
    await step.do('record-completion', async () => {
      const successful = results.filter(r => r.success && !r.skipped).length;
      const skipped = results.filter(r => r.skipped).length;
      const failed = results.filter(r => !r.success).length;
      
      // Record to Events table
      const eventId = `wf-${Date.now()}`;
      await this.env.DB.prepare(
        'INSERT INTO Events (id, event_type, event_data, status, created_at, completed_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(
        eventId,
        'workflow',
        JSON.stringify({ page, successful, skipped, failed }),
        failed > 0 ? 'failed' : 'success',
        new Date().toISOString(),
        new Date().toISOString()
      ).run();
      
      // Update metrics
      await this.env.DB.prepare(
        'INSERT INTO Metrics (metric_key, metric_value, dimension, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(metric_key) DO UPDATE SET metric_value = CAST(CAST(metric_value AS INTEGER) + ? AS TEXT), updated_at = ?'
      ).bind(
        'workflows.total',
        '1',
        'global',
        new Date().toISOString(),
        1,
        new Date().toISOString()
      ).run();
    });

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { 
      page, 
      successful, 
      skipped, 
      failed, 
      total: photos.length,
      summary: `Processed ${successful}/${photos.length} photos successfully`
    };
  }
}
