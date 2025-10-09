CREATE TABLE IF NOT EXISTS State (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO State (key, value, updated_at) VALUES ('last_page', '0', datetime('now'));

CREATE TABLE IF NOT EXISTS Photos (
  unsplash_id TEXT PRIMARY KEY,
  slug TEXT,
  r2_key TEXT NOT NULL,
  downloaded_at TEXT NOT NULL,
  
  description TEXT,
  alt_description TEXT,
  blur_hash TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  likes INTEGER,
  
  created_at TEXT NOT NULL,
  updated_at TEXT,
  promoted_at TEXT,
  
  photographer_id TEXT NOT NULL,
  photographer_username TEXT NOT NULL,
  photographer_name TEXT NOT NULL,
  photographer_bio TEXT,
  photographer_location TEXT,
  photographer_portfolio_url TEXT,
  photographer_instagram TEXT,
  photographer_twitter TEXT,
  
  photo_location_name TEXT,
  photo_location_city TEXT,
  photo_location_country TEXT,
  photo_location_latitude REAL,
  photo_location_longitude REAL,
  
  exif_make TEXT,
  exif_model TEXT,
  exif_name TEXT,
  exif_exposure_time TEXT,
  exif_aperture TEXT,
  exif_focal_length TEXT,
  exif_iso INTEGER,
  
  tags TEXT,
  
  ai_category TEXT NOT NULL,
  ai_confidence REAL NOT NULL,
  ai_model_scores TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_category ON Photos(ai_category);
CREATE INDEX IF NOT EXISTS idx_downloaded_at ON Photos(downloaded_at);
CREATE INDEX IF NOT EXISTS idx_photographer_username ON Photos(photographer_username);
CREATE INDEX IF NOT EXISTS idx_location_country ON Photos(photo_location_country);
CREATE INDEX IF NOT EXISTS idx_exif_make ON Photos(exif_make);

CREATE TABLE IF NOT EXISTS GlobalStats (
  id INTEGER PRIMARY KEY DEFAULT 1,
  total_photos INTEGER DEFAULT 0,
  total_storage_bytes INTEGER DEFAULT 0,
  total_categories INTEGER DEFAULT 0,
  total_workflows INTEGER DEFAULT 0,
  successful_workflows INTEGER DEFAULT 0,
  failed_workflows INTEGER DEFAULT 0,
  total_downloads INTEGER DEFAULT 0,
  successful_downloads INTEGER DEFAULT 0,
  skipped_downloads INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO GlobalStats (id, updated_at) VALUES (1, datetime('now'));

CREATE TABLE IF NOT EXISTS CategoryStats (
  category TEXT PRIMARY KEY,
  photo_count INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS WorkflowRuns (
  id TEXT PRIMARY KEY,
  page INTEGER NOT NULL,
  status TEXT NOT NULL,
  photos_success INTEGER DEFAULT 0,
  photos_failed INTEGER DEFAULT 0,
  photos_skipped INTEGER DEFAULT 0,
  started_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS ApiQuota (
  api_name TEXT PRIMARY KEY,
  calls_used INTEGER DEFAULT 0,
  quota_limit INTEGER NOT NULL,
  next_reset_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO ApiQuota (api_name, quota_limit, next_reset_at, updated_at) 
VALUES ('unsplash', 50, datetime('now', '+1 hour'), datetime('now'));
