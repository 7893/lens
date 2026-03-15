-- LENS Core Database Schema: 0000_init.sql

-- 1. Metadata & AI Index
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  raw_key TEXT NOT NULL,
  display_key TEXT NOT NULL,
  meta_json TEXT NOT NULL,
  ai_tags TEXT,
  ai_caption TEXT,
  ai_embedding TEXT,
  ai_model TEXT,
  ai_quality_score REAL,
  entities_json TEXT,
  created_at INTEGER NOT NULL,
  vectorize_synced INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_images_created_at ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_images_sync ON images(vectorize_synced) WHERE vectorize_synced = 0;
CREATE INDEX IF NOT EXISTS idx_images_model ON images(ai_model);

-- 2. System Configuration & State
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Seed Initial Config (Ingestion Boundary)
INSERT OR IGNORE INTO system_config (key, value, updated_at) 
VALUES ('last_seen_id', '', 1773571199000);

-- 3. Search Telemetry (Optional for Analytics)
CREATE TABLE IF NOT EXISTS search_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT NOT NULL,
  took INTEGER NOT NULL,
  results_count INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
