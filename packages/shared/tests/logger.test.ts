import { describe, it, expect } from 'vitest';
import { Logger, createTrace } from '../src/utils/logger';

describe('createTrace', () => {
  it('generates unique trace IDs', () => {
    const t1 = createTrace('TEST');
    const t2 = createTrace('TEST');
    expect(t1.traceId).toMatch(/^TEST-[a-z0-9]+$/);
    expect(t1.traceId).not.toBe(t2.traceId);
  });

  it('uses default prefix REQ', () => {
    const t = createTrace();
    expect(t.traceId).toMatch(/^REQ-/);
  });

  it('records start time', () => {
    const before = Date.now();
    const t = createTrace();
    const after = Date.now();
    expect(t.startTime).toBeGreaterThanOrEqual(before);
    expect(t.startTime).toBeLessThanOrEqual(after);
  });
});

describe('Logger', () => {
  it('logs with trace ID prefix', () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => logs.push(args.join(' '));

    const trace = { traceId: 'TEST-abc123', startTime: Date.now() };
    const logger = new Logger(trace);
    logger.info('test message');

    console.log = originalLog;
    expect(logs[0]).toContain('[INFO][TEST-abc123]');
    expect(logs[0]).toContain('test message');
  });

  it('writes metrics to telemetry when provided', () => {
    const dataPoints: unknown[] = [];
    const mockTelemetry = {
      writeDataPoint: (dp: unknown) => dataPoints.push(dp),
    } as AnalyticsEngineDataset;

    const trace = { traceId: 'TEST-xyz', startTime: Date.now() - 100 };
    const logger = new Logger(trace, mockTelemetry);
    logger.metric('search_complete', [50], ['extra']);

    expect(dataPoints).toHaveLength(1);
    const dp = dataPoints[0] as { indexes: string[]; blobs: string[]; doubles: number[] };
    expect(dp.indexes).toContain('TEST-xyz');
    expect(dp.blobs).toContain('search_complete');
    expect(dp.blobs).toContain('extra');
    expect(dp.doubles[0]).toBeGreaterThanOrEqual(100); // elapsed time
    expect(dp.doubles[1]).toBe(50);
  });

  it('skips metric when no telemetry', () => {
    const trace = { traceId: 'TEST-none', startTime: Date.now() };
    const logger = new Logger(trace);
    // Should not throw
    expect(() => logger.metric('event')).not.toThrow();
  });

  it('tracks search telemetry correctly', () => {
    const dataPoints: unknown[] = [];
    const mockTelemetry = {
      writeDataPoint: (dp: unknown) => dataPoints.push(dp),
    } as AnalyticsEngineDataset;
    const trace = { traceId: 'SEARCH-123', startTime: Date.now() };
    const logger = new Logger(trace, mockTelemetry);
    
    logger.trackSearch({
      query: 'test query',
      resultsBeforeCliff: 10,
      resultsAfterCliff: 5,
      highestScore: 0.9,
      lowestScore: 0.6,
      fts5Hits: 2,
      vectorHits: 3,
      zeroResult: false,
    });

    expect(dataPoints).toHaveLength(1);
    const dp = dataPoints[0] as any;
    expect(dp.indexes).toContain('SEARCH-123');
    expect(dp.blobs).toContain('search_advanced');
    expect(dp.blobs).toContain('success');
    expect(dp.blobs).toContain('test query');
    expect(dp.doubles[1]).toBe(10); // resultsBeforeCliff
  });

  it('tracks AI telemetry correctly', () => {
    const dataPoints: unknown[] = [];
    const mockTelemetry = {
      writeDataPoint: (dp: unknown) => dataPoints.push(dp),
    } as AnalyticsEngineDataset;
    const trace = { traceId: 'WF-123', startTime: Date.now() };
    const logger = new Logger(trace, mockTelemetry);
    
    logger.trackAI({
      photoId: 'photo1',
      model: 'llama-4',
      promptTokens: 100,
      completionTokens: 50,
      parseRetries: 1,
      isDegraded: false,
    });

    expect(dataPoints).toHaveLength(1);
    const dp = dataPoints[0] as any;
    expect(dp.blobs).toContain('ai_cost');
    expect(dp.blobs).toContain('photo1');
    expect(dp.blobs).toContain('llama-4');
    expect(dp.blobs).toContain('success');
    expect(dp.doubles[1]).toBe(100);
    expect(dp.doubles[2]).toBe(50);
  });

  it('tracks frontend engagement correctly', () => {
    const dataPoints: unknown[] = [];
    const mockTelemetry = {
      writeDataPoint: (dp: unknown) => dataPoints.push(dp),
    } as AnalyticsEngineDataset;
    const trace = { traceId: 'TRACK-123', startTime: Date.now() };
    const logger = new Logger(trace, mockTelemetry);
    
    logger.trackEngagement({
      sessionId: 'sess-abc',
      action: 'click',
      query: 'cat',
      photoId: 'p1',
      timeToClickMs: 1500,
    });

    expect(dataPoints).toHaveLength(1);
    const dp = dataPoints[0] as any;
    expect(dp.indexes).toEqual(['sess-abc']);
    expect(dp.blobs).toContain('frontend_engagement');
    expect(dp.blobs).toContain('click');
    expect(dp.blobs).toContain('cat');
    expect(dp.blobs).toContain('p1');
    expect(dp.doubles[1]).toBe(1500);
  });
});
