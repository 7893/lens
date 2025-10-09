-- ============================================
-- Statistics Table Design
-- ============================================

-- 1. 全局统计表（单行记录，实时更新）
CREATE TABLE IF NOT EXISTS GlobalStats (
  id INTEGER PRIMARY KEY DEFAULT 1,
  
  -- 图片统计
  total_photos INTEGER DEFAULT 0,
  total_storage_bytes INTEGER DEFAULT 0,
  avg_file_size_bytes INTEGER DEFAULT 0,
  total_categories INTEGER DEFAULT 0,
  
  -- API统计
  total_api_calls INTEGER DEFAULT 0,
  unsplash_api_calls INTEGER DEFAULT 0,
  ai_api_calls INTEGER DEFAULT 0,
  
  -- Workflow统计
  total_workflows INTEGER DEFAULT 0,
  successful_workflows INTEGER DEFAULT 0,
  failed_workflows INTEGER DEFAULT 0,
  
  -- 下载统计
  total_downloads INTEGER DEFAULT 0,
  successful_downloads INTEGER DEFAULT 0,
  failed_downloads INTEGER DEFAULT 0,
  skipped_downloads INTEGER DEFAULT 0,
  
  -- 性能统计
  avg_download_time_ms INTEGER DEFAULT 0,
  avg_ai_classify_time_ms INTEGER DEFAULT 0,
  avg_workflow_time_ms INTEGER DEFAULT 0,
  
  -- 时间戳
  first_photo_at TEXT,
  last_photo_at TEXT,
  last_updated_at TEXT NOT NULL,
  
  CHECK (id = 1)
);

-- 2. API配额管理表
CREATE TABLE IF NOT EXISTS ApiQuota (
  api_name TEXT PRIMARY KEY,
  
  -- 配额限制
  quota_limit INTEGER NOT NULL,
  quota_period TEXT NOT NULL,
  
  -- 使用情况
  calls_used INTEGER DEFAULT 0,
  calls_remaining INTEGER,
  
  -- 时间信息
  period_start_at TEXT NOT NULL,
  period_end_at TEXT NOT NULL,
  last_call_at TEXT,
  next_reset_at TEXT NOT NULL,
  
  -- 状态
  is_limited INTEGER DEFAULT 0,
  limit_reason TEXT,
  
  updated_at TEXT NOT NULL
);

-- 3. 每日统计表（按日期聚合）
CREATE TABLE IF NOT EXISTS DailyStats (
  date TEXT PRIMARY KEY,
  
  photos_added INTEGER DEFAULT 0,
  storage_added_bytes INTEGER DEFAULT 0,
  
  api_calls INTEGER DEFAULT 0,
  workflows_run INTEGER DEFAULT 0,
  workflows_success INTEGER DEFAULT 0,
  workflows_failed INTEGER DEFAULT 0,
  
  downloads_attempted INTEGER DEFAULT 0,
  downloads_success INTEGER DEFAULT 0,
  downloads_failed INTEGER DEFAULT 0,
  downloads_skipped INTEGER DEFAULT 0,
  
  avg_download_time_ms INTEGER DEFAULT 0,
  avg_ai_time_ms INTEGER DEFAULT 0,
  
  created_at TEXT NOT NULL
);

-- 4. Workflow执行记录表
CREATE TABLE IF NOT EXISTS WorkflowRuns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  page INTEGER NOT NULL,
  
  status TEXT NOT NULL,
  
  photos_total INTEGER DEFAULT 0,
  photos_success INTEGER DEFAULT 0,
  photos_failed INTEGER DEFAULT 0,
  photos_skipped INTEGER DEFAULT 0,
  
  duration_ms INTEGER,
  error_message TEXT,
  
  started_at TEXT NOT NULL,
  completed_at TEXT
);

