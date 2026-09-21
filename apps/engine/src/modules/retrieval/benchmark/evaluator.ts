import { BenchmarkQuery, BENCHMARK_QUERIES } from './dataset';

export interface SearchResultItem {
  id: string;
  caption?: string;
  tags?: string[];
  score?: number;
  metadata?: Record<string, unknown>;
}

export interface QueryEvaluationResult {
  queryId: string;
  query: string;
  category: string;
  totalRetrieved: number;
  relevantRetrieved: number;
  precisionAt5: number;
  precisionAt10: number;
  recallAt10: number;
  ndcgAt5: number;
  ndcgAt10: number;
  mrr: number;
  zeroResult: boolean;
}

export interface CategorySummary {
  category: string;
  count: number;
  meanNdcgAt10: number;
  meanRecallAt10: number;
  meanMrr: number;
  zeroResultRate: number;
}

export interface BenchmarkReport {
  timestamp: string;
  totalQueries: number;
  meanNdcgAt5: number;
  meanNdcgAt10: number;
  meanPrecisionAt5: number;
  meanPrecisionAt10: number;
  meanRecallAt10: number;
  meanMrr: number;
  zeroResultRate: number;
  categoryBreakdown: Record<string, CategorySummary>;
  queryResults: QueryEvaluationResult[];
}

/**
 * Computes graded relevance level (0, 1, 2, 3) for a retrieved result item against a benchmark query.
 * - 3: Highly Relevant (exact match of primary multi-token terms or target intent)
 * - 2: Relevant (matches primary tags and keywords)
 * - 1: Partially Relevant (matches contextual or secondary attributes)
 * - 0: Irrelevant
 */
export function computeGrade(item: SearchResultItem, querySpec: BenchmarkQuery): number {
  const textCorpus = [
    item.caption || '',
    ...(item.tags || []),
    typeof item.metadata?.description === 'string' ? item.metadata.description : '',
    typeof item.metadata?.alt_description === 'string' ? item.metadata.alt_description : '',
  ]
    .join(' ')
    .toLowerCase();

  // Check 3: Highly Relevant terms
  for (const term of querySpec.highlyRelevantTerms) {
    if (textCorpus.includes(term.toLowerCase())) {
      return 3;
    }
  }

  // Check 2: Relevant terms
  for (const term of querySpec.relevantTerms) {
    if (textCorpus.includes(term.toLowerCase())) {
      return 2;
    }
  }

  // Check tag intersection for Relevant
  const itemTagsLower = (item.tags || []).map((t) => t.toLowerCase());
  const expectedTagsLower = querySpec.expectedTags.map((t) => t.toLowerCase());
  const tagOverlap = itemTagsLower.filter((t) => expectedTagsLower.includes(t));
  if (tagOverlap.length >= 2) {
    return 2;
  }

  // Check 1: Partially Relevant terms or single tag match
  for (const term of querySpec.partiallyRelevantTerms) {
    if (textCorpus.includes(term.toLowerCase())) {
      return 1;
    }
  }
  if (tagOverlap.length >= 1) {
    return 1;
  }

  // Check keywords overlap
  const keywordMatches = querySpec.expectedKeywords.filter((k) => textCorpus.includes(k.toLowerCase()));
  if (keywordMatches.length >= 2) {
    return 1;
  }

  return 0;
}

/**
 * Computes Discounted Cumulative Gain at rank K.
 * DCG@K = sum_{i=1}^K (2^{rel_i} - 1) / log_2(i + 1)
 */
export function computeDcg(grades: number[], k: number): number {
  let dcg = 0;
  const limit = Math.min(grades.length, k);
  for (let i = 0; i < limit; i++) {
    const rel = grades[i];
    dcg += (Math.pow(2, rel) - 1) / Math.log2(i + 2); // i + 2 because rank is 1-indexed (log_2(1+1) = 1)
  }
  return dcg;
}

/**
 * Computes Ideal Discounted Cumulative Gain at rank K.
 */
export function computeIdcg(grades: number[], k: number): number {
  const sorted = [...grades].sort((a, b) => b - a);
  return computeDcg(sorted, k);
}

/**
 * Computes Normalized Discounted Cumulative Gain at rank K.
 */
export function computeNdcg(grades: number[], k: number): number {
  const idcg = computeIdcg(grades, k);
  if (idcg === 0) return 0;
  return Number((computeDcg(grades, k) / idcg).toFixed(4));
}

/**
 * Computes Mean Reciprocal Rank (MRR) based on first relevant item (grade >= 2).
 */
export function computeMrr(grades: number[]): number {
  const firstIndex = grades.findIndex((g) => g >= 2);
  if (firstIndex === -1) return 0;
  return Number((1 / (firstIndex + 1)).toFixed(4));
}

/**
 * Evaluates a single query against its retrieved results.
 */
export function evaluateQuery(querySpec: BenchmarkQuery, results: SearchResultItem[]): QueryEvaluationResult {
  if (!results || results.length === 0) {
    return {
      queryId: querySpec.id,
      query: querySpec.query,
      category: querySpec.category,
      totalRetrieved: 0,
      relevantRetrieved: 0,
      precisionAt5: 0,
      precisionAt10: 0,
      recallAt10: 0,
      ndcgAt5: 0,
      ndcgAt10: 0,
      mrr: 0,
      zeroResult: true,
    };
  }

  const grades = results.map((item) => computeGrade(item, querySpec));
  const relevantCount = grades.filter((g) => g >= 1).length;

  const p5Count = grades.slice(0, 5).filter((g) => g >= 1).length;
  const precisionAt5 = Number((p5Count / 5).toFixed(4));

  const p10Count = grades.slice(0, 10).filter((g) => g >= 1).length;
  const precisionAt10 = Number((p10Count / Math.min(10, Math.max(1, results.length))).toFixed(4));

  // Minimum expected relevant baseline per query is 5 for top-10 recall evaluation
  const targetRecallBasis = Math.max(5, relevantCount);
  const recallAt10 = Number((p10Count / targetRecallBasis).toFixed(4));

  const ndcgAt5 = computeNdcg(grades, 5);
  const ndcgAt10 = computeNdcg(grades, 10);
  const mrr = computeMrr(grades);

  return {
    queryId: querySpec.id,
    query: querySpec.query,
    category: querySpec.category,
    totalRetrieved: results.length,
    relevantRetrieved: relevantCount,
    precisionAt5,
    precisionAt10,
    recallAt10,
    ndcgAt5,
    ndcgAt10,
    mrr,
    zeroResult: false,
  };
}

