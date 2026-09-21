/**
 * ADR-0006 Catalog Domain Module
 * Owns Asset, AssetSource, permissions, visibility, and lifecycle.
 */

export * from './models';
export * from './BackfillService';

export interface CatalogAsset {
  id: string;
  sourceProvider: string;
  sourceExternalId: string;
  status: 'pending' | 'processing' | 'ready' | 'taken_down' | 'archived';
  searchReady: boolean;
  activeRepresentationVersion?: string;
  activeEmbeddingVersion?: string;
  createdAt: string;
  updatedAt: string;
}
