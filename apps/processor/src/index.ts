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

export default {
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext): Promise<void> {
    console.log('⏰ Cron triggered');
    if (!env.UNSPLASH_API_KEY) return;

    try {
      // ── Helper: batch enqueue photos ──
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
      // High Water Mark Strategy — only grab latest
      // ════════════════════════════════════
      const anchorRow = await env.DB.prepare("SELECT value FROM system_config WHERE key = 'last_seen_id'").first<{
        value: string;
      }>();
      const anchorId = anchorRow?.value || '';
      console.log(`📌 Anchor: ${anchorId || '(cold start)'}`);

      let totalNew = 0;
      let newAnchorId = '';

      for (let page = 1; page <= 50; page++) {
        const result = await fetchLatestPhotos(env.UNSPLASH_API_KEY, page, 30);
        if (!result.photos.length) break;

        // Find anchor in memory
        const anchorIdx = anchorId ? result.photos.findIndex((p) => p.id === anchorId) : -1;

        // Determine which photos to consider
        const candidates = anchorIdx === -1 ? result.photos : result.photos.slice(0, anchorIdx);

        if (candidates.length > 0) {
          // Filter out already existing photos
          const ids = candidates.map((p) => p.id);
          const ph = ids.map(() => '?').join(',');
          const existing = new Set(
            (await env.DB.prepare(`SELECT id FROM images WHERE id IN (${ph})`).bind(...ids).all<{ id: string }>())
              .results.map((r) => r.id),
          );
          const fresh = candidates.filter((p) => !existing.has(p.id));

          if (fresh.length > 0) {
            await enqueue(fresh);
            totalNew += fresh.length;
            // Update anchor to the newest photo we actually processed
            if (!newAnchorId) newAnchorId = candidates[0].id;
            console.log(`📦 Page ${page}: +${fresh.length} new (${candidates.length - fresh.length} existed)`);
          } else {
            console.log(`📦 Page ${page}: 0 new (${candidates.length} existed)`);
          }
        }

        if (anchorIdx !== -1) {
          console.log(`🛑 Hit anchor at page ${page} pos ${anchorIdx}`);
          break;
        }

        // Circuit breaker: stop if quota low
        if (result.remaining < 3) {
          console.log(`⚠️ Quota low (${result.remaining}), stopping`);
          break;
        }
      }

      // Update anchor only if we found new photos
      if (newAnchorId && newAnchorId !== anchorId) {
        await env.DB.prepare(
          "INSERT INTO system_config (key, value, updated_at) VALUES ('last_seen_id', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
          .bind(newAnchorId, Date.now())
          .run();
        console.log(`📌 Anchor updated: ${newAnchorId}`);
      }
      console.log(`✅ Done: +${totalNew} photos`);

      // ════════════════════════════════════
      // Vectorize catch-up sync
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
        console.log(`✅ Catch-up synced ${vectors.length} vectors`);
      }

      await env.DB.prepare(
        "INSERT INTO system_config (key, value, updated_at) VALUES ('vectorize_last_sync', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      )
        .bind(String(syncCutoff), Date.now())
        .run();
    } catch (error) {
      console.error('Scheduler error:', error);
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
      // Trigger Unsplash download tracking (API requirement)
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
