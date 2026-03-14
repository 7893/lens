import { IngestionTask } from './types';

// Base bindings shared across all workers
export interface BaseBindings {
  DB: D1Database;
  R2: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SETTINGS: KVNamespace;
  TELEMETRY: AnalyticsEngineDataset;
}

// API worker bindings
export interface RateLimit {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ApiBindings extends BaseBindings {
  RATE_LIMITER: RateLimit;
}

// Processor worker bindings
export interface ProcessorBindings extends BaseBindings {
  PHOTO_QUEUE: Queue<IngestionTask>;
  PHOTO_WORKFLOW: Workflow;
  UNSPLASH_API_KEY: string;
  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;
}
