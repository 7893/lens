export interface RuntimeConfigRecord {
  key: string;
  version: string;
  value_json: string;
  description: string | null;
  updated_by: string;
  updated_at: number;
}

export interface OperationAuditRecord {
  id: string;
  operator: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  correlation_id: string;
  status: 'success' | 'failure';
  details_json: string | null;
  created_at: number;
}

export interface ReconciliationReport {
  timestamp: number;
  outbox: {
    pendingEvents: number;
    staleEvents: number;
  };
  projections: {
    activeGeneration: string | null;
    activeCount: number;
    pendingCount: number;
    staleCount: number;
  };
  healthy: boolean;
}
