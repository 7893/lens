import { ClassifyWithModelTask } from './classify-with-model.js';
import { ExtractExifTask } from './extract-exif.js';
import { SaveMetadataTask } from './save-metadata.js';

export class ProcessPhotoTask {
  async run(env, { photoId, apiKey }) {
    const existing = await env.DB.prepare(
      'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
    ).bind(photoId).first();
    
    if (existing) {
      return { success: true, skipped: true, photoId };
    }

    const maxRetries = 2;
    const timeout = 30000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
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

        const photoDetail = await detailRes.json();
        
        const imgController = new AbortController();
        const imgTimeoutId = setTimeout(() => imgController.abort(), timeout);

        const imgRes = await fetch(photoDetail.urls.raw, { signal: imgController.signal });
        
        clearTimeout(imgTimeoutId);

        if (!imgRes.ok) throw new Error('Download failed');
        const imageBuffer = await imgRes.arrayBuffer();

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

        const exifTask = new ExtractExifTask();
        const exifData = await exifTask.run(env, { imageBuffer });

        const validResults = classifyResults.filter(r => r !== null);
        if (validResults.length === 0) {
          throw new Error('All AI models failed');
        }

        const scoreMap = {};
        validResults.forEach(({ label, score }) => {
          scoreMap[label] = (scoreMap[label] || 0) + score;
        });

        let bestCategory = 'uncategorized';
        let bestScore = 0;
        for (const [label, totalScore] of Object.entries(scoreMap)) {
          if (totalScore > bestScore) {
            bestScore = totalScore;
            bestCategory = label;
          }
        }

        const confidence = bestScore / models.length;
        const r2Key = `${bestCategory}/${photoDetail.id}.jpg`;

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

        return { 
          success: true, 
          photoId, 
          category: bestCategory,
          confidence,
          aiCalls: models.length
        };

      } catch (error) {
        if (attempt === maxRetries) {
          console.error(`Failed to process photo ${photoId} after ${maxRetries + 1} attempts:`, error.message);
          return { 
            success: false, 
            photoId, 
            error: error.message 
          };
        }
        await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
      }
    }

    return { success: false, photoId, error: 'Max retries exceeded' };
  }
}
