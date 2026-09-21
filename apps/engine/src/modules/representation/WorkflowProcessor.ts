import { ProcessorBindings, UnsplashPhoto, Logger, VisionResponse, formatYearMonth } from '@lens/shared';
import { streamToR2, analyzeImage, generateEmbedding } from '../../platform/cloudflare';
import { buildEmbeddingText } from '../../utils/embedding';

/**
 * Internal logic processor for Workflow steps.
 * Keeps individual steps clean and reusable.
 */
export class WorkflowProcessor {
  constructor(
    private env: ProcessorBindings,
    private logger: Logger,
  ) {}

  /**
   * Downloads original and optimized versions of the image to R2 partitioned by month.
   */
  async downloadAndStore(
    photoId: string,
    downloadUrl: string,
    displayUrl?: string,
    meta?: UnsplashPhoto,
  ): Promise<{ rawKey: string; displayKey: string }> {
    const yearMonth = formatYearMonth(meta?.created_at);
    const rawKey = `${yearMonth}/${photoId}.jpg`;
    const displayKey = `display/${yearMonth}/${photoId}.jpg`;

    // 1. Store Raw high-res at root monthly archive
    await streamToR2(downloadUrl, rawKey, this.env.R2, this.logger);

    // 2. Store optimized display version under display monthly archive
    if (displayUrl) {
      const displayResp = await fetch(displayUrl);
      if (displayResp.ok) {
        const buffer = await displayResp.arrayBuffer();
        await this.env.R2.put(displayKey, buffer, {
          httpMetadata: { contentType: 'image/jpeg' },
        });
      }
    }

    // 3. Trigger Unsplash download location (API compliance)
    const dlUrl = meta?.links?.download_location;
    if (dlUrl) {
      await fetch(`${dlUrl}?client_id=${this.env.UNSPLASH_API_KEY}`);
    }

    return { rawKey, displayKey };
  }

  /**
   * Performs AI Vision analysis on the stored display asset.
   */
  async analyzeVision(photoId: string, displayKey?: string) {
    let key = displayKey;
    let img = key ? await this.env.R2.get(key) : null;
    if (!img) {
      const row = await this.env.DB.prepare('SELECT display_key FROM images WHERE id = ?')
        .bind(photoId)
        .first<{ display_key: string }>();
      if (row?.display_key) {
        img = await this.env.R2.get(row.display_key);
        key = row.display_key;
      }
    }
    if (!img) {
      img = await this.env.R2.get(`display/${photoId}.jpg`);
      key = `display/${photoId}.jpg`;
    }
    if (!img) throw new Error(`Asset ${photoId} not found in R2 (tried ${key || `display/${photoId}.jpg`})`);

    const { result, telemetry } = await analyzeImage(this.env.AI, img.body, this.logger, photoId);

    this.logger.trackAI({
      photoId,
      model: telemetry.model,
      promptTokens: telemetry.promptTokens,
      completionTokens: telemetry.completionTokens,
      parseRetries: telemetry.parseRetries,
      isDegraded: telemetry.isDegraded,
    });

    return result;
  }

  /**
   * Generates a 1024-dim embedding from AI analysis and metadata.
   */
  async generateVector(analysis: VisionResponse, meta?: UnsplashPhoto) {
    const text = buildEmbeddingText(analysis.caption, analysis.tags, meta);
    return await generateEmbedding(this.env.AI, text);
  }

  /**
   * Persists flagship image metadata to D1.
   */
  async persistToD1(
    photoId: string,
    analysis: VisionResponse,
    vector: number[],
    meta?: UnsplashPhoto,
    keys?: { rawKey?: string; displayKey?: string },
  ) {
    const now = Date.now();
    const yearMonth = formatYearMonth(meta?.created_at || now);
    const rawKey = keys?.rawKey || `${yearMonth}/${photoId}.jpg`;
    const displayKey = keys?.displayKey || `display/${yearMonth}/${photoId}.jpg`;

    await this.env.DB.prepare(
      `INSERT INTO images (
        id, width, height, color, raw_key, display_key, meta_json, 
        ai_tags, ai_caption, ai_embedding, ai_model, ai_quality_score, 
        entities_json, created_at, vectorize_synced
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
      ON CONFLICT(id) DO UPDATE SET 
        ai_caption=excluded.ai_caption, 
        ai_embedding=excluded.ai_embedding, 
        ai_model=excluded.ai_model, 
        ai_quality_score=excluded.ai_quality_score, 
        entities_json=excluded.entities_json, 
        raw_key=COALESCE(images.raw_key, excluded.raw_key),
        display_key=COALESCE(images.display_key, excluded.display_key),
        vectorize_synced=0`,
    )
      .bind(
        photoId,
        meta?.width ?? 0,
        meta?.height ?? 0,
        meta?.color ?? null,
        rawKey,
        displayKey,
        JSON.stringify(meta ?? {}),
        JSON.stringify(analysis.tags),
        analysis.caption,
        JSON.stringify(vector),
        'llama-4-scout',
        analysis.quality,
        JSON.stringify(analysis.entities),
        now,
      )
      .run();
  }

  /**
   * Synchronizes the generated vector to the Vectorize index.
   */
  async syncToVectorize(photoId: string, vector: number[], caption: string, displayKey?: string) {
    const key = displayKey || `display/${photoId}.jpg`;
    await this.env.VECTORIZE.upsert([
      {
        id: photoId,
        values: vector,
        metadata: { url: key, caption: caption || '' },
      },
    ]);

    // Mark as synced in D1
    await this.env.DB.prepare('UPDATE images SET vectorize_synced = 1 WHERE id = ?').bind(photoId).run();
  }
}
