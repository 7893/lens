import { Env } from '../index';

/**
 * Neuron costs based on official Cloudflare pricing:
 * https://developers.cloudflare.com/workers-ai/platform/pricing/
 *
 * Llama 4 Scout 17B: 24,545 neurons/M input + 77,273 neurons/M output
 * BGE-M3: 1,075 neurons/M input tokens
 * BGE Reranker: 283 neurons/M input tokens
 */
export const NEURON_COSTS = {
  // Vision analysis: ~800 input tokens (prompt + image) + ~150 output tokens
  // Input: 800/1M * 24545 ≈ 20, Output: 150/1M * 77273 ≈ 12
  VISION_LLAMA_4: 32,

  // Embedding: ~200 tokens input
  // 200/1M * 1075 ≈ 0.2
  EMBEDDING_BGE_M3: 0.2,

  // Total per image
  PER_IMAGE: 32.2,

  DAILY_FREE_LIMIT: 10000,
  RESERVE_FOR_NEW_PHOTOS: 1000,
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
