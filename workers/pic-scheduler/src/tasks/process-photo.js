import { ClassifyWithModelTask } from './classify-with-model.js';
import { ExtractExifTask } from './extract-exif.js';
import { SaveMetadataTask } from './save-metadata.js';

/**
 * Process Single Photo Task (Coordinator)
 * This is the "team leader" that orchestrates all sub-tasks for one photo
 */
export class ProcessPhotoTask {
  async run(env, { photoId, apiKey }) {
    // Check if already processed
    const existing = await env.DB.prepare(
      'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
    ).bind(photoId).first();
    
    if (existing) {
      return { success: true, skipped: true, photoId };
    }

    try {
      // Fetch photo details from Unsplash
      const detailRes = await fetch(
        `https://api.unsplash.com/photos/${photoId}?client_id=${apiKey}`
      );
      const photoDetail = await detailRes.json();
      
      // Download image
      const imgRes = await fetch(photoDetail.urls.raw);
      if (!imgRes.ok) throw new Error('Download failed');
      const imageBuffer = await imgRes.arrayBuffer();

      // Sub-task 1: Classify with 4 models in parallel (4 calls)
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

      // Sub-task 2: Extract EXIF data (1 call)
      const exifTask = new ExtractExifTask();
      const exifData = await exifTask.run(env, { imageBuffer });

      // Vote for best category (majority voting)
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

      // Upload to R2
      await env.R2.put(r2Key, imageBuffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      });

      // Sub-task 3: Save metadata to D1 (1 call)
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
      console.error(`Failed to process photo ${photoId}:`, error);
      return { 
        success: false, 
        photoId, 
        error: error.message 
      };
    }
  }
}
