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
  UNSPLASH_API_KEY: string;
}

async function updateConfig(db: D1Database, key: string, value: string) {
  await db
    .prepare(
      "INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key, value, Date.now())
    .run();
}

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('⏰ Greedy Ingestion Triggered');
    if (!env.UNSPLASH_API_KEY) return;

    try {
      // 1. Load current state
      const configRows = await env.DB.prepare(
        "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'backfill_next_page')",
      ).all<{ key: string; value: string }>();
      const state = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));

      let lastSeenId = state.last_seen_id || '';
      let backfillPage = parseInt(state.backfill_next_page || '1', 10);
      let apiRemaining = 50;

      const enqueue = async (photos: UnsplashPhoto[]) => {
        if (!photos.length) return;
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
      };

      // ════════════════════════════════════
      // PHASE 1: Forward Catch-up (The Newest)
      // ════════════════════════════════════
      console.log(`🔎 Phase 1: Checking for new photos since ${lastSeenId || 'forever'}...`);
      let totalNewFound = 0;

      for (let p = 1; p <= 10; p++) {
        const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
        apiRemaining = res.remaining;
        if (!res.photos.length) break;

        // Record the absolute newest ID immediately
        if (p === 1 && res.photos[0].id !== lastSeenId) {
          await updateConfig(env.DB, 'last_seen_id', res.photos[0].id);
          console.log(`🌟 Advanced top anchor to: ${res.photos[0].id}`);
        }

        const anchorIdx = lastSeenId ? res.photos.findIndex((x) => x.id === lastSeenId) : -1;

        if (anchorIdx !== -1) {
          const fresh = res.photos.slice(0, anchorIdx);
          await enqueue(fresh);
          totalNewFound += fresh.length;
          console.log(`✅ Caught up to present! Found ${fresh.length} new photos on page ${p}.`);
          break;
        } else {
          await enqueue(res.photos);
          totalNewFound += res.photos.length;
          if (res.remaining < 15) break;
        }
      }

      // ════════════════════════════════════
      // PHASE 2: Backward Backfill (The History)
      // ════════════════════════════════════
      // Correct for the shift caused by new photos added at the top
      const shift = Math.floor(totalNewFound / 30);
      backfillPage += shift;
      if (shift > 0) console.log(`🔄 Timeline shifted by ${shift} pages due to new photos.`);

      console.log(`🕯️ Phase 2: Diving into history. Starting from page ${backfillPage}...`);

      while (apiRemaining > 15) {
        const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, backfillPage, 30);
        apiRemaining = res.remaining;
        if (!res.photos.length) {
          console.log('🏁 Reached the end of Unsplash history (or no more results).');
          break;
        }

        await enqueue(res.photos);
        console.log(`📦 Backfilled page ${backfillPage} (+30 photos). Remaining Quota: ${apiRemaining}`);

        backfillPage++;
        // Persist progress after every successful page
        await updateConfig(env.DB, 'backfill_next_page', String(backfillPage));
      }

      console.log(`✅ Run complete. Next backfill start page: ${backfillPage}`);

      // ════════════════════════════════════
      // PHASE 3: Vectorize Sync
      // ════════════════════════════════════
      const lastSyncConfig = await env.DB.prepare(
        "SELECT value FROM system_config WHERE key = 'vectorize_last_sync'",
      ).first<{ value: string }>();
      const lastSync = parseInt(lastSyncConfig?.value || '0', 10);
      const syncCutoff = Date.now() - 30_000;

      const syncRows = await env.DB.prepare(
        'SELECT id, ai_caption, ai_embedding FROM images WHERE ai_embedding IS NOT NULL AND created_at > ? AND created_at <= ?',
      )
        .bind(lastSync, syncCutoff)
        .all<{ id: string; ai_caption: string; ai_embedding: string }>();

      if (syncRows.results.length > 0) {
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

        for (let i = 0; i < vectors.length; i += 100) {
          await env.VECTORIZE.upsert(vectors.slice(i, i + 100));
        }
        console.log(`✅ Synced ${vectors.length} vectors to index.`);
      }

      await updateConfig(env.DB, 'vectorize_last_sync', String(syncCutoff));
    } catch (error) {
      console.error('💥 Scheduler critical error:', error);
    }
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
