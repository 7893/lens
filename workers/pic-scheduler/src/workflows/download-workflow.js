import { WorkflowEntrypoint } from 'cloudflare:workers';

export class DownloadWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const workflowId = `dl-${Date.now()}`;
    const batchSize = 30;
    
    const tasks = await step.do('dequeue-download-tasks', async () => {
      const pending = await this.env.DB.prepare(`
        SELECT * FROM ProcessingQueue 
        WHERE (status = 'pending' OR (status = 'failed' AND download_success = 0))
        AND download_success = 0
        AND retry_count < 3
        ORDER BY 
          CASE status 
            WHEN 'failed' THEN 0 
            WHEN 'pending' THEN 1 
          END,
          created_at ASC
        LIMIT ?
      `).bind(batchSize).all();

      if (pending.results.length === 0) {
        return [];
      }

      const taskIds = pending.results.map(t => t.unsplash_id);
      
      await this.env.DB.prepare(`
        UPDATE ProcessingQueue 
        SET status = 'downloading', updated_at = datetime('now')
        WHERE unsplash_id IN (${taskIds.map(() => '?').join(',')})
      `).bind(...taskIds).run();

      return pending.results;
    });

    if (tasks.length === 0) {
      return { message: 'No download tasks', total: 0 };
    }

    const results = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const photoDetail = JSON.parse(task.photo_data);
      
      const result = await step.do(`download-${task.unsplash_id}`, async () => {
        try {
          const imgRes = await fetch(photoDetail.urls.raw);
          if (!imgRes.ok) throw new Error('Download failed');
          
          const imageBuffer = await imgRes.arrayBuffer();
          const tempKey = `temp/${task.unsplash_id}.jpg`;
          
          await this.env.R2.put(tempKey, imageBuffer, {
            httpMetadata: { contentType: 'image/jpeg' }
          });

          await this.env.DB.prepare(`
            UPDATE ProcessingQueue 
            SET download_success = 1, status = 'downloaded', updated_at = datetime('now')
            WHERE unsplash_id = ?
          `).bind(task.unsplash_id).run();

          return { success: true, photoId: task.unsplash_id };
        } catch (error) {
          await this.env.DB.prepare(`
            UPDATE ProcessingQueue 
            SET retry_count = retry_count + 1, 
                last_error = ?, 
                status = 'failed', 
                updated_at = datetime('now')
            WHERE unsplash_id = ?
          `).bind(error.message, task.unsplash_id).run();

          return { success: false, photoId: task.unsplash_id, error: error.message };
        }
      });
      
      results.push(result);
    }

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    return { 
      workflowId,
      successful, 
      failed, 
      total: results.length
    };
  }
}
