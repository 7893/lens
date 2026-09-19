-- ADR-0006 Canonical Architecture Schema: 0003_v2_canonical_models.sql
-- Phase 2 Expand Phase: Add new normalized tables alongside legacy images table.

-- 1. Assets (Aggregate Root)
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  source_provider TEXT NOT NULL,
  source_external_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, processing, ready, taken_down, archived
  search_ready INTEGER NOT NULL DEFAULT 0,
  active_representation_version TEXT,
  active_embedding_version TEXT,
  active_index_generation TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_source ON assets(source_provider, source_external_id);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status, search_ready);
CREATE INDEX IF NOT EXISTS idx_assets_created_at ON assets(created_at DESC);

-- 2. Asset Sources (External attribution, license, and provenance)
CREATE TABLE IF NOT EXISTS asset_sources (
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  canonical_url TEXT,
  author_name TEXT,
  author_url TEXT,
  license TEXT NOT NULL DEFAULT 'Unsplash License',
  retention_policy TEXT NOT NULL DEFAULT 'standard',
  raw_json TEXT,
  observed_at INTEGER NOT NULL,
  PRIMARY KEY (provider, external_id)
);

CREATE INDEX IF NOT EXISTS idx_asset_sources_asset_id ON asset_sources(asset_id);

-- 3. Media Objects (Immutable content-addressed R2 artifacts)
CREATE TABLE IF NOT EXISTS media_objects (
  content_hash TEXT NOT NULL,
  variant_kind TEXT NOT NULL, -- master, display, thumbnail, derived
  r2_key TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (content_hash, variant_kind)
);

CREATE INDEX IF NOT EXISTS idx_media_objects_r2_key ON media_objects(r2_key);

-- 4. Representations (Multi-modal Captions, Tags, Embeddings)
CREATE TABLE IF NOT EXISTS representations (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  representation_version TEXT NOT NULL,
  model_name TEXT NOT NULL,
  caption TEXT,
  tags_json TEXT,
  entities_json TEXT,
  quality_score REAL,
  embedding_version TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_representations_asset ON representations(asset_id, representation_version);

-- 5. Processing Runs (Workflow execution audit)
CREATE TABLE IF NOT EXISTS processing_runs (
  run_id TEXT PRIMARY KEY, -- process:{assetId}:{pipelineVersion}
  asset_id TEXT NOT NULL REFERENCES assets(id),
  pipeline_version TEXT NOT NULL,
  status TEXT NOT NULL, -- running, completed, failed
  step_checkpoint TEXT,
  error_details TEXT,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_processing_runs_asset ON processing_runs(asset_id, started_at DESC);

-- 6. Transactional Outbox (Guaranteed event dispatch)
CREATE TABLE IF NOT EXISTS outbox_events (
  event_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  aggregate_type TEXT NOT NULL,
  aggregate_id TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL,
  correlation_id TEXT NOT NULL,
  causation_id TEXT,
  payload_json TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  dispatched_at INTEGER -- NULL if pending dispatch
);

CREATE INDEX IF NOT EXISTS idx_outbox_pending ON outbox_events(dispatched_at) WHERE dispatched_at IS NULL;

-- 7. Consumed Events (Consumer idempotency journal)
CREATE TABLE IF NOT EXISTS consumed_events (
  consumer TEXT NOT NULL,
  event_id TEXT NOT NULL,
  consumed_at INTEGER NOT NULL,
  PRIMARY KEY (consumer, event_id)
);
