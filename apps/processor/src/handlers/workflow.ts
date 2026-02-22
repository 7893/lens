import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { ProcessorBindings, IngestionTask, NEURON_COSTS } from '@lens/shared';
import { streamToR2 } from '../services/downloader';
import { analyzeImage, generateEmbedding } from '../services/ai';
import { buildEmbeddingText } from '../utils/embedding';
import { recordNeuronUsage } from '../services/quota';

const RETRY_CONFIG = { retries: { limit: 10, delay: '30 seconds' as const, backoff: 'constant' as const } };

export class LensIngestWorkflow extends WorkflowEntrypoint<ProcessorBindings, IngestionTask> {
  async run(event: WorkflowEvent<IngestionTask>, step: WorkflowStep) {
    const { photoId, displayUrl, meta } = event.payload;

    // Check if already exists
    const exists = await step.do('check-exists', async () => {
      const row = await this.env.DB.prepare('SELECT id FROM images WHERE id = ?').bind(photoId).first();
      return !!row;
    });
    if (exists) return;

    // Download and store
    await step.do('download-and-store', RETRY_CONFIG, async () => {
      await streamToR2(event.payload.downloadUrl, `raw/${photoId}.jpg`, this.env.R2);
      if (displayUrl) {
        const displayResp = await fetch(displayUrl);
        const displayBuffer = await displayResp.arrayBuffer();
        await this.env.R2.put(`display/${photoId}.jpg`, displayBuffer, {
          httpMetadata: { contentType: 'image/jpeg' },
        });
      }
      const dlUrl = meta?.links?.download_location;
      if (dlUrl) await fetch(`${dlUrl}?client_id=${this.env.UNSPLASH_API_KEY}`);
      return { success: true };
    });

    // Analyze with vision model
    const analysis = await step.do('analyze-vision', RETRY_CONFIG, async () => {
      const result = await analyzeImage(this.env.AI, (await this.env.R2.get(`display/${photoId}.jpg`))!.body);
      await recordNeuronUsage(this.env, NEURON_COSTS.PER_IMAGE);
      return result;
    });

    // Generate embedding
    const vector = await step.do('generate-embedding', RETRY_CONFIG, async () => {
      return await generateEmbedding(this.env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));
    });

    // Persist to D1
    await step.do('persist-d1', RETRY_CONFIG, async () => {
      await this.env.DB.prepare(
        `INSERT INTO images (id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_embedding, ai_model, ai_quality_score, entities_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET ai_caption=excluded.ai_caption, ai_embedding=excluded.ai_embedding, ai_model=excluded.ai_model, ai_quality_score=excluded.ai_quality_score, entities_json=excluded.entities_json, created_at=excluded.created_at`,
      )
        .bind(
          photoId,
          meta?.width ?? 0,
          meta?.height ?? 0,
          meta?.color ?? null,
          `raw/${photoId}.jpg`,
          `display/${photoId}.jpg`,
          JSON.stringify(meta ?? {}),
          JSON.stringify(analysis.tags),
          analysis.caption,
          JSON.stringify(vector),
          'llama-4-scout',
          analysis.quality,
          JSON.stringify(analysis.entities),
          Date.now(),
        )
        .run();
    });

    // Sync to Vectorize
    await step.do('sync-vectorize', RETRY_CONFIG, async () => {
      await this.env.VECTORIZE.upsert([
        {
          id: photoId,
          values: vector,
          metadata: { url: `display/${photoId}.jpg`, caption: analysis.caption || '' },
        },
      ]);
    });
  }
}
