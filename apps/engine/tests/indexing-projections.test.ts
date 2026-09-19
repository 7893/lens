import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildVersionedVectorId,
  prepareCandidateSearchDocument,
  prepareActivateAssetProjection,
  getActiveIndexGeneration,
  SearchDocumentRecord,
  ProjectionStateRecord,
} from '../src/modules/indexing';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Indexing & Versioned Search Projections (Phase 4)', () => {
  let mockSearchDocs: Map<string, SearchDocumentRecord>;
  let mockAssets: Map<string, { status: string; search_ready: number; active_index_gen?: string }>;
  let mockProjectionState: Map<string, ProjectionStateRecord>;
  let mockDb: D1Database;

  beforeEach(() => {
    mockSearchDocs = new Map();
    mockAssets = new Map();
    mockProjectionState = new Map();

    // Initial asset
    mockAssets.set('ast_test_1', { status: 'processing', search_ready: 0 });

    // Initial projection state
    mockProjectionState.set('vectorize:gen-001', {
      projection_type: 'vectorize',
      index_generation: 'gen-001',
      status: 'active',
      document_count: 50,
      coverage_ratio: 1.0,
      created_at: 1770000000000,
      activated_at: 1770000000000,
    });

    mockDb = {
      prepare(query: string) {
        let boundArgs: unknown[] = [];
        const stmt = {
          bind(...args: unknown[]) {
            boundArgs = args;
            return stmt;
          },
          async run() {
            if (query.includes('INSERT INTO search_documents')) {
              const record: SearchDocumentRecord = {
                id: boundArgs[0] as string,
                asset_id: boundArgs[1] as string,
                representation_version: boundArgs[2] as string,
                embedding_version: boundArgs[3] as string,
                index_generation: boundArgs[4] as string,
                vector_id: boundArgs[5] as string,
                status: 'pending',
                caption: boundArgs[6] as string,
                tags_json: boundArgs[7] as string,
                doc_json: boundArgs[8] as string,
                created_at: boundArgs[9] as number,
                activated_at: null,
              };
              mockSearchDocs.set(`${record.asset_id}:${record.index_generation}`, record);
              return { success: true };
            }
            if (query.includes('UPDATE search_documents')) {
              const [time, assetId, gen] = boundArgs as [number, string, string];
              const doc = mockSearchDocs.get(`${assetId}:${gen}`);
              if (doc) {
                doc.status = 'active';
                doc.activated_at = time;
              }
              return { success: true };
            }
            if (query.includes('UPDATE assets')) {
              const [, , gen, , id] = boundArgs as [string, string, string, number, string];
              mockAssets.set(id, {
                status: 'ready',
                search_ready: 1,
                active_index_gen: gen,
              });
              return { success: true };
            }
            return { success: true };
          },
          async first() {
            if (query.includes('FROM projection_state WHERE projection_type = ?')) {
              const [type] = boundArgs as [string];
              for (const record of mockProjectionState.values()) {
                if (record.projection_type === type && record.status === 'active') {
                  return { index_generation: record.index_generation };
                }
              }
              return null;
            }
            return null;
          },
        };
        return stmt as unknown as D1PreparedStatement;
      },
    } as unknown as D1Database;
  });

  it('builds immutable versioned vector ID per ADR-0006 format', () => {
    const vectorId = buildVersionedVectorId('ast_99', 'repr_v2', 'bge_m3_v2', 'gen_003');
    expect(vectorId).toBe('asset:ast_99:repr:repr_v2:embed:bge_m3_v2:gen:gen_003');
  });

  it('creates pending candidate search document before activation', async () => {
    const input = {
      assetId: 'ast_test_1',
      representationVersion: 'repr_v1',
      embeddingVersion: 'bge_m3_v1',
      indexGeneration: 'gen-001',
      caption: 'Sunset on a calm lake',
      tags: ['lake', 'sunset'],
      docMeta: { photographer: 'Alice' },
    };

    const stmt = prepareCandidateSearchDocument(mockDb, input);
    await stmt.run();

    const storedDoc = mockSearchDocs.get('ast_test_1:gen-001');
    expect(storedDoc).toBeDefined();
    expect(storedDoc?.status).toBe('pending');
    expect(storedDoc?.vector_id).toBe('asset:ast_test_1:repr:repr_v1:embed:bge_m3_v1:gen:gen-001');
    expect(storedDoc?.caption).toBe('Sunset on a calm lake');
    expect(storedDoc?.activated_at).toBeNull();
  });

  it('atomically activates candidate projection and sets asset search_ready', async () => {
    // 1. Seed candidate
    const input = {
      assetId: 'ast_test_1',
      representationVersion: 'repr_v1',
      embeddingVersion: 'bge_m3_v1',
      indexGeneration: 'gen-001',
      caption: 'Sunset on a calm lake',
      tags: ['lake', 'sunset'],
      docMeta: { photographer: 'Alice' },
    };
    await prepareCandidateSearchDocument(mockDb, input).run();

    // 2. Activate via D1 batch statements
    const stmts = prepareActivateAssetProjection(mockDb, 'ast_test_1', 'gen-001', 'repr_v1', 'bge_m3_v1');
    for (const stmt of stmts) {
      await stmt.run();
    }

    // 3. Verify promotion
    const doc = mockSearchDocs.get('ast_test_1:gen-001');
    expect(doc?.status).toBe('active');
    expect(doc?.activated_at).toBeGreaterThan(0);

    const asset = mockAssets.get('ast_test_1');
    expect(asset?.status).toBe('ready');
    expect(asset?.search_ready).toBe(1);
    expect(asset?.active_index_gen).toBe('gen-001');
  });

  it('retrieves currently active generation for projection type', async () => {
    const activeGen = await getActiveIndexGeneration(mockDb, 'vectorize');
    expect(activeGen).toBe('gen-001');

    const missingGen = await getActiveIndexGeneration(mockDb, 'fts');
    expect(missingGen).toBeNull();
  });

  it('validates 0004_v2_indexing_projections.sql DDL completeness', () => {
    const migrationPath = resolve(__dirname, '../migrations/0004_v2_indexing_projections.sql');
    const ddl = readFileSync(migrationPath, 'utf-8');

    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS search_documents');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS projection_state');
    expect(ddl).toContain('idx_search_docs_lookup');
    expect(ddl).toContain('idx_search_docs_status');
    expect(ddl).toContain('INSERT OR IGNORE INTO projection_state');
  });
});
