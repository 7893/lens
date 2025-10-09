CREATE TABLE IF NOT EXISTS JobState (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

INSERT OR IGNORE INTO JobState (key, value) VALUES ('last_processed_page', 0);

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
