/**
 * ADR-0006 Standard Domain Event Envelope
 */
export interface DomainEvent<T = unknown> {
  eventId: string;
  type: string;
  schemaVersion: number;
  occurredAt: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId?: string;
  payload: T;
}

export function createDomainEvent<T>(params: {
  type: string;
  aggregateType: string;
  aggregateId: string;
  aggregateVersion: number;
  correlationId: string;
  causationId?: string;
  schemaVersion?: number;
  payload: T;
}): DomainEvent<T> {
  return {
    eventId: `evt_${crypto.randomUUID()}`,
    type: params.type,
    schemaVersion: params.schemaVersion ?? 1,
    occurredAt: new Date().toISOString(),
    aggregateType: params.aggregateType,
    aggregateId: params.aggregateId,
    aggregateVersion: params.aggregateVersion,
    correlationId: params.correlationId,
    causationId: params.causationId,
    payload: params.payload,
  };
}

export * from './outbox';
export * from './inbox';
