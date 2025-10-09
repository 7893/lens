-- ============================================
-- Minimal Schema v2.0
-- ============================================

-- Drop old tables
DROP TABLE IF EXISTS GlobalStats;
DROP TABLE IF EXISTS ApiQuota;
DROP TABLE IF EXISTS CategoryStats;
DROP TABLE IF EXISTS DailyStats;
DROP TABLE IF EXISTS WorkflowRuns;
DROP TABLE IF EXISTS ApiCalls;
DROP TABLE IF EXISTS RuntimeState;

-- Keep Photos table (no changes)
-- Photos table already exists with 40 fields

-- 1. State - Runtime state management
CREATE TABLE State (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Initialize state
INSERT INTO State (key, value, updated_at) VALUES
  ('last_page', '0', datetime('now')),
  ('system_status', 'idle', datetime('now'));

-- 2. Metrics - Unified metrics storage
CREATE TABLE Metrics (
  metric_key TEXT PRIMARY KEY,
  metric_value TEXT NOT NULL,
  dimension TEXT,
  updated_at TEXT NOT NULL
);

-- Initialize metrics
INSERT INTO Metrics (metric_key, metric_value, dimension, updated_at) VALUES
  ('photos.total', '0', 'global', datetime('now')),
  ('workflows.total', '0', 'global', datetime('now')),
  ('workflows.success', '0', 'global', datetime('now')),
  ('workflows.failed', '0', 'global', datetime('now'));

-- 3. Events - Execution logs
CREATE TABLE Events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_data TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT
);

CREATE INDEX idx_events_type ON Events(event_type, created_at DESC);
CREATE INDEX idx_events_status ON Events(status);

-- ============================================
-- Summary: 3 tables (+ Photos)
-- ============================================
-- Photos: 40 fields (unchanged)
-- State: 3 fields (key, value, updated_at)
-- Metrics: 4 fields (metric_key, metric_value, dimension, updated_at)
-- Events: 6 fields (id, event_type, event_data, status, created_at, completed_at)
