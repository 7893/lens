import { WorkflowEntrypoint } from 'cloudflare:workers';
import { ProcessPhotoTask } from '../tasks/process-photo.js';

export class DataPipelineWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const workflowId = `wf-${Date.now()}`;
    const batchSize = 30;
    const maxRetries = 3;
    
    const tasks = await step.do('dequeue-tasks', async () => {
      const pending = await this.env.DB.prepare(`
        SELECT * FROM ProcessingQueue 
        WHERE status IN ('pending', 'failed') 
        AND retry_count < ?
        ORDER BY 
          CASE status 
            WHEN 'failed' THEN 0 
            WHEN 'pending' THEN 1 
          END,
          created_at ASC
        LIMIT ?
      `).bind(maxRetries, batchSize).all();

      if (pending.results.length === 0) {
        console.log('No tasks in queue');
        return [];
      }

      const taskIds = pending.results.map(t => t.unsplash_id);
      
      await this.env.DB.prepare(`
        UPDATE ProcessingQueue 
        SET status = 'processing', 
            last_attempted_at = datetime('now'),
            updated_at = datetime('now')
        WHERE unsplash_id IN (${taskIds.map(() => '?').join(',')})
      `).bind(...taskIds).run();

      console.log(`Dequeued ${pending.results.length} tasks`);
      return pending.results;
    });

    if (tasks.length === 0) {
      return { message: 'No tasks to process', total: 0 };
    }

    const results = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      
      const result = await step.do(`process-photo-${task.unsplash_id}`, async () => {
        const processTask = new ProcessPhotoTask();
        return await processTask.run(this.env, { 
          queueItem: task,
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
        tasks[0]?.page || 0,
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

      console.log(`Workflow completed: ${successful} success, ${failed} failed, ${skipped} skipped`);
    });

    const successful = results.filter(r => r.success && !r.skipped).length;
    const skipped = results.filter(r => r.skipped).length;
    const failed = results.filter(r => !r.success).length;

    return { 
      successful, 
      skipped, 
      failed, 
      total: results.length
    };
  }
}