/**
 * Executes full evaluation harness across all benchmark queries.
 */
export async function evaluateBenchmark(
  runner: (query: string) => Promise<SearchResultItem[]>,
  queries: BenchmarkQuery[] = BENCHMARK_QUERIES,
): Promise<BenchmarkReport> {
  const queryResults: QueryEvaluationResult[] = [];

  for (const q of queries) {
    const results = await runner(q.query);
    const evalRes = evaluateQuery(q, results);
    queryResults.push(evalRes);
  }

  const total = queryResults.length;
  const sumNdcg5 = queryResults.reduce((acc, r) => acc + r.ndcgAt5, 0);
  const sumNdcg10 = queryResults.reduce((acc, r) => acc + r.ndcgAt10, 0);
  const sumP5 = queryResults.reduce((acc, r) => acc + r.precisionAt5, 0);
  const sumP10 = queryResults.reduce((acc, r) => acc + r.precisionAt10, 0);
  const sumRecall10 = queryResults.reduce((acc, r) => acc + r.recallAt10, 0);
  const sumMrr = queryResults.reduce((acc, r) => acc + r.mrr, 0);
  const zeroResultCount = queryResults.filter((r) => r.zeroResult).length;

  // Compute category breakdown
  const categories = Array.from(new Set(queryResults.map((r) => r.category)));
  const categoryBreakdown: Record<string, CategorySummary> = {};

  for (const cat of categories) {
    const subset = queryResults.filter((r) => r.category === cat);
    const count = subset.length;
    categoryBreakdown[cat] = {
      category: cat,
      count,
      meanNdcgAt10: Number((subset.reduce((a, b) => a + b.ndcgAt10, 0) / count).toFixed(4)),
      meanRecallAt10: Number((subset.reduce((a, b) => a + b.recallAt10, 0) / count).toFixed(4)),
      meanMrr: Number((subset.reduce((a, b) => a + b.mrr, 0) / count).toFixed(4)),
      zeroResultRate: Number((subset.filter((r) => r.zeroResult).length / count).toFixed(4)),
    };
  }

  return {
    timestamp: new Date().toISOString(),
    totalQueries: total,
    meanNdcgAt5: Number((sumNdcg5 / total).toFixed(4)),
    meanNdcgAt10: Number((sumNdcg10 / total).toFixed(4)),
    meanPrecisionAt5: Number((sumP5 / total).toFixed(4)),
    meanPrecisionAt10: Number((sumP10 / total).toFixed(4)),
    meanRecallAt10: Number((sumRecall10 / total).toFixed(4)),
    meanMrr: Number((sumMrr / total).toFixed(4)),
    zeroResultRate: Number((zeroResultCount / total).toFixed(4)),
    categoryBreakdown,
    queryResults,
  };
}

/**
 * Formats a clean human-readable evaluation summary report.
 */
export function formatBenchmarkSummary(report: BenchmarkReport): string {
  const lines: string[] = [
    '==================================================================',
    '       LENS RETRIEVAL KERNEL BENCHMARK EVALUATION (KI-006)        ',
    '==================================================================',
    `Timestamp:       ${report.timestamp}`,
    `Total Queries:   ${report.totalQueries}`,
    `nDCG@5:          ${(report.meanNdcgAt5 * 100).toFixed(2)}%`,
    `nDCG@10:         ${(report.meanNdcgAt10 * 100).toFixed(2)}%`,
    `Precision@5:     ${(report.meanPrecisionAt5 * 100).toFixed(2)}%`,
    `Precision@10:    ${(report.meanPrecisionAt10 * 100).toFixed(2)}%`,
    `Recall@10:       ${(report.meanRecallAt10 * 100).toFixed(2)}%`,
    `MRR:             ${report.meanMrr.toFixed(4)}`,
    `Zero-Result:     ${(report.zeroResultRate * 100).toFixed(2)}%`,
    '------------------------------------------------------------------',
    'CATEGORY BREAKDOWN:                                               ',
    'Category                      Count   nDCG@10  Recall@10    MRR   Zero%',
    '------------------------------------------------------------------',
  ];

  for (const cat of Object.values(report.categoryBreakdown)) {
    const padCat = cat.category.padEnd(28, ' ');
    const count = String(cat.count).padStart(5, ' ');
    const ndcg = `${(cat.meanNdcgAt10 * 100).toFixed(1)}%`.padStart(9, ' ');
    const recall = `${(cat.meanRecallAt10 * 100).toFixed(1)}%`.padStart(10, ' ');
    const mrr = cat.meanMrr.toFixed(3).padStart(7, ' ');
    const zero = `${(cat.zeroResultRate * 100).toFixed(1)}%`.padStart(6, ' ');
    lines.push(`${padCat} ${count} ${ndcg} ${recall} ${mrr} ${zero}`);
  }

  lines.push('==================================================================');
  return lines.join('\n');
}
