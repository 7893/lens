import { ProcessorBindings, D1EvolutionRecord, Logger, createTrace } from '@lens/shared';
import { analyzeImage, generateEmbedding } from './ai';
import { calculateEvolutionCapacity } from './billing';
import { buildEmbeddingText } from '../utils/embedding';

async function evolveImage(env: ProcessorBindings, img: D1EvolutionRecord, logger: Logger): Promise<boolean> {
  const object = await env.R2.get(`display/${img.id}.jpg`);
  if (!object) return false;

  const analysis = await analyzeImage(env.AI, object.body, logger);
  const meta = JSON.parse(img.meta_json || '{}');
  const vector = await generateEmbedding(env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));

  await env.DB.prepare(
    `UPDATE images SET 
      ai_caption = ?, ai_tags = ?, ai_embedding = ?, ai_model = ?, ai_quality_score = ?, entities_json = ? 
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
  return true;
}

export async function runSelfEvolution(env: ProcessorBindings, dailyLimit: number) {
  const trace = createTrace('EVO');
  const logger = new Logger(trace, env.TELEMETRY);

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

  // Process in chunks of 3 for controlled concurrency
  const chunkSize = 3;
  let success = 0;
  for (let i = 0; i < results.length; i += chunkSize) {
    const chunk = results.slice(i, i + chunkSize);
    const outcomes = await Promise.allSettled(
      chunk.map((img) =>
        evolveImage(env, img, logger).then((ok) => {
          if (ok) logger.info(`🔄 Evolved: ${img.id}`);
          return ok;
        }),
      ),
    );
    success += outcomes.filter((o) => o.status === 'fulfilled' && o.value).length;
  }

  logger.info(`✅ Evolution completed: ${success}/${results.length}`);
  logger.metric('evolution_complete', [success, results.length]);
}
