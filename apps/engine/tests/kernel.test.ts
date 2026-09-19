import { describe, it, expect } from 'vitest';
import {
  DomainError,
  NotFoundError,
  ValidationError,
  ConflictError,
  ExternalServiceError,
  createDomainEvent,
  createAssetId,
  createRunId,
  createVectorId,
} from '../src/kernel';

describe('Kernel Module', () => {
  describe('Errors', () => {
    it('creates standard DomainError', () => {
      const err = new DomainError('custom error', 'CUSTOM_CODE', 418, { key: 'val' });
      expect(err.message).toBe('custom error');
      expect(err.code).toBe('CUSTOM_CODE');
      expect(err.statusCode).toBe(418);
      expect(err.details).toEqual({ key: 'val' });
    });

    it('creates NotFoundError with 404', () => {
      const err = new NotFoundError('Asset', '123');
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe('NOT_FOUND');
      expect(err.message).toContain("Asset with id '123' not found");
    });

    it('creates ValidationError with 400', () => {
      const err = new ValidationError('Invalid param', { field: 'q' });
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe('VALIDATION_ERROR');
    });

    it('creates ConflictError with 409', () => {
      const err = new ConflictError('Conflict detected');
      expect(err.statusCode).toBe(409);
      expect(err.code).toBe('CONFLICT_ERROR');
    });

    it('creates ExternalServiceError with 502', () => {
      const err = new ExternalServiceError('Unsplash', 'Rate limit');
      expect(err.statusCode).toBe(502);
      expect(err.code).toBe('EXTERNAL_SERVICE_ERROR');
      expect(err.message).toContain('External service Unsplash failed');
    });
  });

  describe('Events', () => {
    it('creates standardized ADR-0006 domain event envelope', () => {
      const event = createDomainEvent({
        type: 'asset.ingested',
        aggregateType: 'asset',
        aggregateId: 'ast_123',
        aggregateVersion: 1,
        correlationId: 'trace-456',
        payload: { width: 1920, height: 1080 },
      });

      expect(event.eventId).toMatch(/^evt_/);
      expect(event.type).toBe('asset.ingested');
      expect(event.schemaVersion).toBe(1);
      expect(event.aggregateType).toBe('asset');
      expect(event.aggregateId).toBe('ast_123');
      expect(event.aggregateVersion).toBe(1);
      expect(event.correlationId).toBe('trace-456');
      expect(event.payload).toEqual({ width: 1920, height: 1080 });
      expect(new Date(event.occurredAt).getTime()).toBeGreaterThan(0);
    });
  });

  describe('IDs', () => {
    it('generates prefixed asset IDs', () => {
      const id = createAssetId();
      expect(id).toMatch(/^ast_[a-f0-9]{16}$/);
    });

    it('generates deterministic run IDs', () => {
      const runId = createRunId('ast_123', 'v1');
      expect(runId).toBe('process:ast_123:v1');
    });

    it('generates versioned vector IDs per ADR-0006', () => {
      const vectorId = createVectorId({
        assetId: 'ast_123',
        representationVersion: 'repr-v1',
        embeddingVersion: 'bge-m3-v1',
        indexGeneration: 'gen-001',
      });
      expect(vectorId).toBe('asset:ast_123:repr:repr-v1:embed:bge-m3-v1:gen:gen-001');
    });
  });
});
