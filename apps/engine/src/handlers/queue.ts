import { ProcessorBindings, IngestionTask, Logger, createTrace } from '@lens/shared';

export async function handleQueue(batch: MessageBatch<IngestionTask>, env: ProcessorBindings): Promise<void> {
  const logger = new Logger(createTrace('QUEUE'), env.TELEMETRY);
  let dispatched = 0;
  for (const msg of batch.messages) {
    try {
      await env.PHOTO_WORKFLOW.create({
        id: `${msg.body.photoId}-${Date.now()}`,
        params: msg.body,
      });
      msg.ack();
      dispatched++;
    } catch (error) {
      logger.error(`Queue dispatch failed: ${msg.body.photoId}`, error);
      logger.metric('queue_error', [], [msg.body.photoId, msg.body.type, String(error).slice(0, 80)]);
      msg.retry();
    }
  }
  if (dispatched > 0) {
    logger.metric('queue_dispatched', [dispatched, batch.messages.length]);
  }
}
