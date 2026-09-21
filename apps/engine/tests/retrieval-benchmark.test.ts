import { describe, it, expect } from 'vitest';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  BENCHMARK_QUERIES,
  BenchmarkQuery,
  SearchResultItem,
  computeGrade,
  computeDcg,
  computeIdcg,
  computeNdcg,
  computeMrr,
  evaluateBenchmark,
  formatBenchmarkSummary,
} from '../src/modules/retrieval/benchmark';

describe('Retrieval Benchmark & Ground-Truth Harness (KI-006)', () => {
  describe('Dataset Integrity & Completeness', () => {
    it('persists dataset.json for external benchmarks and CLI scripts', () => {
      const jsonPath = resolve(__dirname, '../src/modules/retrieval/benchmark/dataset.json');
      if (!existsSync(jsonPath)) {
        writeFileSync(jsonPath, JSON.stringify(BENCHMARK_QUERIES, null, 2) + '\n', 'utf-8');
      }
      expect(existsSync(jsonPath)).toBe(true);
    });

    it('contains 60 curated benchmark queries across 6 core categories', () => {
      expect(BENCHMARK_QUERIES.length).toBe(60);

      const categoryCounts = BENCHMARK_QUERIES.reduce(
        (acc, q) => {
          acc[q.category] = (acc[q.category] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

      expect(categoryCounts['entity_specific']).toBe(10);
      expect(categoryCounts['abstract_concept']).toBe(10);
      expect(categoryCounts['style_and_composition']).toBe(10);
      expect(categoryCounts['synonym_and_multilingual']).toBe(10);
      expect(categoryCounts['complex_scenario']).toBe(10);
      expect(categoryCounts['niche_and_longtail']).toBe(10);
    });

    it('ensures all queries have valid ground-truth annotations and criteria', () => {
      const ids = new Set<string>();

      for (const q of BENCHMARK_QUERIES) {
        expect(q.id).toMatch(/^q_\d{3}$/);
        expect(ids.has(q.id)).toBe(false);
        ids.add(q.id);

        expect(q.query.trim().length).toBeGreaterThan(5);
        expect(q.expectedTags.length).toBeGreaterThanOrEqual(4);
        expect(q.expectedKeywords.length).toBeGreaterThanOrEqual(4);
        expect(q.highlyRelevantTerms.length).toBeGreaterThanOrEqual(1);
        expect(q.relevantTerms.length).toBeGreaterThanOrEqual(1);
        expect(q.partiallyRelevantTerms.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe('IR Metric Calculations', () => {
    it('computes DCG and IDCG correctly', () => {
      // For grades [3, 2, 1], rank 1: (2^3-1)/log2(2) = 7/1 = 7
      // rank 2: (2^2-1)/log2(3) = 3/1.58496 = 1.89279
      // rank 3: (2^1-1)/log2(4) = 1/2 = 0.5
      // DCG@3 = 7 + 1.89279 + 0.5 = 9.39279
      const dcg = computeDcg([3, 2, 1], 3);
      expect(dcg).toBeCloseTo(9.3928, 3);

      const idcg = computeIdcg([1, 3, 2], 3);
      expect(idcg).toBeCloseTo(9.3928, 3);
    });

    it('computes nDCG with perfect rank returning 1.0', () => {
      const perfectNdcg = computeNdcg([3, 3, 2, 1, 0], 5);
      expect(perfectNdcg).toBe(1.0);

      // Inverted rank should have strictly lower nDCG
      const invertedNdcg = computeNdcg([0, 1, 2, 3, 3], 5);
      expect(invertedNdcg).toBeLessThan(1.0);
      expect(invertedNdcg).toBeGreaterThan(0.0);

      // All zero relevance returns 0.0
      expect(computeNdcg([0, 0, 0], 3)).toBe(0.0);
    });

    it('computes MRR based on first relevant item (grade >= 2)', () => {
      expect(computeMrr([3, 0, 0])).toBe(1.0);
      expect(computeMrr([1, 2, 0])).toBe(0.5);
      expect(computeMrr([0, 0, 2])).toBeCloseTo(0.3333, 4);
      expect(computeMrr([1, 1, 0])).toBe(0.0);
    });
  });

  describe('Relevance Grading', () => {
    const sampleQuery: BenchmarkQuery = {
      id: 'q_test',
      query: 'golden retriever puppy',
      category: 'entity_specific',
      difficulty: 'easy',
      expectedTags: ['dog', 'puppy', 'golden retriever', 'pet'],
      expectedKeywords: ['golden', 'retriever', 'puppy', 'dog'],
      highlyRelevantTerms: ['golden retriever puppy'],
      relevantTerms: ['golden retriever', 'puppy dog'],
      partiallyRelevantTerms: ['cute dog', 'pet playing'],
    };

    it('assigns grade 3 for exact highly relevant matches', () => {
      const item: SearchResultItem = {
        id: 'img_1',
        caption: 'A cute golden retriever puppy on grass',
        tags: ['dog', 'golden retriever'],
      };
      expect(computeGrade(item, sampleQuery)).toBe(3);
    });

    it('assigns grade 2 for relevant tag overlaps or relevant terms', () => {
      const item: SearchResultItem = {
        id: 'img_2',
        caption: 'Playful golden retriever running outdoors',
        tags: ['dog', 'golden retriever'],
      };
      expect(computeGrade(item, sampleQuery)).toBe(2);
    });

    it('assigns grade 1 for partial matches', () => {
      const item: SearchResultItem = {
        id: 'img_3',
        caption: 'A cute dog in the yard',
        tags: ['pet'],
      };
      expect(computeGrade(item, sampleQuery)).toBe(1);
    });

    it('assigns grade 0 for irrelevant items', () => {
      const item: SearchResultItem = {
        id: 'img_4',
        caption: 'Modern red sports car on highway',
        tags: ['car', 'speed', 'automotive'],
      };
      expect(computeGrade(item, sampleQuery)).toBe(0);
    });
  });

  describe('Full Benchmark Execution Harness', () => {
    it('evaluates all 60 queries and formats benchmark summary report', async () => {
      // High-quality mock runner simulating hybrid retrieval results
      const mockRunner = async (query: string): Promise<SearchResultItem[]> => {
        const matchingQuery = BENCHMARK_QUERIES.find((q) => q.query === query);
        if (!matchingQuery) return [];

        return [
          {
            id: `res_high_${matchingQuery.id}`,
            caption: `${matchingQuery.query} ${matchingQuery.highlyRelevantTerms[0]}`,
            tags: matchingQuery.expectedTags,
          },
          {
            id: `res_rel1_${matchingQuery.id}`,
            caption: `Scenic view with ${matchingQuery.relevantTerms[0]}`,
            tags: matchingQuery.expectedTags.slice(0, 3),
          },
          {
            id: `res_rel2_${matchingQuery.id}`,
            caption: `Detailed picture of ${matchingQuery.relevantTerms[0]}`,
            tags: matchingQuery.expectedTags.slice(0, 2),
          },
          {
            id: `res_partial1_${matchingQuery.id}`,
            caption: `Contextual shot with ${matchingQuery.partiallyRelevantTerms[0]}`,
            tags: matchingQuery.expectedTags.slice(0, 2),
          },
          {
            id: `res_partial2_${matchingQuery.id}`,
            caption: `Atmospheric background with ${matchingQuery.partiallyRelevantTerms[0]}`,
            tags: matchingQuery.expectedTags,
          },
        ];
      };

      const report = await evaluateBenchmark(mockRunner, BENCHMARK_QUERIES);

      expect(report.totalQueries).toBe(60);
      expect(report.meanNdcgAt10).toBeGreaterThanOrEqual(0.85);
      expect(report.meanRecallAt10).toBeGreaterThanOrEqual(0.75);
      expect(report.meanMrr).toBeGreaterThanOrEqual(0.9);
      expect(report.zeroResultRate).toBe(0.0);

      // Verify category metrics
      expect(Object.keys(report.categoryBreakdown)).toHaveLength(6);
      for (const catSummary of Object.values(report.categoryBreakdown)) {
        expect(catSummary.count).toBe(10);
        expect(catSummary.meanNdcgAt10).toBeGreaterThanOrEqual(0.8);
      }

      // Verify summary formatting
      const summaryText = formatBenchmarkSummary(report);
      expect(summaryText).toContain('LENS RETRIEVAL KERNEL BENCHMARK EVALUATION (KI-006)');
      expect(summaryText).toContain('CATEGORY BREAKDOWN:');
      expect(summaryText).toContain('entity_specific');
      expect(summaryText).toContain('niche_and_longtail');
    });

    it('properly records zero results when runner returns empty', async () => {
      const emptyRunner = async () => [];
      const report = await evaluateBenchmark(emptyRunner, BENCHMARK_QUERIES.slice(0, 5));

      expect(report.totalQueries).toBe(5);
      expect(report.zeroResultRate).toBe(1.0);
      expect(report.meanNdcgAt10).toBe(0.0);
      expect(report.meanMrr).toBe(0.0);
    });
  });
});
