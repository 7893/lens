import { ApiBindings, IngestionTask } from '@lens/shared';
import { app } from './entrypoints/http';
import { handleScheduled } from './entrypoints/scheduled';
import { handleQueue } from './entrypoints/queue';
import { withDatabase } from './platform/cloudflare';

export { LensIngestWorkflow } from './entrypoints/workflow';

export default {
  fetch(request: Request, env: ApiBindings, ctx: ExecutionContext) {
    return app.fetch(request, withDatabase(env), ctx);
  },

  async scheduled(_event: ScheduledEvent, env: ApiBindings, _ctx: ExecutionContext): Promise<void> {
    await handleScheduled(withDatabase(env));
  },

  async queue(batch: MessageBatch<IngestionTask>, env: ApiBindings): Promise<void> {
    await handleQueue(batch, withDatabase(env));
  },
};
