import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, UnsplashPhoto } from '@lens/shared';
import { fetchLatestPhotos } from './utils/unsplash';
import { streamToR2 } from './services/downloader';
import { analyzeImage, generateEmbedding } from './services/ai';

export function buildEmbeddingText(caption: string, tags: string[], meta?: any): string {
  const parts = [caption];
  if (tags.length) parts.push(`Tags: ${tags.join(', ')}`);
  if (meta?.alt_description) parts.push(meta.alt_description);
  if (meta?.description) parts.push(meta.description);
  if (meta?.user?.name) parts.push(`Photographer: ${meta.user.name}`);
  if (meta?.location?.name) parts.push(`Location: ${meta.location.name}`);
  const topics = Object.keys(meta?.topic_submissions || {});
  if (topics.length) parts.push(`Topics: ${topics.join(', ')}`);
  return parts.join(' | ');
}

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  PHOTO_QUEUE: Queue<IngestionTask>;
  PHOTO_WORKFLOW: Workflow;
  UNSPLASH_API_KEY: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('⏰ Cron triggered');
    if (!env.UNSPLASH_API_KEY) return;

    try {
      // 1. Get latest known image ID
      const latest = await env.DB.prepare('SELECT id FROM images ORDER BY created_at DESC LIMIT 1').first<{ id: string }>();
      const lastId = latest?.id;
      console.log(`📌 Last synced ID: ${lastId || 'none'}`);

      // 2. Fetch latest photos, page by page until we hit known images
      let totalEnqueued = 0;
      let emptyPages = 0;
      const MAX_PAGES = 50;

      for (let page = 1; page <= MAX_PAGES; page++) {
        const photos = await fetchLatestPhotos(env.UNSPLASH_API_KEY, page, 30);
        if (!photos.length) break;

        // Filter out already-known photos
        let hitLast = false;
        const newPhotos = [];
        for (const photo of photos) {
          if (photo.id === lastId) { hitLast = true; break; }
          newPhotos.push(photo);
        }

        if (newPhotos.length > 0) {
          emptyPages = 0;
          const tasks: IngestionTask[] = newPhotos.map(photo => ({
            type: 'process-photo' as const,
            photoId: photo.id,
            downloadUrl: photo.urls.raw,
            displayUrl: photo.urls.regular,
            photographer: photo.user.name,
            source: 'unsplash' as const,
            meta: photo
          }));
          await env.PHOTO_QUEUE.sendBatch(tasks.map(task => ({ body: task, contentType: 'json' })));
          totalEnqueued += newPhotos.length;
          console.log(`📦 Page ${page}: enqueued ${newPhotos.length} new photos`);
        } else {
          emptyPages++;
        }

        if (hitLast || emptyPages >= 2) {
          console.log(`🛑 Stopping at page ${page} (hitLast=${hitLast}, emptyPages=${emptyPages})`);
          break;
        }
      }

      console.log(`✅ Total enqueued: ${totalEnqueued} new photos`);

      // 2. Sync D1 embeddings → Vectorize (idempotent)
      const rows = await env.DB.prepare(
        'SELECT id, ai_caption, ai_embedding FROM images WHERE ai_embedding IS NOT NULL'
      ).all<{ id: string; ai_caption: string; ai_embedding: string }>();

      const vectors = rows.results
        .map(r => {
          try {
            return { id: r.id, values: JSON.parse(r.ai_embedding), metadata: { url: `display/${r.id}.jpg`, caption: r.ai_caption || '' } };
          } catch { return null; }
        })
        .filter(Boolean) as VectorizeVector[];

      for (let i = 0; i < vectors.length; i += 100) {
        await env.VECTORIZE.upsert(vectors.slice(i, i + 100));
      }
      console.log(`✅ Synced ${vectors.length} vectors to Vectorize`);
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  },

  async queue(batch: MessageBatch<IngestionTask>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await env.PHOTO_WORKFLOW.create({
          id: msg.body.photoId,
          params: msg.body
        });
        msg.ack();
      } catch (error) {
        console.error(`Queue error:`, error);
        msg.retry();
      }
    }
  }
};

export class LensIngestWorkflow extends WorkflowEntrypoint<Env, IngestionTask> {
  async run(event: WorkflowEvent<IngestionTask>, step: WorkflowStep) {
    const task = event.payload;
    const { photoId, displayUrl, meta } = task;

    const retryConfig = { retries: { limit: 10, delay: '30 seconds', backoff: 'constant' as const } };

    await step.do('download-and-store', retryConfig, async () => {
      await streamToR2(task.downloadUrl, `raw/${photoId}.jpg`, this.env.R2);
      if (displayUrl) {
        const displayResp = await fetch(displayUrl);
        const displayBuffer = await displayResp.arrayBuffer();
        await this.env.R2.put(`display/${photoId}.jpg`, displayBuffer, {
          httpMetadata: { contentType: 'image/jpeg' }
        });
      }
      return { success: true };
    });

    const analysis = await step.do('analyze-vision', retryConfig, async () => {
      const object = await this.env.R2.get(`display/${photoId}.jpg`);
      if (!object) throw new Error('Display image not found');
      return await analyzeImage(this.env.AI, object.body);
    });

    const vector = await step.do('generate-embedding', retryConfig, async () => {
      return await generateEmbedding(this.env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));
    });

    await step.do('persist-d1', retryConfig, async () => {
      await this.env.DB.prepare(`
        INSERT INTO images (id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET ai_caption = excluded.ai_caption, ai_embedding = excluded.ai_embedding
      `).bind(
        photoId, meta?.width ?? 0, meta?.height ?? 0, meta?.color ?? null,
        `raw/${photoId}.jpg`, `display/${photoId}.jpg`,
        JSON.stringify(meta ?? {}), JSON.stringify(analysis.tags),
        analysis.caption, JSON.stringify(vector), Date.now()
      ).run();
    });
  }
}
