// AI Models
export const AI_MODELS = {
  TEXT: '@cf/meta/llama-4-scout-17b-16e-instruct',
  TEXT_FAST: '@cf/meta/llama-3.2-3b-instruct',
  EMBED: '@cf/baai/bge-m3',
  RERANK: '@cf/baai/bge-reranker-base',
} as const;

// AI Gateways: primary uses free daily allocation, fallback uses Unified Billing prepaid credits
export const AI_GATEWAY = { gateway: { id: 'lens-gateway' } };
export const AI_GATEWAY_PREPAID = { gateway: { id: 'lens-gateway-prepaid' } };
