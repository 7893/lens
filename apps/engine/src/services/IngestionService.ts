import { ProcessorBindings, IngestionTask, UnsplashPhoto, IngestionSettings, Logger } from '@lens/shared';
import { fetchLatestPhotos } from '../utils/unsplash';
import { setConfig } from '../utils/config';

/**
 * Service responsible for discovering new content from Unsplash
 * and managing the ingestion boundaries (high-water mark).
 */
export class IngestionService {
  constructor(private env: ProcessorBindings, private logger: Logger) {}

  /**
   * Main entry point for the ingestion pulse.
   */
  async run(lastSeenId: string, backfillPage: number, settings: IngestionSettings): Promise<number> {
    let currentBackfillPage = backfillPage;
    let apiRemaining = 50;
    let newTopId: string | null = null;
    let hasAddedAny = false;
    let totalAdded = 0;

    this.logger.info(`Catching up since boundary: ${lastSeenId}`);

    // Phase 1: Forward Catch-up (Latest -> Boundary)
    for (let p = 1; p <= 10; p++) {
      const res = await fetchLatestPhotos(this.env.UNSPLASH_API_KEY, p, 30, this.logger);
      apiRemaining = res.remaining;
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
    if (settings.backfill_enabled && settings.backfill_max_pages > 0) {
      totalAdded += await this.runBackfill(currentBackfillPage, settings.backfill_max_pages, apiRemaining);
    }

    return totalAdded;
  }

  private async runBackfill(startPage: number, maxPages: number, remainingApi: number): Promise<number> {
    this.logger.info(`Starting backfill from page ${startPage}`);
    let pagesProcessed = 0;
    let totalAdded = 0;
    let api = remainingApi;
    let currentPage = startPage;

    while (api > 0 && pagesProcessed < maxPages) {
      const res = await fetchLatestPhotos(this.env.UNSPLASH_API_KEY, currentPage, 30, this.logger);
      api = res.remaining;
      if (!res.photos.length) break;

      const result = await this.filterAndEnqueue(res.photos);
      totalAdded += result.added;
      currentPage++;
      pagesProcessed++;
      
      await setConfig(this.env.DB, 'backfill_next_page', String(currentPage));
      if (api <= 0) break;
    }
    return totalAdded;
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
