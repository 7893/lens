import { IngestionTask } from './types';

// Base bindings shared across all workers
export interface BaseBindings {
  DB: D1Database;
  R2: R2Bucket;
  VECTORIZE: VectorizeIndex;
  AI: Ai;
  SETTINGS: KVNamespace;
}

// API worker bindings (same as base for now)
export type ApiBindings = BaseBindings;

// Processor worker bindings
export interface ProcessorBindings extends BaseBindings {
  PHOTO_QUEUE: Queue<IngestionTask>;
  PHOTO_WORKFLOW: Workflow;
  UNSPLASH_API_KEY: string;
}
