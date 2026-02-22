import { ProcessorBindings, IngestionTask } from '@lens/shared';

export async function handleQueue(batch: MessageBatch<IngestionTask>, env: ProcessorBindings): Promise<void> {
  for (const msg of batch.messages) {
    try {
      await env.PHOTO_WORKFLOW.create({
        id: `${msg.body.photoId}-${Date.now()}`,
        params: msg.body,
      });
      msg.ack();
    } catch (error) {
      console.error('Queue error:', error);
      msg.retry();
    }
  }
}
