-- 任务状态表
CREATE TABLE IF NOT EXISTS JobState (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

-- 初始化页码
INSERT OR IGNORE INTO JobState (key, value) VALUES ('last_processed_page', 0);

-- 图片元数据表
CREATE TABLE IF NOT EXISTS Photos (
  -- 核心标识符
  unsplash_id TEXT PRIMARY KEY,
  r2_key TEXT NOT NULL,
  downloaded_at TEXT NOT NULL,

  -- 1. Unsplash API 元数据
  description TEXT,
  alt_description TEXT,
  width INTEGER,
  height INTEGER,
  color TEXT,
  likes INTEGER,
  photographer_name TEXT NOT NULL,
  photographer_url TEXT NOT NULL,
  unsplash_created_at TEXT,
  tags TEXT,

  -- 2. AI 分类元数据（置信度加权）
  primary_category TEXT NOT NULL,
  category_confidence REAL,
  model_scores TEXT,

  -- 3. EXIF 元数据
  camera_make TEXT,
  camera_model TEXT,
  exposure_time TEXT,
  f_number REAL,
  focal_length REAL,
  iso INTEGER,
  taken_at TEXT,
  gps_latitude REAL,
  gps_longitude REAL,
  exif_all_data TEXT
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_category ON Photos(primary_category);
CREATE INDEX IF NOT EXISTS idx_downloaded_at ON Photos(downloaded_at);
CREATE INDEX IF NOT EXISTS idx_photographer ON Photos(photographer_name);
