import { ClassifyWithModelTask } from './classify-with-model.js';
import { ExtractExifTask } from './extract-exif.js';
import { SaveMetadataTask } from './save-metadata.js';

export class ProcessPhotoTask {
  async run(env, { photoId, apiKey, page }) {
    const existing = await env.DB.prepare(
      'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
    ).bind(photoId).first();
    
    if (existing) {
      return { success: true, skipped: true, photoId };
    }

    const queue = await env.DB.prepare(
      'SELECT * FROM ProcessingQueue WHERE unsplash_id = ?'
    ).bind(photoId).first();

    const maxRetries = 3;
    const retryCount = queue?.retry_count || 0;

    if (retryCount >= maxRetries) {
      return { success: false, photoId, error: 'Max retries exceeded', giveUp: true };
    }

    const timeout = 60000;
    let downloadSuccess = queue?.download_success || 0;
    let aiSuccess = queue?.ai_success || 0;
    let metadataSuccess = queue?.metadata_success || 0;
    let photoDetail, imageBuffer, bestCategory, confidence, r2Key;

    try {
      if (!downloadSuccess) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeout);

        const detailRes = await fetch(
          `https://api.unsplash.com/photos/${photoId}?client_id=${apiKey}`,
          { signal: controller.signal }
        );
        
        clearTimeout(timeoutId);

        if (!detailRes.ok) {
          throw new Error(`Unsplash API failed: ${detailRes.status}`);
        }

        photoDetail = await detailRes.json();
        
        const imgController = new AbortController();
        const imgTimeoutId = setTimeout(() => imgController.abort(), timeout);

        const imgRes = await fetch(photoDetail.urls.raw, { signal: imgController.signal });
        
        clearTimeout(imgTimeoutId);

        if (!imgRes.ok) throw new Error('Download failed');
        imageBuffer = await imgRes.arrayBuffer();

        downloadSuccess = 1;
        
        await env.DB.prepare(`
          INSERT INTO ProcessingQueue (unsplash_id, page, status, download_success, retry_count, created_at, updated_at)
          VALUES (?, ?, 'downloading', 1, ?, datetime('now'), datetime('now'))
          ON CONFLICT(unsplash_id) DO UPDATE SET download_success=1, updated_at=datetime('now')
        `).bind(photoId, page, retryCount).run();
      } else {
        const detailRes = await fetch(`https://api.unsplash.com/photos/${photoId}?client_id=${apiKey}`);
        photoDetail = await detailRes.json();
        const imgRes = await fetch(photoDetail.urls.raw);
        imageBuffer = await imgRes.arrayBuffer();
      }

      if (!aiSuccess) {
        const models = [
          '@cf/meta/llama-3-8b-instruct',
          '@cf/meta/llama-3.1-8b-instruct-fp8',
          '@cf/mistral/mistral-7b-instruct-v0.1',
          '@cf/meta/llama-3.2-3b-instruct'
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
          UPDATE ProcessingQueue SET ai_success=1, status='classifying', updated_at=datetime('now')
          WHERE unsplash_id=?
        `).bind(photoId).run();
      } else {
        bestCategory = queue.category;
        confidence = queue.confidence;
        r2Key = queue.r2_key;
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
        
        await env.DB.prepare(`
          UPDATE ProcessingQueue SET metadata_success=1, db_success=1, status='completed', updated_at=datetime('now')
          WHERE unsplash_id=?
        `).bind(photoId).run();
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
        INSERT INTO ProcessingQueue (unsplash_id, page, status, download_success, ai_success, metadata_success, retry_count, last_error, created_at, updated_at)
        VALUES (?, ?, 'failed', ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
        ON CONFLICT(unsplash_id) DO UPDATE SET 
          download_success=?, ai_success=?, metadata_success=?, 
          retry_count=retry_count+1, last_error=?, status='failed', updated_at=datetime('now')
      `).bind(
        photoId, page, downloadSuccess, aiSuccess, metadataSuccess, retryCount + 1, error.message,
        downloadSuccess, aiSuccess, metadataSuccess, error.message
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
