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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_created_at ON images(created_at);

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
