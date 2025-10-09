import { ClassifyWithModelTask } from './classify-with-model.js';
import { SaveMetadataTask } from './save-metadata.js';

export class ProcessPhotoTask {
  async run(env, { photoId, apiKey }) {
    // Check if exists
    const existing = await env.DB.prepare(
      'SELECT unsplash_id FROM Photos WHERE unsplash_id = ?'
    ).bind(photoId).first();
    
    if (existing) {
      return { success: true, skipped: true };
    }

    // Get photo details
    const detailRes = await fetch(
      `https://api.unsplash.com/photos/${photoId}?client_id=${apiKey}`
    );
    const detail = await detailRes.json();
    
    // Download image
    const imgRes = await fetch(detail.urls.raw);
    if (!imgRes.ok) throw new Error('Download failed');
    const imgBuf = await imgRes.arrayBuffer();

    // AI classify with 4 models in parallel
    const models = [
      '@cf/meta/llama-3-8b-instruct',
      '@cf/meta/llama-3.1-8b-instruct-fp8',
      '@cf/mistral/mistral-7b-instruct-v0.1',
      '@cf/meta/llama-3.2-3b-instruct'
    ];

    const classifyTask = new ClassifyWithModelTask();
    const description = detail.alt_description || detail.description || 'No description';
    
    const results = await Promise.all(
      models.map(model => classifyTask.run(env, { description, modelName: model }))
    );

    // Vote for best category
    const validResults = results.filter(r => r !== null);
    if (validResults.length === 0) {
      return { success: false, error: 'All AI models failed' };
    }

    const scoreMap = {};
    validResults.forEach(({ label, score }) => {
      scoreMap[label] = (scoreMap[label] || 0) + score;
    });

    let bestLabel = 'uncategorized';
    let bestScore = 0;
    for (const [label, totalScore] of Object.entries(scoreMap)) {
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestLabel = label;
      }
    }

    const confidence = bestScore / models.length;
    const r2Key = `${bestLabel}/${detail.id}.jpg`;

    // Upload to R2
    await env.R2.put(r2Key, imgBuf, {
      httpMetadata: { contentType: 'image/jpeg' }
    });

    // Save to DB
    const saveTask = new SaveMetadataTask();
    await saveTask.run(env, {
      photoDetail: detail,
      category: bestLabel,
      confidence,
      r2Key
    });

    return { success: true, category: bestLabel };
  }
}
