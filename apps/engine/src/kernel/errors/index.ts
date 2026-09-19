/**
 * ADR-0006 Standard Domain & Application Errors
 */
export class DomainError extends Error {
  constructor(
    message: string,
    public readonly code: string = 'DOMAIN_ERROR',
    public readonly statusCode: number = 400,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} with id '${id}' not found`, 'NOT_FOUND', 404, { entity, id });
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, 'CONFLICT_ERROR', 409, details);
    this.name = 'ConflictError';
  }
}

export class ExternalServiceError extends DomainError {
  constructor(service: string, message: string, details?: Record<string, unknown>) {
    super(`External service ${service} failed: ${message}`, 'EXTERNAL_SERVICE_ERROR', 502, { service, ...details });
    this.name = 'ExternalServiceError';
  }
}
