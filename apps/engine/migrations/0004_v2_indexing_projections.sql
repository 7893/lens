-- ADR-0006 Versioned Search Projections: 0004_v2_indexing_projections.sql

-- 1. Search Documents (Candidate & Active versioned search projections)
CREATE TABLE IF NOT EXISTS search_documents (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  representation_version TEXT NOT NULL,
  embedding_version TEXT NOT NULL,
  index_generation TEXT NOT NULL,
  vector_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, active, retired
  caption TEXT,
  tags_json TEXT,
  doc_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  activated_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_search_docs_lookup ON search_documents(asset_id, index_generation);
CREATE INDEX IF NOT EXISTS idx_search_docs_status ON search_documents(status, index_generation);

-- 2. Projection State (Generations, coverage, and health)
CREATE TABLE IF NOT EXISTS projection_state (
  projection_type TEXT NOT NULL, -- vectorize, fts
  index_generation TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'building', -- building, active, retired
  document_count INTEGER NOT NULL DEFAULT 0,
  coverage_ratio REAL NOT NULL DEFAULT 0.0,
  created_at INTEGER NOT NULL,
  activated_at INTEGER,
  PRIMARY KEY (projection_type, index_generation)
);

-- Seed initial generation as active for Vectorize and FTS
INSERT OR IGNORE INTO projection_state (projection_type, index_generation, status, document_count, coverage_ratio, created_at, activated_at)
VALUES 
  ('vectorize', 'gen-001', 'active', 0, 1.0, 1773571199000, 1773571199000),
  ('fts', 'gen-001', 'active', 0, 1.0, 1773571199000, 1773571199000);
