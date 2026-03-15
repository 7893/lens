import { ProcessorBindings, IngestionTask, IngestionSettings, Logger } from '@lens/shared';
import { calculateEvolutionCapacity } from './billing';

/**
 * Service responsible for the Self-Evolution cycle.
 * Audits budget and upgrades legacy image metadata to flagship models.
 */
export class EvolutionService {
  constructor(private env: ProcessorBindings, private logger: Logger) {}

  /**
   * Evaluates if a burst of evolution should occur.
   */
  async pulse(settings: IngestionSettings): Promise<void> {
    const now = new Date();
    const [triggerHour, triggerMinute] = (settings.evolution_trigger_utc ?? '23:00').split(':').map(Number);
    
    // Check if we are at the designated UTC hour/minute
    if (now.getUTCHours() !== triggerHour || now.getUTCMinutes() !== triggerMinute) {
      return;
    }

    try {
      const dailyLimit = settings.daily_evolution_limit_usd ?? 0.11;
      this.logger.info(`🧬 Audit Start: Daily Evolution Budget is $${dailyLimit}`);
      
      const capacity = await calculateEvolutionCapacity(this.env, dailyLimit, this.logger);

      if (capacity <= 0) {
        this.logger.info('💸 Budget exhausted for today. Skipping evolution.');
        return;
      }

      this.logger.info(`💎 Capacity: Can evolve ${capacity} images within budget.`);
      
      const { results } = await this.env.DB.prepare(
        "SELECT id FROM images WHERE (ai_model != 'llama-4-scout' OR ai_model IS NULL OR vectorize_synced = 0) ORDER BY created_at DESC LIMIT ?"
      )
        .bind(capacity)
        .all<{ id: string }>();

      if (results.length === 0) {
        this.logger.info('✨ All assets are already evolved to Llama 4 Scout.');
        return;
      }

      await this.dispatch(results.map(r => r.id));
      this.logger.info(`🚀 Enqueued ${results.length} evolution tasks.`);

    } catch (error) {
      this.logger.error('Evolution Pulse Failed', error);
      throw error;
    }
  }

  private async dispatch(ids: string[]): Promise<void> {
    const tasks: IngestionTask[] = ids.map((id) => ({
      type: 'refresh-photo',
      photoId: id,
    }));

    // Batch in chunks of 100 for queue efficiency
    for (let i = 0; i < tasks.length; i += 100) {
      const batch = tasks.slice(i, i + 100);
      await this.env.PHOTO_QUEUE.sendBatch(batch.map((t) => ({ 
        body: t, 
        contentType: 'json' 
      })));
    }
  }
}
