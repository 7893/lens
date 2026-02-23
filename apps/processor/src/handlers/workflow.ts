import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, ProcessorBindings } from '@lens/shared';
import { streamToR2 } from '../services/downloader';
import { analyzeImage, generateEmbedding } from '../services/ai';
import { buildEmbeddingText } from '../utils/embedding';

export class LensIngestWorkflow extends WorkflowEntrypoint<ProcessorBindings, IngestionTask> {
  async run(event: WorkflowEvent<IngestionTask>, step: WorkflowStep) {
    const task = event.payload;
    const { photoId, displayUrl, meta } = task;

    const exists = await step.do('check-exists', async () => {
      const row = await this.env.DB.prepare('SELECT id FROM images WHERE id = ?').bind(photoId).first();
      return !!row;
    });
    if (exists) return;

    const retryConfig = { retries: { limit: 10, delay: '30 seconds' as const, backoff: 'constant' as const } };

    await step.do('download-and-store', retryConfig, async () => {
      await streamToR2(task.downloadUrl, `raw/${photoId}.jpg`, this.env.R2);
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

    const analysis = await step.do('analyze-vision', retryConfig, async () => {
      const img = await this.env.R2.get(`display/${photoId}.jpg`);
      return await analyzeImage(this.env.AI, img!.body);
    });

    const vector = await step.do('generate-embedding', retryConfig, async () => {
      return await generateEmbedding(this.env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));
    });

    await step.do('persist-d1', retryConfig, async () => {
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

    await step.do('sync-vectorize', retryConfig, async () => {
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
