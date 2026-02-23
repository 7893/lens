-- Initial Flagship Schema
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  raw_key TEXT NOT NULL,
  display_key TEXT NOT NULL,
  meta_json TEXT,
  ai_tags TEXT,
  ai_caption TEXT,
  ai_embedding TEXT,
  ai_model TEXT DEFAULT 'llama-3.2',
  ai_quality_score REAL DEFAULT 5.0,
  entities_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_created_at ON images(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_model ON images(ai_model);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at INTEGER
);
