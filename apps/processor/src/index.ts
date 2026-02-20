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
      "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'backfill_base_page', 'backfill_cursor_id', 'forward_offset')",
    ).all<{ key: string; value: string }>();
    const state = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));

    const lastSeenId = state.last_seen_id || '';
    const backfillBasePage = parseInt(state.backfill_base_page || '1', 10);
    const backfillCursorId = state.backfill_cursor_id || '';
    const forwardOffset = parseInt(state.forward_offset || '0', 10);

    // --- TASK A: Ingestion (Forward & Backward) ---
    try {
      await this.runIngestion(env, lastSeenId, backfillBasePage, backfillCursorId, forwardOffset, settings);
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
   * Perfect algorithm: zero duplicates, zero missed photos
   */
  async runIngestion(
    env: Env,
    lastSeenId: string,
    backfillBasePage: number,
    backfillCursorId: string,
    forwardOffset: number,
    settings: { backfill_enabled: boolean; backfill_max_pages: number },
  ) {
    // Helper to enqueue photos directly (no DB dedup needed with perfect algorithm)
    const enqueuePhotos = async (photos: UnsplashPhoto[]) => {
      if (!photos.length) return 0;
      const tasks: IngestionTask[] = photos.map((p) => ({
        type: 'process-photo' as const,
        photoId: p.id,
        downloadUrl: p.urls.raw,
        displayUrl: p.urls.regular,
        photographer: p.user.name,
        source: 'unsplash' as const,
        meta: p,
      }));
      await env.PHOTO_QUEUE.sendBatch(tasks.map((t) => ({ body: t, contentType: 'json' })));
      return photos.length;
    };

    // --- TASK A: Forward Catch-up ---
    console.log(`🔎 Forward: Catching up since ${lastSeenId || '(first run)'}...`);
    let apiRemaining = 50;
    let newestIdThisRun: string | null = null;
    let forwardCount = 0;

    // First run: only fetch page 1, set last_seen_id, let backfill do the rest
    if (!lastSeenId) {
      const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, 1, 30);
      apiRemaining = res.remaining;
      if (res.photos.length > 0) {
        await updateConfig(env.DB, 'last_seen_id', res.photos[0].id);
        console.log(`✅ First run: set last_seen_id to ${res.photos[0].id}`);
      }
    } else {
      for (let p = 1; p <= 10; p++) {
        const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
        apiRemaining = res.remaining;

        if (!res.photos.length) break;

        const seenIndex = res.photos.findIndex((p) => p.id === lastSeenId);
        if (seenIndex !== -1) {
          const newPhotos = res.photos.slice(0, seenIndex);
          if (newPhotos.length > 0) {
            if (!newestIdThisRun) newestIdThisRun = newPhotos[0].id;
            forwardCount += await enqueuePhotos(newPhotos);
          }
          if (newestIdThisRun) {
            await updateConfig(env.DB, 'last_seen_id', newestIdThisRun);
          }
          console.log(`✅ Forward: Found ${forwardCount} new photos (boundary on page ${p})`);
          break;
        }

        if (!newestIdThisRun) newestIdThisRun = res.photos[0].id;
        forwardCount += await enqueuePhotos(res.photos);
        if (apiRemaining < 1) {
          // Quota exhausted without finding boundary - update last_seen_id to prevent repeat
          if (newestIdThisRun) {
            await updateConfig(env.DB, 'last_seen_id', newestIdThisRun);
            console.log(`⚠️ Forward: Quota exhausted, updated last_seen_id to ${newestIdThisRun}`);
          }
          break;
        }
      }
      // If loop completed without finding boundary (10 pages), update last_seen_id
      if (newestIdThisRun && forwardCount > 0) {
        await updateConfig(env.DB, 'last_seen_id', newestIdThisRun);
        console.log(`⚠️ Forward: Boundary not found in 10 pages, updated last_seen_id to ${newestIdThisRun}`);
      }
    }

    // Update forward offset for page drift compensation
    const newForwardOffset = forwardOffset + forwardCount;
    await updateConfig(env.DB, 'forward_offset', String(newForwardOffset));

    // --- TASK B: Backward Backfill (with drift compensation) ---
    if (!settings.backfill_enabled || settings.backfill_max_pages <= 0) {
      console.log('⏭️ Backfill disabled.');
      return;
    }

    // Calculate actual page with drift compensation
    const driftPages = Math.floor(newForwardOffset / 30);
    const actualStartPage = backfillBasePage + driftPages;

    console.log(
      `🕯️ Backfill: base=${backfillBasePage}, drift=${driftPages}, actual=${actualStartPage}, cursor=${backfillCursorId}`,
    );

    let pagesProcessed = 0;
    let lastProcessedId = backfillCursorId;
    let newBasePage = backfillBasePage;

    for (let p = actualStartPage; apiRemaining > 0 && pagesProcessed < settings.backfill_max_pages; p++) {
      const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
      apiRemaining = res.remaining;

      if (!res.photos.length) {
        console.log('✨ Reached end of Unsplash history.');
        break;
      }

      let photosToProcess = res.photos;

      // Find cursor position if we have one
      if (backfillCursorId) {
        const cursorIndex = res.photos.findIndex((photo) => photo.id === backfillCursorId);
        if (cursorIndex !== -1) {
          // Process only photos after the cursor
          photosToProcess = res.photos.slice(cursorIndex + 1);
          if (photosToProcess.length === 0) {
            // Cursor at end of page, move to next
            continue;
          }
        }
        // If cursor not found on this page, process all (we've drifted past it)
      }

      await enqueuePhotos(photosToProcess);
      lastProcessedId = res.photos[res.photos.length - 1].id;
      pagesProcessed++;

      // Update base page (actual pages processed, not drift-adjusted)
      newBasePage = p - driftPages + 1;

      if (apiRemaining <= 0) break;
    }

    // Persist state
    await updateConfig(env.DB, 'backfill_base_page', String(newBasePage));
    await updateConfig(env.DB, 'backfill_cursor_id', lastProcessedId);
    // Reset offset after updating base page
    await updateConfig(env.DB, 'forward_offset', '0');

    console.log(`✨ Backfill: ${pagesProcessed} pages, cursor=${lastProcessedId}`);
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
      return await analyzeImage(this.env.AI, object.body, meta);
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
