-- Add vectorize_synced flag for tracking Vectorize sync status
ALTER TABLE images ADD COLUMN vectorize_synced INTEGER DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_vectorize_synced ON images(vectorize_synced);
