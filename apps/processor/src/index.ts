import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, UnsplashPhoto, DBImage } from '@pic/shared';
import { fetchRandomPhotos } from './utils/unsplash';
import { streamToR2 } from './services/downloader';
import { analyzeImage, generateEmbedding } from './services/ai';

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
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    console.log('⏰ Cron triggered');
    if (!env.UNSPLASH_API_KEY) return;

    try {
      // Maximize API usage: 30 photos per request (max allowed)
      const photos = await fetchRandomPhotos(env.UNSPLASH_API_KEY, 30);
      const tasks: IngestionTask[] = photos.map(photo => ({
        type: 'process-photo',
        photoId: photo.id,
        downloadUrl: photo.urls.raw, // Raw for storage
        // We add a display URL to the task for efficiency
        // @ts-ignore - dynamic property addition for internal use
        displayUrl: photo.urls.regular, 
        photographer: photo.user.name,
        source: 'unsplash',
        // @ts-ignore
        meta: photo // Pass full meta to workflow
      }));

      await env.PHOTO_QUEUE.sendBatch(tasks.map(task => ({ body: task, contentType: 'json' })));
      console.log(`✅ Enqueued ${tasks.length} tasks`);
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  },

  async queue(batch: MessageBatch<IngestionTask>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      if (msg.body.type === 'process-photo') {
        await env.PHOTO_WORKFLOW.create({
          id: msg.body.photoId,
          params: msg.body
        });
        msg.ack();
      }
    }
  }
};

export class PicIngestWorkflow extends WorkflowEntrypoint<Env, IngestionTask> {
  async run(event: WorkflowEvent<IngestionTask>, step: WorkflowStep) {
    const task = event.payload;
    const { photoId } = task;
    // @ts-ignore
    const displayUrl = task.displayUrl;
    // @ts-ignore
    const meta = task.meta as UnsplashPhoto;

    // Step 1: Download & Store (Parallel)
    await step.do('download-and-store', async () => {
      // 1. Stream Raw to R2 (Low memory usage)
      await streamToR2(task.downloadUrl, `raw/${photoId}.jpg`, this.env.R2);
      
      // 2. Fetch Display for R2 AND AI (Buffered)
      const displayResp = await fetch(displayUrl);
      const displayBuffer = await displayResp.arrayBuffer();
      
      // Save Display to R2
      await this.env.R2.put(`display/${photoId}.jpg`, displayBuffer, {
        httpMetadata: { contentType: 'image/jpeg' }
      });
      
      return { success: true };
    });

    // Step 2: AI Analysis (Vision)
    // We need to re-fetch the display image or pass it? 
    // Workflow steps must be serializable. We cannot pass Buffer between steps.
    // So we fetch again or read from R2. Reading from R2 is cheaper/faster (internal network).
    const analysis = await step.do('analyze-vision', async () => {
      const object = await this.env.R2.get(`display/${photoId}.jpg`);
      if (!object) throw new Error('Display image not found');
      
      return await analyzeImage(this.env.AI, object.body);
    });

    // Step 3: Embedding
    const vector = await step.do('generate-embedding', async () => {
      // Create a rich description for embedding
      const textToEmbed = `${analysis.caption} | Tags: ${analysis.tags.join(', ')} | Photographer: ${task.photographer}`;
      return await generateEmbedding(this.env.AI, textToEmbed);
    });

    // Step 4: Persist Metadata (D1)
    await step.do('persist-d1', async () => {
      await this.env.DB.prepare(`
        INSERT INTO images (id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET ai_caption = excluded.ai_caption
      `).bind(
        photoId,
        meta.width,
        meta.height,
        meta.color,
        `raw/${photoId}.jpg`,
        `display/${photoId}.jpg`,
        JSON.stringify(meta),
        JSON.stringify(analysis.tags),
        analysis.caption,
        Date.now()
      ).run();
    });

    // Step 5: Index Vector (Vectorize)
    await step.do('index-vector', async () => {
      await this.env.VECTORIZE.upsert([{
        id: photoId,
        values: vector,
        metadata: {
          url: `display/${photoId}.jpg`, // Store display URL directly in vector metadata for fast retrieval
          caption: analysis.caption
        }
      }]);
    });
  }
}
