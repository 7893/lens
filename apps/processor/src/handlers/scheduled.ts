import { ProcessorBindings, IngestionTask, UnsplashPhoto, IngestionSettings } from '@lens/shared';
import { fetchLatestPhotos } from '../utils/unsplash';
import { setConfig } from '../utils/config';
import { runSelfEvolution } from '../services/evolution';
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

  logger.info(`Catching up since boundary: ${lastSeenId}`);

  // Forward catch-up
  for (let p = 1; p <= 10; p++) {
    const res = await fetchLatestPhotos(env.UNSPLASH_API_KEY, p, 30);
    apiRemaining = res.remaining;
    if (!res.photos.length) break;

    // Capture the absolute latest ID on the first page
    // But we will only commit it if the process doesn't crash
    if (p === 1 && res.photos[0].id !== lastSeenId) {
      newTopId = res.photos[0].id;
    }

    const seenIndex = res.photos.findIndex((photo) => photo.id === lastSeenId);
    if (seenIndex !== -1) {
      const freshOnPage = res.photos.slice(0, seenIndex);
      if (freshOnPage.length > 0) {
        await filterAndEnqueue(env, freshOnPage, logger);
      }

      // CRITICAL: Only move the high-water mark if we successfully enqueued everything up to the boundary
      if (newTopId) {
        await setConfig(env.DB, 'last_seen_id', newTopId);
        logger.info(`High-water mark advanced to: ${newTopId}`);
      }

      logger.info(`Boundary hit on page ${p}. Stop.`);
      break;
    }

    // No boundary found on this page, enqueue everything and continue
    await filterAndEnqueue(env, res.photos, logger);
    if (apiRemaining < 1) {
      // If we ran out of quota before hitting the boundary,
      // do NOT advance the global anchor yet to avoid holes.
      break;
    }
  }

  // If we processed all pages without finding the boundary, advance the anchor
  // This handles the case where the anchor is too old (beyond 10 pages)
  if (newTopId) {
    await setConfig(env.DB, 'last_seen_id', newTopId);
    logger.info(`High-water mark advanced to: ${newTopId} (boundary not found)`);
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

  // 1. Load system settings from KV (no defaults in code)
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

  // --- TASK C: Self-Evolution (UTC 23:00) ---
  const now = new Date();
  if (now.getUTCHours() === 23 && now.getUTCMinutes() < 10) {
    try {
      await runSelfEvolution(env, settings.daily_evolution_limit_usd);
    } catch (error) {
      logger.error('Evolution Pipeline Failure', error);
    }
  }

  logger.info('Scheduled Pulse Completed', { duration: Date.now() - trace.startTime });
}
