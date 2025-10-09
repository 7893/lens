import { WorkflowEntrypoint } from 'cloudflare:workers';
import { ClassifyWithModelTask } from '../tasks/classify-with-model.js';
import { SaveMetadataTask } from '../tasks/save-metadata.js';

export class ClassifyWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const workflowId = `cl-${Date.now()}`;
    const batchSize = 30;
    
    const tasks = await step.do('dequeue-classify-tasks', async () => {
      const downloaded = await this.env.DB.prepare(`
        SELECT * FROM ProcessingQueue 
        WHERE (status = 'downloaded' OR (status = 'failed' AND download_success = 1))
        AND ai_success = 0
        AND retry_count < 3
        ORDER BY 
          CASE status 
            WHEN 'failed' THEN 0 
            WHEN 'downloaded' THEN 1 
          END,
          created_at ASC
        LIMIT ?
      `).bind(batchSize).all();

      if (downloaded.results.length === 0) {
        return [];
      }

      const taskIds = downloaded.results.map(t => t.unsplash_id);
      
      await this.env.DB.prepare(`
        UPDATE ProcessingQueue 
        SET status = 'classifying', updated_at = datetime('now')
        WHERE unsplash_id IN (${taskIds.map(() => '?').join(',')})
      `).bind(...taskIds).run();

      return downloaded.results;
    });

    if (tasks.length === 0) {
      return { message: 'No classify tasks', total: 0 };
    }

    const results = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const photoDetail = JSON.parse(task.photo_data);
      
      const result = await step.do(`classify-${task.unsplash_id}`, async () => {
        try {
          const models = [
            '@cf/meta/llama-3.2-3b-instruct',
            '@cf/mistral/mistral-7b-instruct-v0.1'
          ];

          const classifyTask = new ClassifyWithModelTask();
          const description = photoDetail.alt_description || photoDetail.description || 'No description';
          
          const classifyResults = await Promise.all(
            models.map(modelName => classifyTask.run(this.env, { description, modelName }))
          );

          let bestCategory;
          let confidence;

          const validResults = classifyResults.filter(r => r !== null);
          if (validResults.length === 0) {
            bestCategory = 'uncategorized';
            confidence = 0.5;
          } else {
            const scoreMap = {};
            validResults.forEach(({ label, score }) => {
              scoreMap[label] = (scoreMap[label] || 0) + score;
            });

            bestCategory = 'uncategorized';
            let bestScore = 0;
            for (const [label, totalScore] of Object.entries(scoreMap)) {
              if (totalScore > bestScore) {
                bestScore = totalScore;
                bestCategory = label;
              }
            }

            confidence = bestScore / models.length;
          }
          const tempKey = `temp/${task.unsplash_id}.jpg`;
          const finalKey = `${bestCategory}/${task.unsplash_id}.jpg`;

          const tempObj = await this.env.R2.get(tempKey);
          if (!tempObj) throw new Error('Temp file not found');

          await this.env.R2.put(finalKey, tempObj.body, {
            httpMetadata: { contentType: 'image/jpeg' }
          });

          await this.env.R2.delete(tempKey);

          const saveTask = new SaveMetadataTask();
          await saveTask.run(this.env, {
            photoDetail,
            category: bestCategory,
            confidence,
            r2Key: finalKey
          });

          await this.env.DB.prepare('DELETE FROM ProcessingQueue WHERE unsplash_id=?')
            .bind(task.unsplash_id).run();

          return { success: true, photoId: task.unsplash_id, category: bestCategory };
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

    await step.do('update-stats', async () => {
      await this.env.DB.prepare(`
        UPDATE GlobalStats SET 
          total_workflows = total_workflows + 1,
          successful_workflows = successful_workflows + 1,
          total_downloads = total_downloads + ?,
          successful_downloads = successful_downloads + ?,
          updated_at = ?
        WHERE id = 1
      `).bind(results.length, successful, new Date().toISOString()).run();
    });

    return { 
      workflowId,
      successful, 
      failed, 
      total: results.length
    };
  }
}
