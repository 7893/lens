-- LENS Performance Tuning: 0002_performance_tuning.sql

-- 1. Covering Index for "Latest Images" API
-- This avoids a "table lookup" by including all necessary rendering fields in the index leaf nodes.
-- Drastically reduces I/O for the most frequent query.
CREATE INDEX IF NOT EXISTS idx_images_latest_render 
ON images (created_at DESC, id, display_key, color, width, height, ai_quality_score);

-- 2. Optimized Compound Index for Evolution Engine
-- Speeds up the daily 23:00 UTC audit by clustering outdated models with their creation timestamp.
CREATE INDEX IF NOT EXISTS idx_images_evolution_audit 
ON images (ai_model, created_at DESC) 
WHERE ai_model IS NOT NULL;

-- 3. Partial Index for Sync Failures
-- Specifically targets rows that are stuck in the sync pipeline.
CREATE INDEX IF NOT EXISTS idx_images_stuck_sync
ON images (vectorize_synced)
WHERE vectorize_synced = 0;

-- 4. VACUUM to reclaim space and re-index for optimal density
-- (Note: D1 manages VACUUM automatically, but it's good practice for local testing)
ANALYZE;
