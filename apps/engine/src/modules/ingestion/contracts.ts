/**
 * ADR-0006 Provider Anti-Corruption Layer (ACL)
 * Normalized asset discovery contract across external sources.
 */
export interface DiscoveredAsset {
  source: {
    provider: string;
    externalId: string;
    canonicalUrl?: string;
  };
  media: {
    downloadUrl: string;
    width?: number;
    height?: number;
    mimeType?: string;
  };
  attribution: {
    authorName?: string;
    authorUrl?: string;
    license?: string;
    retentionPolicy?: string;
  };
  observedAt: string;
  rawRef?: string;
}
