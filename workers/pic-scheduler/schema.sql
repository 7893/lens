CREATE TABLE IF NOT EXISTS JobState (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO JobState (key, value) VALUES ('last_processed_page', 0);

CREATE TABLE IF NOT EXISTS Photos (
  unsplash_id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  downloaded_at TEXT NOT NULL,
  
  description TEXT,
  alt_description TEXT,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  color TEXT,
  likes INTEGER,
  photographer_name TEXT NOT NULL,
  photographer_username TEXT NOT NULL,
  photographer_url TEXT NOT NULL,
  unsplash_created_at TEXT NOT NULL,
  
  ai_category TEXT NOT NULL,
  ai_confidence REAL NOT NULL,
  ai_model_scores TEXT NOT NULL,
  
  exif_make TEXT,
  exif_model TEXT,
  exif_exposure_time TEXT,
  exif_f_number REAL,
  exif_focal_length REAL,
  exif_iso INTEGER,
  exif_datetime TEXT,
  exif_gps_lat REAL,
  exif_gps_lon REAL
);

CREATE INDEX IF NOT EXISTS idx_ai_category ON Photos(ai_category);
CREATE INDEX IF NOT EXISTS idx_downloaded_at ON Photos(downloaded_at);
CREATE INDEX IF NOT EXISTS idx_photographer ON Photos(photographer_username);
