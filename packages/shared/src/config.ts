// AI Models
export const AI_MODELS = {
  TEXT: '@cf/meta/llama-4-scout-17b-16e-instruct',
  EMBED: '@cf/baai/bge-m3',
  RERANK: '@cf/baai/bge-reranker-base',
} as const;

// AI Gateway
export const AI_GATEWAY = { gateway: { id: 'lens-gateway' } };

// Neuron costs
export const NEURON_COSTS = {
  VISION_LLAMA_4: 32,
  EMBEDDING_BGE_M3: 0.2,
  PER_IMAGE: 32.2,
  DAILY_FREE_LIMIT: 10000,
  RESERVE_FOR_NEW_PHOTOS: 1000,
} as const;
