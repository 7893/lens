import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { IngestionTask, ProcessorBindings, createTrace, Logger } from '@lens/shared';
import { WorkflowProcessor } from '../services/WorkflowProcessor';

const RETRY_CONFIG = {
  retries: { limit: 10, delay: '30 seconds' as const, backoff: 'constant' as const },
};

/**
 * LENS Core Workflow Engine
 * Orchestrates the full lifecycle of an image (Ingestion & Evolution).
 */
export class LensIngestWorkflow extends WorkflowEntrypoint<ProcessorBindings, IngestionTask> {
  async run(event: WorkflowEvent<IngestionTask>, step: WorkflowStep) {
    const task = event.payload;
    const { photoId } = task;

    const trace = createTrace(`WF-${photoId}`);
    const logger = new Logger(trace, this.env.TELEMETRY);
    const processor = new WorkflowProcessor(this.env, logger);

    try {
      // --- BRANCH A: NEW IMAGE INGESTION ---
      if (task.type === 'process-photo') {
        const { downloadUrl, displayUrl, meta } = task;

        // 1. Existence Check
        const exists = await step.do('check-exists', async () => {
          const row = await this.env.DB.prepare('SELECT id FROM images WHERE id = ?').bind(photoId).first();
          return !!row;
        });
        if (exists) return;

        // 2. Resource Storage (R2)
        await step.do('download-and-store', RETRY_CONFIG, async () => {
          await processor.downloadAndStore(photoId, downloadUrl, displayUrl, meta);
        });

        // 3. AI Vision Analysis (Llama 4)
        const analysis = await step.do('analyze-vision-contract', RETRY_CONFIG, async () => {
          return await processor.analyzeVision(photoId);
        });

        // 4. Vector Generation (BGE-M3)
        const vector = await step.do('generate-embedding', RETRY_CONFIG, async () => {
          return await processor.generateVector(analysis, meta);
        });

        // 5. Database Persistance (D1)
        await step.do('persist-d1-flagship', RETRY_CONFIG, async () => {
          await processor.persistToD1(photoId, analysis, vector, meta);
        });

        // 6. Index Synchronization (Vectorize)
        await step.do('sync-vectorize', RETRY_CONFIG, async () => {
          await processor.syncToVectorize(photoId, vector, analysis.caption);
        });

        // 7. Housekeeping
        await step.do('cleanup-raw', async () => {
          await this.env.R2.delete(`raw/${photoId}.jpg`);
        });

        logger.info(`Successfully ingested image: ${photoId}`);
      }

      // --- BRANCH B: EXISTING IMAGE REFRESH (EVOLUTION) ---
      else if (task.type === 'refresh-photo') {
        // 1. AI Vision Re-Analysis
        const analysis = await step.do('evolution-analyze', RETRY_CONFIG, async () => {
          return await processor.analyzeVision(photoId);
        });

        // 2. Metadata Context Hydration
        const dbRecord = await step.do('get-meta', async () => {
          return await this.env.DB.prepare('SELECT meta_json FROM images WHERE id = ?')
            .bind(photoId)
            .first<{ meta_json: string }>();
        });
        const meta = JSON.parse(dbRecord?.meta_json || '{}');

        // 3. New Vector Generation
        const vector = await step.do('evolution-embed', RETRY_CONFIG, async () => {
          return await processor.generateVector(analysis, meta);
        });

        // 4. Update Database (Mark for re-sync)
        await step.do('evolution-persist', RETRY_CONFIG, async () => {
          await processor.persistToD1(photoId, analysis, vector, meta);
        });

        // 5. Update Search Index
        await step.do('evolution-sync-vectorize', RETRY_CONFIG, async () => {
          await processor.syncToVectorize(photoId, vector, analysis.caption);
        });

        logger.info(`✨ Successfully evolved image: ${photoId}`);
      }
    } catch (err) {
      logger.error(`Workflow Failure: ${photoId}`, err);
      throw err;
    }
  }
}
