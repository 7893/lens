-- Migration 0005: Runtime Configuration & Operation Audit (ADR-0006 Phase 6)
-- Authoritative configuration storage, version tracking, and audit logging for high-risk actions.

CREATE TABLE IF NOT EXISTS runtime_config (
  key TEXT PRIMARY KEY,
  version TEXT NOT NULL,
  value_json TEXT NOT NULL,
  description TEXT,
  updated_by TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS operation_audit (
  id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL, -- 'success' | 'failure'
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_operation_audit_target ON operation_audit(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_operation_audit_correlation ON operation_audit(correlation_id);
