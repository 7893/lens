import { ProcessorBindings, IngestionTask, UnsplashPhoto, IngestionSettings } from '@lens/shared';
import { fetchLatestPhotos } from '../utils/unsplash';
import { setConfig } from '../utils/config';
import { calculateEvolutionCapacity } from '../services/billing';
import { createTrace, Logger } from '@lens/shared';

async function filterAndEnqueue(env: ProcessorBindings, photos: UnsplashPhoto[], logger: Logger) {
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
    logger.info(`Found ${freshPhotos.length} fresh photos. Enqueueing...`);
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
  logger: Logger,
) {
  let currentBackfillPage = backfillPage;
  let apiRemaining = 50;
  let newTopId: string | null = null;
  let hasAddedAny = false;

  logger.info(`Catching up since boundary: ${lastSeenId}`);

  // Forward catch-up
  for (let p = 1; p <= 10; p++) {
    const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
    apiRemaining = res.remaining;
    if (!res.photos.length) break;

    // Filter out sponsored photos which are pinned to the top and break the time-based boundary logic
    const realPhotos = res.photos.filter((p) => p.sponsorship === null || p.sponsorship === undefined);

    if (!realPhotos.length) continue;

    // Capture the absolute latest ID on the first page
    if (p === 1 && realPhotos[0].id !== lastSeenId) {
      newTopId = realPhotos[0].id;
    }

    const seenIndex = realPhotos.findIndex((photo) => photo.id === lastSeenId);
    if (seenIndex !== -1) {
      const freshOnPage = realPhotos.slice(0, seenIndex);
      if (freshOnPage.length > 0) {
        const result = await filterAndEnqueue(env, freshOnPage, logger);
        if (result.added > 0) hasAddedAny = true;
      }

      // CRITICAL: Only move the high-water mark if we successfully enqueued new photos
      if (newTopId && hasAddedAny) {
        await setConfig(env.DB, 'last_seen_id', newTopId);
        logger.info(`High-water mark advanced to: ${newTopId}`);
      }

      logger.info(`Boundary hit on page ${p}. Stop.`);
      break;
    }

    // No boundary found on this page, enqueue everything and continue
    const result = await filterAndEnqueue(env, realPhotos, logger);
    if (result.added > 0) hasAddedAny = true;

    if (apiRemaining < 1) break;
  }

  // Handle case where boundary wasn't found in 10 pages
  if (newTopId && hasAddedAny) {
    await setConfig(env.DB, 'last_seen_id', newTopId);
  }

  // Backward backfill
  if (!settings.backfill_enabled || settings.backfill_max_pages <= 0) return;

  logger.info(`Starting history backfill from page ${currentBackfillPage}`);
  let pagesProcessed = 0;
  while (apiRemaining > 0 && pagesProcessed < settings.backfill_max_pages) {
    const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, currentBackfillPage, 30);
    apiRemaining = res.remaining;
    if (!res.photos.length) break;

    await filterAndEnqueue(env, res.photos, logger);
    currentBackfillPage++;
    pagesProcessed++;
    await setConfig(env.DB, 'backfill_next_page', String(currentBackfillPage));
    if (apiRemaining <= 0) break;
  }
}

export async function handleScheduled(env: ProcessorBindings) {
  const trace = createTrace('CRON');
  const logger = new Logger(trace, env.TELEMETRY);

  logger.info('Scheduled Ingestion Pulse Started');

  if (!env.UNSPLASH_API_KEY) {
    logger.error('Missing Unsplash API Key. Aborting.');
    return;
  }

  // 1. Load system settings
  const settingsRaw = await env.SETTINGS.get('config:ingestion');
  if (!settingsRaw) {
    logger.error('Missing config:ingestion in KV. Aborting.');
    return;
  }
  const settings = JSON.parse(settingsRaw) as IngestionSettings;

  // 2. Load current state
  const configRows = await env.DB.prepare(
    "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'backfill_next_page')",
  ).all<{ key: string; value: string }>();
  const state = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));

  const lastSeenId = state.last_seen_id || '';
  const backfillPage = parseInt(state.backfill_next_page || '1', 10);

  // --- TASK A: Ingestion ---
  try {
    await runIngestion(env, lastSeenId, backfillPage, settings, logger);
  } catch (error) {
    logger.error('Ingestion Pipeline Failure', error);
  }

  // --- TASK C: Self-Evolution (Queue-Based Burst at 23:00 UTC) ---
  const now = new Date();
  if (now.getUTCHours() === 23 && now.getUTCMinutes() < 10) {
    try {
      const dailyLimit = settings.daily_evolution_limit_usd ?? 0.11;
      logger.info('🔍 Auditing daily system spend for evolution...');
      const capacity = await calculateEvolutionCapacity(env, dailyLimit, logger);

      if (capacity > 0) {
        logger.info(`🧬 Queueing ${capacity} images for self-evolution...`);
        const { results } = await env.DB.prepare(
          "SELECT id FROM images WHERE ai_model = 'llama-3.2' ORDER BY created_at DESC LIMIT ?",
        )
          .bind(capacity)
          .all<{ id: string }>();

        if (results.length > 0) {
          const tasks: IngestionTask[] = results.map((r) => ({
            type: 'refresh-photo',
            photoId: r.id,
          }));

          // Send in batches of 100 to the queue
          for (let i = 0; i < tasks.length; i += 100) {
            const batch = tasks.slice(i, i + 100);
            await env.PHOTO_QUEUE.sendBatch(batch.map((t) => ({ body: t, contentType: 'json' })));
          }
          logger.info(`✅ Successfully enqueued ${results.length} evolution tasks.`);
        } else {
          logger.info('✨ No images need evolution.');
        }
      }
    } catch (error) {
      logger.error('Evolution Task Failure', error);
    }
  }

  logger.info('Scheduled Pulse Completed', { duration: Date.now() - trace.startTime });
}
