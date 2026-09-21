import { ProcessorBindings, IngestionTask, UnsplashPhoto, IngestionSettings, Logger } from '@lens/shared';
import { fetchLatestPhotos, UnsplashRateLimitError } from '../../utils/unsplash';
import { setConfig } from '../../utils/config';

export interface IngestionRunResult {
  totalAdded: number;
  rateLimited: boolean;
  resetTimeMs?: number;
  circuitOpen?: boolean;
}

/**
 * Service responsible for discovering new content from Unsplash
 * and managing the ingestion boundaries (high-water mark).
 * Includes Circuit Breaker pattern for API rate-limit resilience (KI-001).
 */
export class IngestionService {
  private static readonly CIRCUIT_KEY = 'circuit:unsplash:reset_until';

  constructor(
    private env: ProcessorBindings,
    private logger: Logger,
  ) {}

  /**
   * Checks if Unsplash API circuit breaker is active.
   */
  async isCircuitOpen(): Promise<{ open: boolean; resetTimeMs?: number }> {
    try {
      const resetUntilRaw = await this.env.SETTINGS.get(IngestionService.CIRCUIT_KEY);
      if (!resetUntilRaw) return { open: false };
      const resetTimeMs = Number(resetUntilRaw);
      const now = Date.now();
      if (now < resetTimeMs) {
        return { open: true, resetTimeMs };
      }
      // Expired, clear breaker key
      await this.env.SETTINGS.delete(IngestionService.CIRCUIT_KEY);
      return { open: false };
    } catch (err) {
      this.logger.warn('Failed to read circuit breaker state from SETTINGS', err);
      return { open: false };
    }
  }

  /**
   * Trips the circuit breaker until specified timestamp.
   */
  async tripCircuit(resetTimeMs: number): Promise<void> {
    try {
      const ttlSeconds = Math.max(60, Math.ceil((resetTimeMs - Date.now()) / 1000));
      await this.env.SETTINGS.put(IngestionService.CIRCUIT_KEY, String(resetTimeMs), {
        expirationTtl: ttlSeconds,
      });
      this.logger.warn(
        `🚨 Unsplash Circuit Breaker tripped. Blocking external ingestion until ${new Date(resetTimeMs).toISOString()}`,
      );
    } catch (err) {
      this.logger.error('Failed to persist circuit breaker trip state', err);
    }
  }

  /**
   * Main entry point for the ingestion pulse.
   */
  async run(lastSeenId: string, backfillPage: number, settings: IngestionSettings): Promise<IngestionRunResult> {
    const circuit = await this.isCircuitOpen();
    if (circuit.open) {
      this.logger.warn(
        `⏸️ Unsplash API Circuit Breaker is active until ${new Date(circuit.resetTimeMs!).toISOString()}. Skipping external fetch.`,
      );
      return {
        totalAdded: 0,
        rateLimited: true,
        resetTimeMs: circuit.resetTimeMs,
        circuitOpen: true,
      };
    }

    const currentBackfillPage = backfillPage;
    let apiRemaining = 50;
    let newTopId: string | null = null;
    let hasAddedAny = false;
    let totalAdded = 0;
    let rateLimited = false;
    let resetTimeMs: number | undefined;

    this.logger.info(`Catching up since boundary: ${lastSeenId}`);

    // Phase 1: Forward Catch-up (Latest -> Boundary)
    for (let p = 1; p <= 10; p++) {
      let res;
      try {
        res = await fetchLatestPhotos(this.env.UNSPLASH_API_KEY, p, 30, this.logger);
      } catch (err) {
        if (err instanceof UnsplashRateLimitError) {
          rateLimited = true;
          resetTimeMs = err.resetTimeMs;
          await this.tripCircuit(resetTimeMs);
          break;
        }
        throw err;
      }

      apiRemaining = res.remaining;
      if (res.remaining <= 0) {
        rateLimited = true;
        resetTimeMs = res.resetTimeMs;
        await this.tripCircuit(resetTimeMs);
      }

      if (!res.photos.length) break;

      // Ad-Filter: Skip sponsored content
      const realPhotos = res.photos.filter((p) => !p.sponsorship);
      if (!realPhotos.length) continue;

      if (p === 1 && realPhotos[0].id !== lastSeenId) {
        newTopId = realPhotos[0].id;
      }

      const seenIndex = realPhotos.findIndex((photo) => photo.id === lastSeenId);
      if (seenIndex !== -1) {
        const freshOnPage = realPhotos.slice(0, seenIndex);
        if (freshOnPage.length > 0) {
          const result = await this.filterAndEnqueue(freshOnPage);
          totalAdded += result.added;
          if (result.added > 0) hasAddedAny = true;
        }

        // Advance high-water mark if we found new photos
        if (newTopId && hasAddedAny) {
          await setConfig(this.env.DB, 'last_seen_id', newTopId);
          this.logger.info(`Boundary advanced: ${newTopId}`);
        }
        break;
      }

      const result = await this.filterAndEnqueue(realPhotos);
      totalAdded += result.added;
      if (result.added > 0) hasAddedAny = true;
      if (apiRemaining < 1) break;
    }

    // Safety update if boundary wasn't hit in 10 pages
    if (newTopId && hasAddedAny) {
      await setConfig(this.env.DB, 'last_seen_id', newTopId);
    }

    // Phase 2: Backward Backfill (History digging)
    if (!rateLimited && settings.backfill_enabled && settings.backfill_max_pages > 0) {
      const backfillResult = await this.runBackfill(currentBackfillPage, settings.backfill_max_pages, apiRemaining);
      totalAdded += backfillResult.added;
      if (backfillResult.rateLimited) {
        rateLimited = true;
        resetTimeMs = backfillResult.resetTimeMs;
      }
    }

    return {
      totalAdded,
      rateLimited,
      resetTimeMs,
      circuitOpen: rateLimited,
    };
  }

