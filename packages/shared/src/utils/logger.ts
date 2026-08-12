import { TraceContext } from '../schemas';

export class Logger {
  constructor(
    private context: TraceContext,
    private telemetry?: AnalyticsEngineDataset,
  ) {}

  info(message: string, data?: unknown) {
    console.log(`[INFO][${this.context.traceId}] ${message}`, data ? JSON.stringify(data) : '');
  }

  error(message: string, error?: unknown) {
    console.error(`[ERROR][${this.context.traceId}] ${message}`, error);
  }

  warn(message: string, data?: unknown) {
    console.warn(`[WARN][${this.context.traceId}] ${message}`, data ? JSON.stringify(data) : '');
  }

  /** Write metrics to Analytics Engine */
  metric(event: string, doubles: number[] = [], blobs: string[] = []) {
    this.telemetry?.writeDataPoint({
      indexes: [this.context.traceId],
      blobs: [event, ...blobs],
      doubles: [Date.now() - this.context.startTime, ...doubles],
    });
  }

  trackSearch(data: {
    query: string;
    resultsBeforeCliff: number;
    resultsAfterCliff: number;
    highestScore: number;
    lowestScore: number;
    fts5Hits: number;
    vectorHits: number;
    zeroResult: boolean;
  }) {
    this.telemetry?.writeDataPoint({
      indexes: [this.context.traceId],
      blobs: ['search_advanced', 'Search', data.zeroResult ? 'zero_result' : 'success', data.query.slice(0, 50)],
      doubles: [
        Date.now() - this.context.startTime,
        data.resultsBeforeCliff,
        data.resultsAfterCliff,
        data.highestScore,
        data.lowestScore,
        data.fts5Hits,
        data.vectorHits,
      ],
    });
  }

  trackAI(data: {
    photoId: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    parseRetries: number;
    isDegraded: boolean;
  }) {
    this.telemetry?.writeDataPoint({
      indexes: [this.context.traceId],
      blobs: ['ai_cost', 'AI', data.isDegraded ? 'degraded' : 'success', data.model, data.photoId],
      doubles: [Date.now() - this.context.startTime, data.promptTokens, data.completionTokens, data.parseRetries],
    });
  }

  trackEngagement(data: {
    sessionId: string;
    action: string;
    query?: string;
    photoId?: string;
    timeToClickMs?: number;
  }) {
    this.telemetry?.writeDataPoint({
      indexes: [data.sessionId],
      blobs: [
        'frontend_engagement',
        'Frontend',
        data.action,
        data.query?.slice(0, 50) || '',
        data.photoId || '',
        this.context.traceId,
      ],
      doubles: [Date.now() - this.context.startTime, data.timeToClickMs || 0],
    });
  }
}

export function createTrace(prefix = 'REQ'): TraceContext {
  return {
    traceId: `${prefix}-${Math.random().toString(36).substring(2, 15)}`,
    startTime: Date.now(),
  };
}
