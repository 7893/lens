import { ClassifyWithModelTask } from './classify-with-model.js';
import { SaveMetadataTask } from './save-metadata.js';

export class ProcessPhotoTask {
  async run(env, { queueItem }) {
    const photoId = queueItem.unsplash_id;
    const photoDetail = JSON.parse(queueItem.photo_data);
    
    const existing = await env.DB.prepare(
      'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
    ).bind(photoId).first();
    
    if (existing) {
      await env.DB.prepare('DELETE FROM ProcessingQueue WHERE unsplash_id=?').bind(photoId).run();
      return { success: true, skipped: true, photoId };
    }

    const maxRetries = 3;
    const retryCount = queueItem.retry_count || 0;

    if (retryCount >= maxRetries) {
      await env.DB.prepare(`
        UPDATE ProcessingQueue SET status='abandoned', updated_at=datetime('now')
        WHERE unsplash_id=?
      `).bind(photoId).run();
      return { success: false, photoId, error: 'Max retries exceeded', abandoned: true };
    }

    const timeout = 60000;
    let downloadSuccess = queueItem.download_success || 0;
    let aiSuccess = queueItem.ai_success || 0;
    let metadataSuccess = queueItem.metadata_success || 0;
    let imageBuffer, bestCategory, confidence, r2Key;

    try {
      if (!downloadSuccess) {
        const imgController = new AbortController();
        const imgTimeoutId = setTimeout(() => imgController.abort(), timeout);

        // Use regular quality instead of raw to save storage
        const imgRes = await fetch(photoDetail.urls.regular, { signal: imgController.signal });
        
        clearTimeout(imgTimeoutId);

        if (!imgRes.ok) throw new Error('Download failed');
        imageBuffer = await imgRes.arrayBuffer();

        downloadSuccess = 1;
        
        await env.DB.prepare(`
          UPDATE ProcessingQueue SET download_success=1, updated_at=datetime('now')
          WHERE unsplash_id=?
        `).bind(photoId).run();
      } else {
        const imgRes = await fetch(photoDetail.urls.regular);
        imageBuffer = await imgRes.arrayBuffer();
      }

      if (!aiSuccess) {
        const models = [
          '@cf/meta/llama-3.2-3b-instruct',
          '@cf/mistral/mistral-7b-instruct-v0.1'
        ];

        const classifyTask = new ClassifyWithModelTask();
        const description = photoDetail.alt_description || photoDetail.description || 'No description';
        
        const classifyResults = await Promise.all(
          models.map(modelName => 
            classifyTask.run(env, { description, modelName })
          )
        );

        const validResults = classifyResults.filter(r => r !== null);
        if (validResults.length === 0) {
          throw new Error('All AI models failed');
        }

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
        r2Key = `${bestCategory}/${photoDetail.id}.jpg`;

        aiSuccess = 1;
        
        await env.DB.prepare(`
          UPDATE ProcessingQueue SET ai_success=1, updated_at=datetime('now')
          WHERE unsplash_id=?
        `).bind(photoId).run();
      } else {
        const description = photoDetail.alt_description || photoDetail.description || 'No description';
        const classifyTask = new ClassifyWithModelTask();
        const models = [
          '@cf/meta/llama-3.2-3b-instruct',
          '@cf/mistral/mistral-7b-instruct-v0.1'
        ];
        
        const classifyResults = await Promise.all(
          models.map(modelName => classifyTask.run(env, { description, modelName }))
        );

        const validResults = classifyResults.filter(r => r !== null);
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
        r2Key = `${bestCategory}/${photoDetail.id}.jpg`;
      }

      if (!metadataSuccess) {
        await env.R2.put(r2Key, imageBuffer, {
          httpMetadata: { contentType: 'image/jpeg' }
        });

        const saveTask = new SaveMetadataTask();
        await saveTask.run(env, {
          photoDetail,
          category: bestCategory,
          confidence,
          r2Key
        });

        metadataSuccess = 1;
      }

      await env.DB.prepare('DELETE FROM ProcessingQueue WHERE unsplash_id=?').bind(photoId).run();

      return { 
        success: true, 
        photoId, 
        category: bestCategory,
        confidence
      };

    } catch (error) {
      await env.DB.prepare(`
        UPDATE ProcessingQueue SET 
          download_success=?, 
          ai_success=?, 
          metadata_success=?, 
          retry_count=retry_count+1, 
          last_error=?, 
          status='failed', 
          updated_at=datetime('now')
        WHERE unsplash_id=?
      `).bind(
        downloadSuccess, aiSuccess, metadataSuccess, error.message, photoId
      ).run();

      console.error(`Failed to process photo ${photoId} (attempt ${retryCount + 1}):`, error.message);
      
      return { 
        success: false, 
        photoId, 
        error: error.message,
        willRetry: retryCount + 1 < maxRetries
      };
    }
  }
}
