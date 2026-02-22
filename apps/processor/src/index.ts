import { ProcessorBindings, IngestionTask } from '@lens/shared';
import { handleScheduled } from './handlers/scheduled';
import { handleQueue } from './handlers/queue';

export { LensIngestWorkflow } from './handlers/workflow';
export { buildEmbeddingText } from './utils/embedding';

export default {
  async scheduled(_event: ScheduledEvent, env: ProcessorBindings, _ctx: ExecutionContext): Promise<void> {
    await handleScheduled(env);
  },

  async queue(batch: MessageBatch<IngestionTask>, env: ProcessorBindings): Promise<void> {
    await handleQueue(batch, env);
  },
};
