import { ProcessorBindings, NEURON_COSTS } from '@lens/shared';

export { NEURON_COSTS };

function getTodayKey(): string {
  return `stats:neurons:${new Date().toISOString().slice(0, 10)}`;
}

export async function getTodayRemainingNeurons(env: ProcessorBindings): Promise<number> {
  const key = getTodayKey();
  const used = parseFloat((await env.SETTINGS.get(key)) || '0');
  return Math.max(0, NEURON_COSTS.DAILY_FREE_LIMIT - used - NEURON_COSTS.RESERVE_FOR_NEW_PHOTOS);
}

export async function recordNeuronUsage(env: ProcessorBindings, neurons: number): Promise<void> {
  const key = getTodayKey();
  const current = parseFloat((await env.SETTINGS.get(key)) || '0');
  await env.SETTINGS.put(key, String(current + neurons), { expirationTtl: 172800 });
}
