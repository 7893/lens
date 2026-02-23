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
});
