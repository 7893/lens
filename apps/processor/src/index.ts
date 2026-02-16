import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, UnsplashPhoto } from '@pic/shared';
import { fetchRandomPhotos } from './utils/unsplash';
import { streamToR2 } from './services/downloader';
import { analyzeImage, generateEmbedding } from './services/ai';

interface VectorTask {
  type: 'index-vector';
  photoId: string;
  vector: number[];
  caption: string;
}

type QueueMessage = IngestionTask | VectorTask;

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  PHOTO_QUEUE: Queue<QueueMessage>;
  PHOTO_WORKFLOW: Workflow;
  UNSPLASH_API_KEY: string;
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('⏰ Cron triggered');
    if (!env.UNSPLASH_API_KEY) return;

    try {
      const photos = await fetchRandomPhotos(env.UNSPLASH_API_KEY, 30);
      const tasks: IngestionTask[] = photos.map(photo => ({
        type: 'process-photo' as const,
        photoId: photo.id,
        downloadUrl: photo.urls.raw,
        displayUrl: photo.urls.regular,
        photographer: photo.user.name,
        source: 'unsplash' as const,
        meta: photo
      }));

      await env.PHOTO_QUEUE.sendBatch(tasks.map(task => ({ body: task, contentType: 'json' })));
      console.log(`✅ Enqueued ${tasks.length} tasks`);
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  },

  async queue(batch: MessageBatch<QueueMessage>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        if (msg.body.type === 'process-photo') {
          await env.PHOTO_WORKFLOW.create({
            id: msg.body.photoId,
            params: msg.body
          });
        } else if (msg.body.type === 'index-vector') {
          const { photoId, vector, caption } = msg.body;
          await env.VECTORIZE.upsert([{
            id: photoId,
            values: vector,
            metadata: { url: `display/${photoId}.jpg`, caption }
          }]);
          console.log(`✅ Indexed vector for ${photoId}`);
        }
        msg.ack();
      } catch (error) {
        console.error(`Queue error for ${msg.body.type}:`, error);
        msg.retry();
      }
    }
  }
};

export class PicIngestWorkflow extends WorkflowEntrypoint<Env, IngestionTask> {
  async run(event: WorkflowEvent<IngestionTask>, step: WorkflowStep) {
    const task = event.payload;
    const { photoId } = task;
    const { displayUrl, meta } = task;

    await step.do('download-and-store', async () => {
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

    const analysis = await step.do('analyze-vision', async () => {
      const object = await this.env.R2.get(`display/${photoId}.jpg`);
      if (!object) throw new Error('Display image not found');
      return await analyzeImage(this.env.AI, object.body);
    });

    const vector = await step.do('generate-embedding', async () => {
      const text = `${analysis.caption} | Tags: ${analysis.tags.join(', ')} | Photographer: ${task.photographer}`;
      return await generateEmbedding(this.env.AI, text);
    });

    await step.do('persist-d1', async () => {
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

    // Send vector indexing to queue (queue handler has VECTORIZE binding)
    await step.do('enqueue-vector-index', async () => {
      await this.env.PHOTO_QUEUE.send({
        type: 'index-vector',
        photoId,
        vector,
        caption: analysis.caption
      } as VectorTask);
    });
  }
}
