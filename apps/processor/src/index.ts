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
      // 1. Read high watermark (latest Unsplash created_at we've seen)
      const config = await env.DB.prepare("SELECT value FROM system_config WHERE key = 'unsplash_high_watermark'").first<{ value: string }>();
      const watermark = config?.value || '1970-01-01T00:00:00Z';
      console.log(`📌 High watermark: ${watermark}`);

      // 2. Collect known IDs at watermark boundary for dedup
      const knownIds = new Set<string>();
      if (watermark !== '1970-01-01T00:00:00Z') {
        const rows = await env.DB.prepare(
          "SELECT id FROM images WHERE json_extract(meta_json, '$.created_at') = ?"
        ).bind(watermark).all<{ id: string }>();
        for (const r of rows.results) knownIds.add(r.id);
      }

      // 3. Fetch latest photos, stop when we hit photos strictly older than watermark
      let totalEnqueued = 0;
      let newWatermark = watermark;
      let remaining = Infinity;
      const MAX_PAGES = 50;

      for (let page = 1; page <= MAX_PAGES && remaining > 0; page++) {
        const result = await fetchLatestPhotos(env.UNSPLASH_API_KEY, page, 30);
        remaining = result.remaining;
        if (!result.photos.length) break;

        let hitOld = false;
        const newPhotos = [];
        for (const photo of result.photos) {
          if (photo.created_at < watermark) { hitOld = true; break; }
          if (photo.created_at === watermark && knownIds.has(photo.id)) continue;
          newPhotos.push(photo);
          if (photo.created_at > newWatermark) newWatermark = photo.created_at;
        }

        if (newPhotos.length > 0) {
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
        }

        if (hitOld) {
          console.log(`🛑 Hit old photo at page ${page}, stopping`);
          break;
        }
      }

      // 3. Update high watermark
      if (newWatermark !== watermark) {
        await env.DB.prepare("INSERT INTO system_config (key, value, updated_at) VALUES ('unsplash_high_watermark', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
          .bind(newWatermark, Date.now()).run();
        console.log(`📌 Watermark updated: ${watermark} → ${newWatermark}`);
      }

      console.log(`✅ Total enqueued: ${totalEnqueued} new photos`);

      // 4. Backfill: use remaining quota to scan for gaps
      if (remaining > 2) {
        const scanPageConfig = await env.DB.prepare("SELECT value FROM system_config WHERE key = 'backfill_page'").first<{ value: string }>();
        let scanPage = parseInt(scanPageConfig?.value || '1', 10);
        let backfilled = 0;
        let consecutiveEmpty = 0;

        console.log(`🔄 Backfill starting at page ${scanPage}, remaining=${remaining}`);

        while (remaining > 2) {
          const result = await fetchLatestPhotos(env.UNSPLASH_API_KEY, scanPage, 30);
          remaining = result.remaining;
          if (!result.photos.length) break;

          // Batch check existing IDs for this page only
          const pageIds = result.photos.map(p => p.id);
          const placeholders = pageIds.map(() => '?').join(',');
          const existing = new Set(
            (await env.DB.prepare(`SELECT id FROM images WHERE id IN (${placeholders})`).bind(...pageIds).all<{ id: string }>()).results.map(r => r.id)
          );

          const gaps = result.photos.filter(p => !existing.has(p.id));
          if (gaps.length > 0) {
            consecutiveEmpty = 0;
            const tasks: IngestionTask[] = gaps.map(photo => ({
              type: 'process-photo' as const,
              photoId: photo.id,
              downloadUrl: photo.urls.raw,
              displayUrl: photo.urls.regular,
              photographer: photo.user.name,
              source: 'unsplash' as const,
              meta: photo
            }));
            await env.PHOTO_QUEUE.sendBatch(tasks.map(task => ({ body: task, contentType: 'json' })));
            backfilled += gaps.length;
          } else {
            consecutiveEmpty++;
          }

          console.log(`🔄 Backfill page ${scanPage}: +${gaps.length} gaps (remaining=${remaining})`);
          scanPage++;

          // Skip ahead if too many consecutive empty pages
          if (consecutiveEmpty >= 5) {
            scanPage += 10;
            consecutiveEmpty = 0;
            console.log(`⏩ Skipping ahead to page ${scanPage}`);
          }
        }

        await env.DB.prepare("INSERT INTO system_config (key, value, updated_at) VALUES ('backfill_page', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
          .bind(String(scanPage), Date.now()).run();
        console.log(`✅ Backfill done: ${backfilled} gaps filled, next page=${scanPage}`);
      }

      // 5. Incremental sync: D1 embeddings → Vectorize
      // Loop until all pending records are synced, waiting for async Workflows to settle
      let totalSynced = 0;
      for (let round = 0; round < 10; round++) {
        if (round > 0) await new Promise(r => setTimeout(r, 30_000)); // wait 30s for Workflows to finish

        const lastSyncConfig = await env.DB.prepare("SELECT value FROM system_config WHERE key = 'vectorize_last_sync'").first<{ value: string }>();
        const lastSync = parseInt(lastSyncConfig?.value || '0', 10);
        const syncCutoff = Date.now() - 30_000; // 30s lag for in-flight writes

        const syncRows = await env.DB.prepare(
          'SELECT id, ai_caption, ai_embedding FROM images WHERE ai_embedding IS NOT NULL AND created_at > ? AND created_at <= ?'
        ).bind(lastSync, syncCutoff).all<{ id: string; ai_caption: string; ai_embedding: string }>();

        if (!syncRows.results.length) break;

        const vectors = syncRows.results
          .map(r => {
            try {
              return { id: r.id, values: JSON.parse(r.ai_embedding), metadata: { url: `display/${r.id}.jpg`, caption: r.ai_caption || '' } };
            } catch { return null; }
          })
          .filter(Boolean) as VectorizeVector[];

        for (let i = 0; i < vectors.length; i += 100) {
          await env.VECTORIZE.upsert(vectors.slice(i, i + 100));
        }

        await env.DB.prepare("INSERT INTO system_config (key, value, updated_at) VALUES ('vectorize_last_sync', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at")
          .bind(String(syncCutoff), Date.now()).run();
        totalSynced += vectors.length;
        console.log(`🔄 Sync round ${round}: ${vectors.length} vectors`);
      }
      console.log(`✅ Vectorize sync done: ${totalSynced} total`);
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
        ON CONFLICT(id) DO UPDATE SET ai_caption = excluded.ai_caption, ai_embedding = excluded.ai_embedding, created_at = excluded.created_at
      `).bind(
        photoId, meta?.width ?? 0, meta?.height ?? 0, meta?.color ?? null,
        `raw/${photoId}.jpg`, `display/${photoId}.jpg`,
        JSON.stringify(meta ?? {}), JSON.stringify(analysis.tags),
        analysis.caption, JSON.stringify(vector), Date.now()
      ).run();
    });
  }
}
