/**
 * ADR-0006 Indexing & Search Projection Models
 */

export type ProjectionStatus = 'pending' | 'active' | 'retired';

export interface SearchDocumentRecord {
  id: string;
  asset_id: string;
  representation_version: string;
  embedding_version: string;
  index_generation: string;
  vector_id: string;
  status: ProjectionStatus;
  caption: string;
  tags_json: string;
  doc_json: string;
  created_at: number;
  activated_at: number | null;
}

export type GenerationState = 'building' | 'active' | 'retired';

export interface ProjectionStateRecord {
  projection_type: 'vectorize' | 'fts';
  index_generation: string;
  status: GenerationState;
  document_count: number;
  coverage_ratio: number;
  created_at: number;
  activated_at: number | null;
}
