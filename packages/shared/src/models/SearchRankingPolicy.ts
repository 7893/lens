export interface ScoredCandidate {
  id: string;
  score: number;
}

export interface HybridCandidateInfo {
  ftsRank?: number;
  vecRank?: number;
}

/**
 * SearchRankingPolicy - Domain ranking & truncation policy
 * Encapsulates Reciprocal Rank Fusion (RRF) and dynamic Cliff Detection.
 */
export class SearchRankingPolicy {
  public static readonly DEFAULT_RRF_K = 60;
  public static readonly DEFAULT_MAX_RESULTS = 60;
  public static readonly ABSOLUTE_FLOOR = 0.005;
  public static readonly RATIO_CLIFF = 0.65;
  public static readonly MIN_PROTECTED_RESULTS = 5;

  /**
   * Calculates Reciprocal Rank Fusion (RRF) scores across FTS5 and Vector rankings.
   */
  public static calculateRRF(
    ftsResults: { id: string }[],
    vectorResults: { id: string; score: number }[],
    k: number = SearchRankingPolicy.DEFAULT_RRF_K,
  ): ScoredCandidate[] {
    const rrfMap = new Map<string, HybridCandidateInfo>();

    ftsResults.forEach((res, idx) => {
      rrfMap.set(res.id, { ftsRank: idx + 1 });
    });

    vectorResults.forEach((match, idx) => {
      const existing = rrfMap.get(match.id) || {};
      existing.vecRank = idx + 1;
      rrfMap.set(match.id, existing);
    });

    return Array.from(rrfMap.entries())
      .map(([id, info]) => {
        const ftsScore = info.ftsRank !== undefined ? 1 / (k + info.ftsRank) : 0;
        const vecScore = info.vecRank !== undefined ? 1 / (k + info.vecRank) : 0;
        return { id, score: ftsScore + vecScore };
      })
      .sort((a, b) => b.score - a.score);
  }

  /**
   * Dynamic Cliff Cutoff: Detects semantic cliff drop-offs to truncate the candidate list.
   * Returns the count of candidates to retain.
   */
  public static calculateDynamicCutoff(
    candidates: ScoredCandidate[],
    maxResults: number = SearchRankingPolicy.DEFAULT_MAX_RESULTS,
  ): number {
    if (candidates.length === 0) return 0;
    const maxScore = candidates[0].score;

    for (let i = 1; i < candidates.length && i < maxResults; i++) {
      const score = candidates[i].score;
      const prevScore = candidates[i - 1].score;

      // Absolute floor check: discard items scoring less than 15% of top result or below absolute floor
      if (score < maxScore * 0.15 || score < SearchRankingPolicy.ABSOLUTE_FLOOR) {
        return i;
      }

      // Relative cliff check (only apply after preserving at least top 5 results)
      if (
        i >= SearchRankingPolicy.MIN_PROTECTED_RESULTS &&
        prevScore > 0 &&
        score / prevScore < SearchRankingPolicy.RATIO_CLIFF
      ) {
        return i;
      }
    }

    return Math.min(candidates.length, maxResults);
  }
}
