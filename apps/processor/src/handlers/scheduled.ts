import { ProcessorBindings, IngestionTask, UnsplashPhoto } from '@lens/shared';
import { fetchLatestPhotos } from '../utils/unsplash';
import { setConfig } from '../utils/config';
import { getTodayRemainingNeurons } from '../services/quota';
import { runSelfEvolution } from '../services/evolution';

interface IngestionSettings {
  backfill_enabled: boolean;
  backfill_max_pages: number;
}

async function filterAndEnqueue(env: ProcessorBindings, photos: UnsplashPhoto[]) {
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
}

async function runIngestion(
  env: ProcessorBindings,
  lastSeenId: string,
  backfillPage: number,
  settings: IngestionSettings,
) {
  let currentBackfillPage = backfillPage;
  let apiRemaining = 50;
  let newTopId: string | null = null;

  // Forward catch-up
  console.log(`🔎 Ingestion: Catching up since ${lastSeenId}...`);
  for (let p = 1; p <= 10; p++) {
    const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
    apiRemaining = res.remaining;
    if (!res.photos.length) break;

    if (p === 1 && res.photos[0].id !== lastSeenId) {
      newTopId = res.photos[0].id;
    }

    const seenIndex = res.photos.findIndex((photo) => photo.id === lastSeenId);
    if (seenIndex !== -1) {
      const freshOnPage = res.photos.slice(0, seenIndex);
      if (freshOnPage.length > 0) await filterAndEnqueue(env, freshOnPage);
      console.log(`✅ Forward boundary hit on page ${p}, found ${freshOnPage.length} new photos.`);
      break;
    }

    await filterAndEnqueue(env, res.photos);
    if (apiRemaining < 1) break;
  }

  if (newTopId) {
    await setConfig(env.DB, 'last_seen_id', newTopId);
    console.log(`🌟 Global anchor advanced to: ${newTopId}`);
  }

  // Backward backfill
  if (!settings.backfill_enabled || settings.backfill_max_pages <= 0) return;

  console.log(`🕯️ Ingestion: Resuming backfill from page ${currentBackfillPage}...`);
  let pagesProcessed = 0;
  while (apiRemaining > 0 && pagesProcessed < settings.backfill_max_pages) {
    const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, currentBackfillPage, 30);
    apiRemaining = res.remaining;
    if (!res.photos.length) break;

    await filterAndEnqueue(env, res.photos);
    currentBackfillPage++;
    pagesProcessed++;
    await setConfig(env.DB, 'backfill_next_page', String(currentBackfillPage));
    if (apiRemaining <= 0) break;
  }
}

async function runVectorSync(env: ProcessorBindings) {
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
    await setConfig(env.DB, 'vectorize_last_sync', String(newLastSync));
    batchesProcessed++;
  }
}

export async function handleScheduled(env: ProcessorBindings): Promise<void> {
  console.log('⏰ Greedy Ingestion Triggered');
  if (!env.UNSPLASH_API_KEY) return;

  // Load settings
  const settingsRaw = await env.SETTINGS.get('config:ingestion');
  const settings: IngestionSettings = settingsRaw
    ? JSON.parse(settingsRaw)
    : { backfill_enabled: true, backfill_max_pages: 2 };

  // Load state
  const configRows = await env.DB.prepare(
    "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'backfill_next_page')",
  ).all<{ key: string; value: string }>();
  const state = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));
  const lastSeenId = state.last_seen_id || '';
  const backfillPage = parseInt(state.backfill_next_page || '1', 10);

  // Task A: Ingestion
  try {
    await runIngestion(env, lastSeenId, backfillPage, settings);
  } catch (error) {
    console.error('💥 Ingestion Task failed:', error);
  }

  // Task B: Vector Sync
  try {
    await runVectorSync(env);
  } catch (error) {
    console.error('💥 Vector Sync Task failed:', error);
  }

  // Task C: Self-Evolution (UTC 23:00)
  if (new Date().getUTCHours() === 23) {
    try {
      const remaining = await getTodayRemainingNeurons(env);
      if (remaining > 0) {
        console.log(`🧬 UTC 23:00 - Running self-evolution with ${remaining} neurons remaining`);
        await runSelfEvolution(env, remaining);
      }
    } catch (error) {
      console.error('🧬 Evolution Task failed:', error);
    }
  }
}
