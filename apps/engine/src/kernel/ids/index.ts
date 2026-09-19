/**
 * ADR-0006 Standard Identifier Helpers
 */
export function createAssetId(prefix = 'ast'): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function createRunId(assetId: string, pipelineVersion: string): string {
  return `process:${assetId}:${pipelineVersion}`;
}

export function createVectorId(params: {
  assetId: string;
  representationVersion: string;
  embeddingVersion: string;
  indexGeneration: string;
}): string {
  return `asset:${params.assetId}:repr:${params.representationVersion}:embed:${params.embeddingVersion}:gen:${params.indexGeneration}`;
}
