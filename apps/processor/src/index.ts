import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, UnsplashPhoto } from '@lens/shared';
import { fetchLatestPhotos, fetchOldestPhotos } from './utils/unsplash';
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

      // ── Helper: blind write, returns count of actually new photos ──
      const blindWrite = async (photos: UnsplashPhoto[]) => {
        if (!photos.length) return 0;
        const ids = photos.map((p) => p.id);
        const ph = ids.map(() => '?').join(',');
        const existing = new Set(
          (
            await env.DB.prepare(`SELECT id FROM images WHERE id IN (${ph})`)
              .bind(...ids)
              .all<{ id: string }>()
          ).results.map((r) => r.id),
        );
        const fresh = photos.filter((p) => !existing.has(p.id));
        if (fresh.length > 0) await enqueue(fresh);
        return fresh.length;
      };

      // ════════════════════════════════════
      // Load config
      // ════════════════════════════════════
      const configRows = await env.DB.prepare(
        "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'oldest_page', 'head_oldest_ts')",
      ).all<{ key: string; value: string }>();
      const config = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));

      const anchorId = config['last_seen_id'] || '';
      const oldestPage = parseInt(config['oldest_page'] || '1', 10);
      const headOldestTs = parseInt(config['head_oldest_ts'] || '0', 10);

      console.log(`📌 Anchor: ${anchorId || '(cold start)'}, oldestPage: ${oldestPage}, headOldestTs: ${headOldestTs}`);

      // ════════════════════════════════════
      // Phase 1: Head sync (order_by=latest) — grab newest
      // ════════════════════════════════════
      let headNew = 0;
      let newAnchorId = '';
      let remaining = Infinity;
      let headOldestTsThisRun = Infinity;

      for (let page = 1; page <= 50 && remaining > 0; page++) {
        const result = await fetchLatestPhotos(env.UNSPLASH_API_KEY, page, 30);
        remaining = result.remaining;
        if (!result.photos.length) break;

        if (page === 1) newAnchorId = result.photos[0].id;

        // Find anchor in memory
        const anchorIdx = anchorId ? result.photos.findIndex((p) => p.id === anchorId) : -1;

        if (anchorIdx === -1) {
          // All photos are new
          await enqueue(result.photos);
          headNew += result.photos.length;
          // Track oldest timestamp from head
          const lastPhoto = result.photos[result.photos.length - 1];
          const ts = new Date(lastPhoto.created_at).getTime();
          if (ts < headOldestTsThisRun) headOldestTsThisRun = ts;
          console.log(`📦 Head p${page}: +${result.photos.length}`);
        } else {
          // Anchor found — only photos before it are new
          const newPhotos = result.photos.slice(0, anchorIdx);
          if (newPhotos.length > 0) {
            await enqueue(newPhotos);
            headNew += newPhotos.length;
          }
          console.log(`🛑 Hit anchor at page ${page} pos ${anchorIdx}, +${newPhotos.length}`);
          break;
        }
      }

      const now = Date.now();

      // Update anchor
      if (newAnchorId && newAnchorId !== anchorId) {
        await env.DB.prepare(
          "INSERT INTO system_config (key, value, updated_at) VALUES ('last_seen_id', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
          .bind(newAnchorId, now)
          .run();
      }
      // Update head_oldest_ts (for merge detection)
      if (headOldestTsThisRun < Infinity && headOldestTsThisRun < headOldestTs) {
        await env.DB.prepare(
          "INSERT INTO system_config (key, value, updated_at) VALUES ('head_oldest_ts', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
          .bind(String(headOldestTsThisRun), now)
          .run();
      }
      console.log(`✅ Head: +${headNew}`);

      // ════════════════════════════════════
      // Phase 2: Tail backfill (order_by=oldest) — static pages!
      // ════════════════════════════════════
      let tailNew = 0;
      let tailPage = oldestPage;
      let tailNewestTs = 0;

      // Use remaining quota for backfill
      while (remaining > 2) {
        const result = await fetchOldestPhotos(env.UNSPLASH_API_KEY, tailPage, 30);
        remaining = result.remaining;

        if (!result.photos.length) {
          console.log(`🏁 Tail reached end at page ${tailPage}`);
          break;
        }

        // Blind write
        const wrote = await blindWrite(result.photos);
        tailNew += wrote;

        // Track newest timestamp from tail (last photo is newest in oldest-order)
        const newestPhoto = result.photos[result.photos.length - 1];
        tailNewestTs = new Date(newestPhoto.created_at).getTime();

        console.log(`🔄 Tail p${tailPage}: +${wrote} (remaining=${remaining})`);
        tailPage++;

        // Merge check: if tail's newest >= head's oldest, we've met!
        const effectiveHeadTs = headOldestTsThisRun < Infinity ? headOldestTsThisRun : headOldestTs;
        if (effectiveHeadTs > 0 && tailNewestTs >= effectiveHeadTs) {
          console.log(
            `🎉 Merged! tail=${new Date(tailNewestTs).toISOString()} >= head=${new Date(effectiveHeadTs).toISOString()}`,
          );
          break;
        }
      }

      // Save tail progress
      if (tailPage > oldestPage) {
        await env.DB.prepare(
          "INSERT INTO system_config (key, value, updated_at) VALUES ('oldest_page', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        )
          .bind(String(tailPage), now)
          .run();
      }
      console.log(`✅ Tail: +${tailNew}, page=${tailPage}`);

      // ════════════════════════════════════
      // Phase 3: Vectorize catch-up sync
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
