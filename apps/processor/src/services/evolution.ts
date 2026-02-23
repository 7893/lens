import { ProcessorBindings, D1EvolutionRecord, Logger, createTrace } from '@lens/shared';
import { analyzeImage, generateEmbedding } from './ai';
import { calculateEvolutionCapacity } from './billing';
import { buildEmbeddingText } from '../utils/embedding';

export async function runSelfEvolution(env: ProcessorBindings, dailyLimit: number) {
  const trace = createTrace('EVO');
  const logger = new Logger(trace);

  logger.info('🔍 Auditing daily system spend via GraphQL...');
  const batchSize = await calculateEvolutionCapacity(env, dailyLimit, logger);

  if (batchSize <= 0) {
    logger.info('🛑 Daily budget reached or API error. Skipping evolution.');
    return;
  }

  logger.info(`🧬 Evolution: Budget remaining for ${batchSize} images.`);

  const { results } = await env.DB.prepare(
    "SELECT id, meta_json FROM images WHERE ai_model = 'llama-3.2' ORDER BY created_at DESC LIMIT ?",
  )
    .bind(batchSize)
    .all<D1EvolutionRecord>();

  if (results.length === 0) {
    logger.info('✨ All images are already on the flagship model.');
    return;
  }

  for (const img of results) {
    try {
      logger.info(`🔄 Refreshing image: ${img.id}`);

      const object = await env.R2.get(`display/${img.id}.jpg`);
      if (!object) continue;

      const analysis = await analyzeImage(env.AI, object.body, logger);
      const meta = JSON.parse(img.meta_json || '{}');
      const vector = await generateEmbedding(env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));

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
    } catch (error) {
      logger.error(`❌ Evolution failed for ${img.id}:`, error);
    }
  }

  logger.info('✅ Evolution cycle completed.');
}
