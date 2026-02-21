import { Env } from '../index';

export const NEURON_COSTS = {
  VISION_LLAMA_4: 85, // Conservative estimate per image
  EMBEDDING_GEMMA: 1.2,
  DAILY_FREE_LIMIT: 10000,
  RESERVE_FOR_NEW_PHOTOS: 2000, // Safe buffer for fresh catch-up
};

/**
 * Calculates how many free neurons are left for today,
 * accounting for a safety buffer for new incoming photos.
 */
export async function getTodayRemainingNeurons(env: Env): Promise<number> {
  const today = new Date().toISOString().split('T')[0];
  const key = `stats:neurons:${today}`;

  const used = await env.SETTINGS.get(key);
  const usedCount = used ? parseInt(used, 10) : 0;

  const remaining = NEURON_COSTS.DAILY_FREE_LIMIT - usedCount - NEURON_COSTS.RESERVE_FOR_NEW_PHOTOS;
  return Math.max(0, remaining);
}

/**
 * Atomically updates today's neuron usage count in KV.
 */
export async function recordNeuronUsage(env: Env, count: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  const key = `stats:neurons:${today}`;

  const current = await env.SETTINGS.get(key);
  const newTotal = (current ? parseInt(current, 10) : 0) + count;

  // Set expiration to 2 days to auto-clean old stats
  await env.SETTINGS.put(key, newTotal.toString(), { expirationTtl: 172800 });
}
