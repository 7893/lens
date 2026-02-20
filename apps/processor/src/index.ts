import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, UnsplashPhoto } from '@lens/shared';
import { fetchLatestPhotos } from './utils/unsplash';
import { streamToR2 } from './services/downloader';
import { analyzeImage, generateEmbedding } from './services/ai';
import { buildEmbeddingText } from './utils/embedding';

export { buildEmbeddingText };

export interface Env {
  DB: D1Database;
  R2: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  PHOTO_QUEUE: Queue<IngestionTask>;
  PHOTO_WORKFLOW: Workflow;
  SETTINGS: KVNamespace;
  UNSPLASH_API_KEY: string;
}

async function updateConfig(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      'INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at',
    )
    .bind(key, value, Date.now())
    .run();
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('⏰ Greedy Ingestion Triggered');
    if (!env.UNSPLASH_API_KEY) return;

    // 1. Load system settings from KV
    const settingsRaw = await env.SETTINGS.get('config:ingestion');
    const settings = settingsRaw
      ? (JSON.parse(settingsRaw) as { backfill_enabled: boolean; backfill_max_pages: number })
      : { backfill_enabled: true, backfill_max_pages: 2 }; // Safe defaults

    // 2. Load current state from D1
    const configRows = await env.DB.prepare(
      "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'backfill_next_page')",
    ).all<{ key: string; value: string }>();
    const state = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));

    const lastSeenId = state.last_seen_id || '';
    const backfillPage = parseInt(state.backfill_next_page || '1', 10);

    // --- TASK A: Ingestion (Forward & Backward) ---
    try {
      await this.runIngestion(env, lastSeenId, backfillPage, settings);
    } catch (error) {
      console.error('💥 Ingestion Task failed:', error);
    }

    // --- TASK B: Vectorize Sync (Clearing the Backlog) ---
    try {
      await this.runVectorSync(env);
    } catch (error) {
      console.error('💥 Vector Sync Task failed:', error);
    }
  },

  /**
   * PHASE 1 & 2: Pulling data from Unsplash
   * Optimized for stable daily operation with strict quota control
   */
  async runIngestion(
    env: Env,
    lastSeenId: string,
    backfillPage: number,
    settings: { backfill_enabled: boolean; backfill_max_pages: number },
  ) {
    let currentBackfillPage = backfillPage;

    // Helper to check D1 and only enqueue brand new photos
    const filterAndEnqueue = async (photos: UnsplashPhoto[]) => {
      if (!photos.length) return { added: 0, hitExisting: false };
      const ids = photos.map((p) => p.id);
      const placeholders = ids.map(() => '?').join(',');
      const { results } = await env.DB.prepare(`SELECT id FROM images WHERE id IN (${placeholders})`)
        .bind(...ids)
        .all<{ id: string }>();

      const existingIds = new Set(results.map((r) => r.id));
      const freshPhotos = photos.filter((p) => !existingIds.has(p.id));
      const hitExisting = freshPhotos.length < photos.length;

      if (freshPhotos.length > 0) {
        const tasks: IngestionTask[] = freshPhotos.map((p) => ({
          type: 'process-photo' as const,
          photoId: p.id,
          downloadUrl: p.urls.raw,
          displayUrl: p.urls.regular,
          photographer: p.user.name,
          source: 'unsplash' as const,
          meta: p,
        }));
        await env.PHOTO_QUEUE.sendBatch(tasks.map((t) => ({ body: t, contentType: 'json' })));
      }
      return { added: freshPhotos.length, hitExisting };
    };

    // --- TASK A: Forward Catch-up (Serial, Precise) ---
    console.log(`🔎 Ingestion: Catching up since ${lastSeenId}...`);
    let apiRemaining = 50;
    let newestIdThisRun: string | null = null;

    for (let p = 1; p <= 10; p++) {
      const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
      apiRemaining = res.remaining;

      if (!res.photos.length) break;

      // Remember the newest ID from first page (will update anchor only after successful boundary hit)
      if (p === 1) {
        newestIdThisRun = res.photos[0].id;
      }

      // Check if lastSeenId is in current page (true boundary detection)
      const seenIndex = res.photos.findIndex((p) => p.id === lastSeenId);
      if (seenIndex !== -1) {
        // Only enqueue photos before the lastSeenId
        await filterAndEnqueue(res.photos.slice(0, seenIndex));
        // Now safe to update anchor - we found the boundary
        if (newestIdThisRun && newestIdThisRun !== lastSeenId) {
          await updateConfig(env.DB, 'last_seen_id', newestIdThisRun);
          console.log(`🌟 Top anchor advanced to: ${newestIdThisRun}`);
        }
        console.log(`✅ Forward boundary hit on page ${p}, found ${seenIndex} new photos.`);
        break;
      }

      // No boundary found, enqueue all and continue
      await filterAndEnqueue(res.photos);
      if (apiRemaining < 1) break;
    }

    // --- TASK B: Backward Backfill (Serial, Quota-Aware) ---
    if (!settings.backfill_enabled || settings.backfill_max_pages <= 0) {
      console.log('⏭️ Backfill is disabled or limit is 0. Skipping.');
      return;
    }

    console.log(
      `🕯️ Ingestion: Resuming backfill from page ${currentBackfillPage}... (Quota: ${apiRemaining}, Limit: ${settings.backfill_max_pages} pages)`,
    );

    let pagesProcessed = 0;
    while (apiRemaining > 0 && pagesProcessed < settings.backfill_max_pages) {
      const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, currentBackfillPage, 30);
      apiRemaining = res.remaining;

      if (!res.photos.length) {
        console.log('✨ Reached end of Unsplash history.');
        break;
      }

      await filterAndEnqueue(res.photos);

      currentBackfillPage++;
      pagesProcessed++;

      // Persist progress immediately for each page
      await updateConfig(env.DB, 'backfill_next_page', String(currentBackfillPage));

      if (apiRemaining <= 0) break;
    }
    console.log(`✨ Ingestion finished. Yield: ${pagesProcessed} pages backfilled.`);
  },

  /**
   * PHASE 3: Syncing D1 metadata to Vectorize Index
   */
  async runVectorSync(env: Env) {
    console.log('🔄 Sync: Synchronizing vectors to index...');
    let batchesProcessed = 0;

    while (batchesProcessed < 10) {
      const lastSyncConfig = await env.DB.prepare(
        "SELECT value FROM system_config WHERE key = 'vectorize_last_sync'",
      ).first<{ value: string }>();
      const lastSync = parseInt(lastSyncConfig?.value || '0', 10);

      const syncRows = await env.DB.prepare(
        'SELECT id, ai_caption, ai_embedding, created_at FROM images WHERE ai_embedding IS NOT NULL AND created_at > ? ORDER BY created_at ASC LIMIT 100',
      )
        .bind(lastSync)
        .all<{ id: string; ai_caption: string; ai_embedding: string; created_at: number }>();

      if (syncRows.results.length === 0) break;

      const vectors = syncRows.results
        .map((r) => {
          try {
            return {
              id: r.id,
              values: JSON.parse(r.ai_embedding),
              metadata: { url: `display/${r.id}.jpg`, caption: r.ai_caption || '' },
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as VectorizeVector[];

      await env.VECTORIZE.upsert(vectors);

      const newLastSync = syncRows.results[syncRows.results.length - 1].created_at;
      await updateConfig(env.DB, 'vectorize_last_sync', String(newLastSync));

      batchesProcessed++;
      console.log(`✅ Batch ${batchesProcessed}: Synced 100 vectors. Checkpoint: ${newLastSync}`);
    }

    if (batchesProcessed === 0) console.log('✨ Vectorize index is already up to date.');
  },

  async queue(batch: MessageBatch<IngestionTask>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await env.PHOTO_WORKFLOW.create({
          id: msg.body.photoId,
          params: msg.body,
        });
        msg.ack();
      } catch (error) {
        console.error(`Queue error:`, error);
        msg.retry();
      }
    }
  },
};

export class LensIngestWorkflow extends WorkflowEntrypoint<Env, IngestionTask> {
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
      const object = await this.env.R2.get(`display/${photoId}.jpg`);
      if (!object) throw new Error('Display image not found');
      return await analyzeImage(this.env.AI, object.body);
    });

    const vector = await step.do('generate-embedding', retryConfig, async () => {
      return await generateEmbedding(this.env.AI, buildEmbeddingText(analysis.caption, analysis.tags, meta));
    });

    await step.do('persist-d1', retryConfig, async () => {
      await this.env.DB.prepare(
        `
        INSERT INTO images (id, width, height, color, raw_key, display_key, meta_json, ai_tags, ai_caption, ai_embedding, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET ai_caption = excluded.ai_caption, ai_embedding = excluded.ai_embedding, created_at = excluded.created_at
      `,
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