  private async runBackfill(
    startPage: number,
    maxPages: number,
    remainingApi: number,
  ): Promise<{ added: number; rateLimited: boolean; resetTimeMs?: number }> {
    this.logger.info(`Starting backfill from page ${startPage}`);
    let pagesProcessed = 0;
    let totalAdded = 0;
    let api = remainingApi;
    let currentPage = startPage;
    let rateLimited = false;
    let resetTimeMs: number | undefined;

    while (api > 0 && pagesProcessed < maxPages) {
      let res;
      try {
        res = await fetchLatestPhotos(this.env.UNSPLASH_API_KEY, currentPage, 30, this.logger);
      } catch (err) {
        if (err instanceof UnsplashRateLimitError) {
          rateLimited = true;
          resetTimeMs = err.resetTimeMs;
          await this.tripCircuit(resetTimeMs);
          break;
        }
        throw err;
      }

      api = res.remaining;
      if (res.remaining <= 0) {
        rateLimited = true;
        resetTimeMs = res.resetTimeMs;
        await this.tripCircuit(resetTimeMs);
      }

      if (!res.photos.length) break;

      const result = await this.filterAndEnqueue(res.photos);
      totalAdded += result.added;
      currentPage++;
      pagesProcessed++;

      await setConfig(this.env.DB, 'backfill_next_page', String(currentPage));
      if (api <= 0) break;
    }
    return { added: totalAdded, rateLimited, resetTimeMs };
  }

  private async filterAndEnqueue(photos: UnsplashPhoto[]) {
    if (!photos.length) return { added: 0 };

    const ids = photos.map((p) => p.id);
    const placeholders = ids.map(() => '?').join(',');
    const { results } = await this.env.DB.prepare(`SELECT id FROM images WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<{ id: string }>();

    const existingIds = new Set(results.map((r) => r.id));
    const freshPhotos = photos.filter((p) => !existingIds.has(p.id));

    if (freshPhotos.length > 0) {
      const tasks: IngestionTask[] = freshPhotos.map((p) => ({
        type: 'process-photo',
        photoId: p.id,
        downloadUrl: p.urls.raw,
        displayUrl: p.urls.regular,
        photographer: p.user.name,
        source: 'unsplash',
        meta: p,
      }));

      await this.env.PHOTO_QUEUE.sendBatch(tasks.map((t) => ({ body: t, contentType: 'json' })));
    }
    return { added: freshPhotos.length };
  }
}
