import { ProcessorBindings, IngestionSettings, createTrace, Logger } from '@lens/shared';
import { IngestionService } from '../services/IngestionService';
import { EvolutionService } from '../services/EvolutionService';

/**
 * Main Cron Entry Point
 * Orchestrates periodic ingestion and daily self-evolution.
 */
export async function handleScheduled(env: ProcessorBindings) {
  const trace = createTrace('CRON');
  const logger = new Logger(trace, env.TELEMETRY);

  logger.info('Pulse Started');

  if (!env.UNSPLASH_API_KEY) {
    logger.error('Missing Unsplash API Key. Aborting.');
    return;
  }

  // 1. Load System Settings from KV
  const settingsRaw = await env.SETTINGS.get('config:ingestion');
  if (!settingsRaw) {
    logger.error('Missing config:ingestion in KV. Aborting.');
    return;
  }
  const settings = JSON.parse(settingsRaw) as IngestionSettings;

  // 2. Load Pipeline State from D1
  const configRows = await env.DB.prepare(
    "SELECT key, value FROM system_config WHERE key IN ('last_seen_id', 'backfill_next_page')"
  ).all<{ key: string; value: string }>();
  const state = Object.fromEntries(configRows.results.map((r) => [r.key, r.value]));

  const lastSeenId = state.last_seen_id || '';
  const backfillPage = parseInt(state.backfill_next_page || '1', 10);

  // --- TASK A: Ingestion Pipeline ---
  try {
    const ingestion = new IngestionService(env, logger);
    const count = await ingestion.run(lastSeenId, backfillPage, settings);
    logger.metric('cron_ingested', [count]);
  } catch (error) {
    logger.error('Ingestion Pipeline Failure', error);
  }

  // --- TASK B: Evolution Pipeline ---
  try {
    const evolution = new EvolutionService(env, logger);
    await evolution.pulse(settings);
  } catch (error) {
    logger.error('Evolution Pipeline Failure', error);
  }

  // --- TASK C: Cleanup & Finalize ---
  try {
    // Clear latest results cache periodically
    const { keys } = await env.SETTINGS.list({ prefix: 'cache:latest' });
    await Promise.all(keys.map((k) => env.SETTINGS.delete(k.name)));
  } catch (e) {
    logger.warn('Cache purge failed', e);
  }

  logger.info('Pulse Completed', { duration: Date.now() - trace.startTime });
}
