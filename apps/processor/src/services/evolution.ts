import { ProcessorBindings } from '@lens/shared';
import { analyzeImage, generateEmbedding } from './ai';
import { calculateEvolutionCapacity } from './billing';
import { buildEmbeddingText } from '../utils/embedding';

interface D1EvolutionRecord {
  id: string;
  meta_json: string;
}

/**
 * Flagship Self-Evolution using official Cloudflare Billing API.
 * Replaces the legacy manual neuron counter.
 */
export async function runSelfEvolution(env: ProcessorBindings, dailyLimit: number) {
  console.log('🔍 Auditing daily system spend via GraphQL...');
  const batchSize = await calculateEvolutionCapacity(env, dailyLimit);

  if (batchSize <= 0) {
    console.log('🛑 Daily budget reached or API error. Skipping evolution.');
    return;
  }

  console.log(`🧬 Evolution: Budget remaining for ${batchSize} images.`);

  // 2. Query D1 for old version images
  const { results } = await env.DB.prepare(
    "SELECT id, meta_json FROM images WHERE ai_model = 'llama-3.2' ORDER BY created_at DESC LIMIT ?",
  )
    .bind(batchSize)
    .all<D1EvolutionRecord>();

  if (results.length === 0) {
    console.log('✨ All images are already on the flagship model.');
    return;
  }

  // 3. Process each image
  for (const img of results) {
    try {
      console.log(`🔄 Refreshing image: ${img.id}`);

      const object = await env.R2.get(`display/${img.id}.jpg`);
      if (!object) continue;

      const analysis = await analyzeImage(env.AI, object.body);
      const meta = JSON.parse(img.meta_json || '{}');
      const vector = await generateEmbedding(env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));

      // 4. Update D1 with flagship data (Idempotent)
      await env.DB.prepare(
        `UPDATE images SET 
          ai_caption = ?, 
          ai_tags = ?, 
          ai_embedding = ?, 
          ai_model = ?, 
          ai_quality_score = ?, 
          entities_json = ? 
         WHERE id = ?`,
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

      // Note: No need to manually record usage.
      // The Cloudflare Billing API will reflect this in the next poll.
    } catch (error) {
      console.error(`❌ Evolution failed for ${img.id}:`, error);
    }
  }

  console.log(`✅ Evolution cycle completed.`);
}
