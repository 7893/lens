import { ApiBindings, IngestionTask } from '@lens/shared';
import { app } from './entrypoints/http';
import { handleScheduled } from './entrypoints/scheduled';
import { handleQueue } from './entrypoints/queue';

export { LensIngestWorkflow } from './entrypoints/workflow';

export default {
  fetch: app.fetch,

  async scheduled(_event: ScheduledEvent, env: ApiBindings, _ctx: ExecutionContext): Promise<void> {
    await handleScheduled(env);
  },

  async queue(batch: MessageBatch<IngestionTask>, env: ApiBindings): Promise<void> {
    await handleQueue(batch, env);
  },
};
