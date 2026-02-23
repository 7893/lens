import { TraceContext } from '../schemas';

export class Logger {
  constructor(private context: TraceContext) {}

  info(message: string, data?: unknown) {
    console.log(`[INFO][${this.context.traceId}] ${message}`, data ? JSON.stringify(data) : '');
  }

  error(message: string, error?: unknown) {
    console.error(`[ERROR][${this.context.traceId}] ${message}`, error);
  }

  warn(message: string, data?: unknown) {
    console.warn(`[WARN][${this.context.traceId}] ${message}`, data ? JSON.stringify(data) : '');
  }
}

export function createTrace(prefix = 'REQ'): TraceContext {
  return {
    traceId: `${prefix}-${Math.random().toString(36).substring(2, 15)}`,
    startTime: Date.now(),
  };
}
