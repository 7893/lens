/**
 * ADR-0006 Canonical Data Entities
 */

export type AssetStatus = 'pending' | 'processing' | 'ready' | 'taken_down' | 'archived';

export interface AssetRecord {
  id: string;
  source_provider: string;
  source_external_id: string;
  status: AssetStatus;
  search_ready: number; // 0 or 1
  active_representation_version: string | null;
  active_embedding_version: string | null;
  active_index_generation: string | null;
  created_at: number;
  updated_at: number;
}

export interface AssetSourceRecord {
  provider: string;
  external_id: string;
  asset_id: string;
  canonical_url: string | null;
  author_name: string | null;
  author_url: string | null;
  license: string;
  retention_policy: string;
  raw_json: string | null;
  observed_at: number;
}

export type MediaVariantKind = 'master' | 'display' | 'thumbnail' | 'derived';

export interface MediaObjectRecord {
  content_hash: string;
  variant_kind: MediaVariantKind;
  r2_key: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  mime_type: string;
  created_at: number;
}

export interface RepresentationRecord {
  id: string;
  asset_id: string;
  representation_version: string;
  model_name: string;
  caption: string | null;
  tags_json: string | null;
  entities_json: string | null;
  quality_score: number | null;
  embedding_version: string | null;
  created_at: number;
}

export type ProcessingRunStatus = 'running' | 'completed' | 'failed';

export interface ProcessingRunRecord {
  run_id: string;
  asset_id: string;
  pipeline_version: string;
  status: ProcessingRunStatus;
  step_checkpoint: string | null;
  error_details: string | null;
  started_at: number;
  completed_at: number | null;
}

export interface OutboxEventRecord {
  event_id: string;
  type: string;
  schema_version: number;
  aggregate_type: string;
  aggregate_id: string;
  aggregate_version: number;
  correlation_id: string;
  causation_id: string | null;
  payload_json: string;
  occurred_at: number;
  dispatched_at: number | null;
}

export interface ConsumedEventRecord {
  consumer: string;
  event_id: string;
  consumed_at: number;
}