-- 5. 分类统计表（实时更新）
CREATE TABLE IF NOT EXISTS CategoryStats (
  category TEXT PRIMARY KEY,
  
  photo_count INTEGER DEFAULT 0,
  total_storage_bytes INTEGER DEFAULT 0,
  avg_confidence REAL DEFAULT 0,
  
  first_photo_at TEXT,
  last_photo_at TEXT,
  updated_at TEXT NOT NULL
);

-- 6. API调用记录表（可选，用于详细追踪）
CREATE TABLE IF NOT EXISTS ApiCalls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  
  api_type TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  
  status_code INTEGER,
  duration_ms INTEGER,
  
  success INTEGER DEFAULT 1,
  error_message TEXT,
  
  called_at TEXT NOT NULL
);

-- ============================================
-- 索引
-- ============================================

CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON DailyStats(date DESC);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON WorkflowRuns(status);
CREATE INDEX IF NOT EXISTS idx_workflow_runs_started ON WorkflowRuns(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_category_stats_count ON CategoryStats(photo_count DESC);
CREATE INDEX IF NOT EXISTS idx_api_calls_type ON ApiCalls(api_type, called_at DESC);

-- ============================================
-- 初始化数据
-- ============================================

INSERT OR IGNORE INTO GlobalStats (id, last_updated_at) 
VALUES (1, datetime('now'));

-- Unsplash API配额（50次/小时）
INSERT OR IGNORE INTO ApiQuota (
  api_name, quota_limit, quota_period, 
  calls_used, calls_remaining,
  period_start_at, period_end_at, next_reset_at, updated_at
) VALUES (
  'unsplash', 50, 'hourly',
  0, 50,
  datetime('now'), datetime('now', '+1 hour'), datetime('now', '+1 hour'), datetime('now')
);

-- Cloudflare AI配额（根据实际情况调整）
INSERT OR IGNORE INTO ApiQuota (
  api_name, quota_limit, quota_period,
  calls_used, calls_remaining,
  period_start_at, period_end_at, next_reset_at, updated_at
) VALUES (
  'cloudflare-ai', 10000, 'daily',
  0, 10000,
  date('now'), date('now', '+1 day'), datetime('now', '+1 day'), datetime('now')
);

-- R2 API配额（根据实际情况调整）
INSERT OR IGNORE INTO ApiQuota (
  api_name, quota_limit, quota_period,
  calls_used, calls_remaining,
  period_start_at, period_end_at, next_reset_at, updated_at
) VALUES (
  'r2', 1000000, 'daily',
  0, 1000000,
  date('now'), date('now', '+1 day'), datetime('now', '+1 day'), datetime('now')
);

-- ============================================
-- 使用说明
-- ============================================

/*
1. GlobalStats - 全局统计（单行）
   - 实时更新总体数据
   - 用于首页快速展示

2. ApiQuota - API配额管理
   - 记录每个API的配额限制和使用情况
   - 支持不同的配额周期（hourly/daily/monthly）
   - 自动计算剩余次数和重置时间
   - 支持限流状态标记
   
   字段说明：
   - quota_limit: 配额上限
   - quota_period: 配额周期（hourly/daily/monthly）
   - calls_used: 当前周期已使用次数
   - calls_remaining: 剩余次数
   - period_start_at: 当前周期开始时间
   - period_end_at: 当前周期结束时间
   - last_call_at: 最后一次调用时间
   - next_reset_at: 下次重置时间
   - is_limited: 是否被限流（0=正常, 1=限流中）
   - limit_reason: 限流原因

3. DailyStats - 每日统计
   - 按日期聚合数据
   - 用于趋势图表

4. WorkflowRuns - Workflow执行记录
   - 记录每次workflow的详细信息
   - 用于监控和调试

5. CategoryStats - 分类统计
   - 每个分类的详细数据
   - 用于分类页面展示

6. ApiCalls - API调用记录（可选）
   - 详细的API调用日志
   - 可用于性能分析和调试
   - 如果数据量大可以定期清理旧数据
*/
