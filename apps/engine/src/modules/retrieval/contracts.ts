export interface SearchFilters {
  color?: string;
  orientation?: 'landscape' | 'portrait' | 'square';
  tag?: string;
  authorName?: string;
}

export interface SearchOptions {
  enableSemantic?: boolean;
  retrievalVersion?: string;
  indexGeneration?: string;
  limit?: number;
  k?: number;
  diversityFactor?: number;
  timeoutMs?: number;
}

export interface SearchSpec {
  query: string;
  cursor?: string;
  filters?: SearchFilters;
  options?: SearchOptions;
}

export interface NormalizedSearchSpec {
  query: string;
  normalizedQuery: string;
  cursor?: string;
  filters: SearchFilters;
  options: {
    enableSemantic: boolean;
    retrievalVersion: string;
    indexGeneration: string;
    limit: number;
    k: number;
    diversityFactor: number;
    timeoutMs: number;
  };
}

export interface CandidateMatch {
  id: string;
  rawId?: string;
  source: 'fts5' | 'vectorize';
  score?: number;
  rank: number; // 1-based rank within source
}

export interface CandidateSource {
  readonly name: 'fts5' | 'vectorize';
  recall(spec: NormalizedSearchSpec, convId?: string): Promise<CandidateMatch[]>;
}

export interface SearchCursor {
  offset: number;
  queryHash: string;
  version: string;
}

export interface ScoredCandidate {
  id: string;
  score: number;
  sources: ('fts5' | 'vectorize')[];
  ftsRank?: number;
  vecRank?: number;
}

export const RETRIEVAL_DEFAULTS = {
  VERSION: 'v2',
  INDEX_GENERATION: 'gen-2026-01',
  DEFAULT_LIMIT: 60,
  DEFAULT_RRF_K: 60,
  DEFAULT_DIVERSITY_FACTOR: 0.8,
  DEFAULT_TIMEOUT_MS: 3000,
  MAX_LIMIT: 100,
} as const;
