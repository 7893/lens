-- ============================================
-- Runtime State Management
-- ============================================

-- 扩展JobState表为通用的运行时状态表
-- 支持存储各种类型的状态值

DROP TABLE IF EXISTS JobState;

CREATE TABLE RuntimeState (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'string',
  description TEXT,
  updated_at TEXT NOT NULL
);

-- 初始化数据
INSERT INTO RuntimeState (key, value, value_type, description, updated_at) VALUES
  ('last_processed_page', '0', 'integer', 'Last Unsplash page processed', datetime('now')),
  ('current_workflow_id', '', 'string', 'Currently running workflow ID', datetime('now')),
  ('last_workflow_start', '', 'datetime', 'Last workflow start time', datetime('now')),
  ('last_workflow_end', '', 'datetime', 'Last workflow end time', datetime('now')),
  ('total_api_calls_today', '0', 'integer', 'Total API calls today', datetime('now')),
  ('last_error', '', 'string', 'Last error message', datetime('now')),
  ('system_status', 'idle', 'string', 'System status: idle/running/error', datetime('now'));

-- 简化WorkflowRuns表，使用workflow_id作为主键
DROP TABLE IF EXISTS WorkflowRuns;

CREATE TABLE WorkflowRuns (
  workflow_id TEXT PRIMARY KEY,
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

CREATE INDEX IF NOT EXISTS idx_workflow_status ON WorkflowRuns(status);
CREATE INDEX IF NOT EXISTS idx_workflow_started ON WorkflowRuns(started_at DESC);

-- ============================================
-- 使用说明
-- ============================================

/*
RuntimeState 表设计理念：
- 灵活的key-value存储
- 支持不同数据类型（通过value_type标记）
- 可以存储任何运行时状态
- 便于扩展新的状态变量

常用状态键：
- last_processed_page: 最后处理的页码
- current_workflow_id: 当前运行的workflow ID
- last_workflow_start/end: workflow时间戳
- total_api_calls_today: 今日API调用计数
- last_error: 最后的错误信息
- system_status: 系统状态

WorkflowRuns 简化：
- 使用workflow_id作为主键（不依赖自增ID）
- 直接通过workflow_id查询和更新
- 避免D1的lastRowId限制
*/
