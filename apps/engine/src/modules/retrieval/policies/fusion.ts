import { CandidateMatch, ScoredCandidate, RETRIEVAL_DEFAULTS } from '../contracts';

/**
 * Pure Reciprocal Rank Fusion (RRF) Policy
 * Computes RRF scores across multiple candidate recall sources.
 * Formula: score = sum( 1 / (k + rank) )
 */
export function fuseCandidatesWithRRF(
  ftsResults: CandidateMatch[],
  vectorResults: CandidateMatch[],
  k: number = RETRIEVAL_DEFAULTS.DEFAULT_RRF_K,
): ScoredCandidate[] {
  const map = new Map<
    string,
    {
      ftsRank?: number;
      vecRank?: number;
      sources: Set<'fts5' | 'vectorize'>;
    }
  >();

  for (const match of ftsResults) {
    const entry = map.get(match.id) || { sources: new Set() };
    entry.ftsRank = match.rank;
    entry.sources.add('fts5');
    map.set(match.id, entry);
  }

  for (const match of vectorResults) {
    const entry = map.get(match.id) || { sources: new Set() };
    entry.vecRank = match.rank;
    entry.sources.add('vectorize');
    map.set(match.id, entry);
  }

  return Array.from(map.entries())
    .map(([id, info]) => {
      const ftsScore = info.ftsRank !== undefined ? 1 / (k + info.ftsRank) : 0;
      const vecScore = info.vecRank !== undefined ? 1 / (k + info.vecRank) : 0;
      return {
        id,
        score: ftsScore + vecScore,
        sources: Array.from(info.sources),
        ftsRank: info.ftsRank,
        vecRank: info.vecRank,
      };
    })
    .sort((a, b) => b.score - a.score);
}
