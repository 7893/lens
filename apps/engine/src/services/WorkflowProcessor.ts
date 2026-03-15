import { ProcessorBindings, UnsplashPhoto, Logger } from '@lens/shared';
import { streamToR2 } from './downloader';
import { analyzeImage, generateEmbedding } from './ai';
import { buildEmbeddingText } from '../utils/embedding';

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
   * Downloads original and optimized versions of the image to R2.
   */
  async downloadAndStore(photoId: string, downloadUrl: string, displayUrl?: string, meta?: UnsplashPhoto) {
    // 1. Store Raw high-res
    await streamToR2(downloadUrl, `raw/${photoId}.jpg`, this.env.R2, this.logger);

    // 2. Store optimized display version
    if (displayUrl) {
      const displayResp = await fetch(displayUrl);
      if (displayResp.ok) {
        const buffer = await displayResp.arrayBuffer();
        await this.env.R2.put(`display/${photoId}.jpg`, buffer, {
          httpMetadata: { contentType: 'image/jpeg' },
        });
      }
    }

    // 3. Trigger Unsplash download location (API compliance)
    const dlUrl = meta?.links?.download_location;
    if (dlUrl) {
      await fetch(`${dlUrl}?client_id=${this.env.UNSPLASH_API_KEY}`);
    }
  }

  /**
   * Performs AI Vision analysis on the stored display asset.
   */
  async analyzeVision(photoId: string) {
    const img = await this.env.R2.get(`display/${photoId}.jpg`);
    if (!img) throw new Error(`Asset display/${photoId}.jpg not found in R2`);
    return await analyzeImage(this.env.AI, img.body, this.logger);
  }

  /**
   * Generates a 1024-dim embedding from AI analysis and metadata.
   */
  async generateVector(analysis: any, meta?: any) {
    const text = buildEmbeddingText(analysis.caption, analysis.tags, meta);
    return await generateEmbedding(this.env.AI, text);
  }

  /**
   * Persists flagship image metadata to D1.
   */
  async persistToD1(photoId: string, analysis: any, vector: number[], meta?: any) {
    const now = Date.now();
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
        vectorize_synced=0`,
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
  async syncToVectorize(photoId: string, vector: number[], caption: string) {
    await this.env.VECTORIZE.upsert([
      {
        id: photoId,
        values: vector,
        metadata: { url: `display/${photoId}.jpg`, caption: caption || '' },
      },
    ]);

    // Mark as synced in D1
    await this.env.DB.prepare('UPDATE images SET vectorize_synced = 1 WHERE id = ?').bind(photoId).run();
  }
}
