import { describe, it, expect } from 'vitest';

// Extract billing calculation logic for testing
interface BillingSummary {
  evolutionCost: number;
  totalTokens: number;
}

function calculateEvolutionCapacity(summary: BillingSummary, dailyLimit: number): number {
  const remainingUSD = dailyLimit - summary.evolutionCost;
  const estimatedCostPerImage = 0.001;
  if (remainingUSD <= 0) return 0;
  return Math.floor((remainingUSD * 0.95) / estimatedCostPerImage);
}

function aggregateBillingGroups(
  groups: Array<{ model: string; cost: number; tokensIn: number; tokensOut: number }>,
  targetModel: string,
): BillingSummary {
  return groups.reduce(
    (acc, group) => {
      if (group.model === targetModel) {
        acc.evolutionCost += group.cost;
        acc.totalTokens += group.tokensIn + group.tokensOut;
      }
      return acc;
    },
    { evolutionCost: 0, totalTokens: 0 },
  );
}

describe('calculateEvolutionCapacity', () => {
  it('returns 0 when budget exhausted', () => {
    expect(calculateEvolutionCapacity({ evolutionCost: 0.11, totalTokens: 1000 }, 0.11)).toBe(0);
    expect(calculateEvolutionCapacity({ evolutionCost: 0.15, totalTokens: 1000 }, 0.11)).toBe(0);
  });

  it('calculates capacity with 5% safety margin', () => {
    // $0.11 limit, $0 spent = $0.11 remaining
    // 0.11 * 0.95 / 0.001 = 104.5 -> 104
    const result = calculateEvolutionCapacity({ evolutionCost: 0, totalTokens: 0 }, 0.11);
    expect(result).toBe(104);
  });

  it('calculates partial remaining budget', () => {
    // $0.11 limit, $0.05 spent = $0.06 remaining
    // 0.06 * 0.95 / 0.001 = 57 (but floating point: 56.99... -> 56)
    const result = calculateEvolutionCapacity({ evolutionCost: 0.05, totalTokens: 500 }, 0.11);
    expect(result).toBe(56);
  });
});

describe('aggregateBillingGroups', () => {
  it('sums only target model costs', () => {
    const groups = [
      { model: '@cf/meta/llama-4-scout-17b-16e-instruct', cost: 0.05, tokensIn: 100, tokensOut: 50 },
      { model: '@cf/baai/bge-m3', cost: 0.01, tokensIn: 200, tokensOut: 0 },
      { model: '@cf/meta/llama-4-scout-17b-16e-instruct', cost: 0.03, tokensIn: 80, tokensOut: 40 },
    ];
    const result = aggregateBillingGroups(groups, '@cf/meta/llama-4-scout-17b-16e-instruct');
    expect(result.evolutionCost).toBeCloseTo(0.08);
    expect(result.totalTokens).toBe(270); // 100+50+80+40
  });

  it('returns zero for no matching model', () => {
    const groups = [{ model: 'other-model', cost: 0.1, tokensIn: 100, tokensOut: 100 }];
    const result = aggregateBillingGroups(groups, '@cf/meta/llama-4-scout-17b-16e-instruct');
    expect(result.evolutionCost).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it('handles empty groups', () => {
    const result = aggregateBillingGroups([], '@cf/meta/llama-4-scout-17b-16e-instruct');
    expect(result.evolutionCost).toBe(0);
    expect(result.totalTokens).toBe(0);
  });
});
