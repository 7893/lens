import { ProcessorBindings, IngestionTask, Logger, createTrace } from '@lens/shared';

export async function handleQueue(batch: MessageBatch<IngestionTask>, env: ProcessorBindings): Promise<void> {
  const logger = new Logger(createTrace('QUEUE'), env.TELEMETRY);
  for (const msg of batch.messages) {
    try {
      await env.PHOTO_WORKFLOW.create({
        id: `${msg.body.photoId}-${Date.now()}`,
        params: msg.body,
      });
      msg.ack();
    } catch (error) {
      logger.error(`Queue dispatch failed: ${msg.body.photoId}`, error);
      logger.metric('queue_error');
      msg.retry();
    }
  }
}
