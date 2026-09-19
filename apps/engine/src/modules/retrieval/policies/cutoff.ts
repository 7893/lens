import { ScoredCandidate, RETRIEVAL_DEFAULTS } from '../contracts';

export interface CutoffOptions {
  maxResults?: number;
  ratioCliff?: number;
  minProtected?: number;
  absoluteFloor?: number;
  relativeFloorRatio?: number;
}

export const CUTOFF_DEFAULTS = {
  MAX_RESULTS: RETRIEVAL_DEFAULTS.DEFAULT_LIMIT,
  RATIO_CLIFF: 0.65,
  MIN_PROTECTED: 5,
  ABSOLUTE_FLOOR: 0.005,
  RELATIVE_FLOOR_RATIO: 0.15,
} as const;

/**
 * Pure Dynamic Cliff Cutoff Policy
 * Detects score distribution cliffs and discards noise from the tail of candidate lists.
 * Returns the index (count) of candidates to retain.
 */
export function calculateDynamicCutoff(candidates: ScoredCandidate[], options: CutoffOptions = {}): number {
  if (candidates.length === 0) return 0;

  const maxResults = options.maxResults ?? CUTOFF_DEFAULTS.MAX_RESULTS;
  const ratioCliff = options.ratioCliff ?? CUTOFF_DEFAULTS.RATIO_CLIFF;
  const minProtected = options.minProtected ?? CUTOFF_DEFAULTS.MIN_PROTECTED;
  const absoluteFloor = options.absoluteFloor ?? CUTOFF_DEFAULTS.ABSOLUTE_FLOOR;
  const relativeFloorRatio = options.relativeFloorRatio ?? CUTOFF_DEFAULTS.RELATIVE_FLOOR_RATIO;

  const maxScore = candidates[0].score;

  for (let i = 1; i < candidates.length && i < maxResults; i++) {
    const score = candidates[i].score;
    const prevScore = candidates[i - 1].score;

    // Absolute floor check or relative floor drop
    if (score < maxScore * relativeFloorRatio || score < absoluteFloor) {
      return i;
    }

    // Cliff check (only applied after preserving at least minProtected items)
    if (i >= minProtected && prevScore > 0 && score / prevScore < ratioCliff) {
      return i;
    }
  }

  return Math.min(candidates.length, maxResults);
}
