import { ProcessorBindings, NEURON_COSTS } from '@lens/shared';
import { analyzeImage, generateEmbedding } from './ai';
import { recordNeuronUsage } from './quota';
import { buildEmbeddingText } from '../utils/embedding';

export async function runSelfEvolution(env: ProcessorBindings, remainingNeurons: number) {
  const costPerImage = NEURON_COSTS.PER_IMAGE;
  const batchSize = Math.floor(remainingNeurons / costPerImage);

  if (batchSize <= 0) {
    console.log('📉 No neuron budget left for evolution today.');
    return;
  }

  console.log(`🧬 Self-Evolution: Attempting to refresh ${batchSize} images...`);

  const { results } = await env.DB.prepare(
    "SELECT * FROM images WHERE ai_model = 'llama-3.2' ORDER BY created_at DESC LIMIT ?",
  )
    .bind(batchSize)
    .all<{ id: string; meta_json: string }>();

  if (results.length === 0) {
    console.log('✨ All images are already on the flagship model.');
    return;
  }

  for (const img of results) {
    try {
      console.log(`🔄 Refreshing image: ${img.id}`);

      const object = await env.R2.get(`display/${img.id}.jpg`);
      if (!object) continue;

      const analysis = await analyzeImage(env.AI, object.body);
      const meta = JSON.parse(img.meta_json || '{}');
      const vector = await generateEmbedding(env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));

      await env.DB.prepare(
        `UPDATE images SET ai_caption = ?, ai_tags = ?, ai_embedding = ?, ai_model = ?, ai_quality_score = ?, entities_json = ? WHERE id = ?`,
      )
        .bind(
          analysis.caption,
          JSON.stringify(analysis.tags),
          JSON.stringify(vector),
          'llama-4-scout',
          analysis.quality,
          JSON.stringify(analysis.entities),
          img.id,
        )
        .run();

      await recordNeuronUsage(env, costPerImage);
    } catch (error) {
      console.error(`❌ Evolution failed for ${img.id}:`, error);
    }
  }

  console.log(`✅ Evolution batch completed.`);
}
