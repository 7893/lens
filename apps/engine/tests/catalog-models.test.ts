import { describe, it, expect } from 'vitest';
import {
  AssetRecord,
  AssetSourceRecord,
  MediaObjectRecord,
  RepresentationRecord,
  ProcessingRunRecord,
  OutboxEventRecord,
  ConsumedEventRecord,
} from '../src/modules/catalog';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Catalog Domain Models (Phase 2)', () => {
  it('instantiates valid AssetRecord with ADR-0006 invariants', () => {
    const asset: AssetRecord = {
      id: 'ast_abc123',
      source_provider: 'unsplash',
      source_external_id: 'photo_999',
      status: 'ready',
      search_ready: 1,
      active_representation_version: 'repr-v1',
      active_embedding_version: 'bge-m3-v1',
      active_index_generation: 'gen-001',
      created_at: 1770000000000,
      updated_at: 1770000000000,
    };

    expect(asset.id).toBe('ast_abc123');
    expect(asset.status).toBe('ready');
    expect(asset.search_ready).toBe(1);
  });

  it('instantiates valid MediaObjectRecord for canonical Master', () => {
    const media: MediaObjectRecord = {
      content_hash: '72114572b1fb4f144b7848efec4a55d5d8a8b43b772bb18a1c6f7c1ca958168e',
      variant_kind: 'master',
      r2_key: 'media/72114572b1fb4f144b7848efec4a55d5d8a8b43b772bb18a1c6f7c1ca958168e/master.jpg',
      byte_size: 4096123,
      width: 3840,
      height: 2160,
      mime_type: 'image/jpeg',
      created_at: 1770000000000,
    };

    expect(media.variant_kind).toBe('master');
    expect(media.r2_key).toContain('media/72114572b1fb4f144b7848efec4a55d5d8a8b43b772bb18a1c6f7c1ca958168e/master.jpg');
    expect(media.byte_size).toBeGreaterThan(0);
  });

  it('instantiates valid AssetSourceRecord preserving photographer attribution and license', () => {
    const source: AssetSourceRecord = {
      provider: 'unsplash',
      external_id: 'photo_999',
      asset_id: 'ast_abc123',
      canonical_url: 'https://unsplash.com/photos/photo_999',
      author_name: 'John Curator',
      author_url: 'https://unsplash.com/@curator',
      license: 'Unsplash License',
      retention_policy: 'standard',
      raw_json: '{"exif":{"model":"Canon R5"}}',
      observed_at: 1770000000000,
    };

    expect(source.author_name).toBe('John Curator');
    expect(source.license).toBe('Unsplash License');
  });

  it('instantiates valid RepresentationRecord and ProcessingRunRecord', () => {
    const repr: RepresentationRecord = {
      id: 'repr_1',
      asset_id: 'ast_abc123',
      representation_version: 'v1',
      model_name: 'llama-scout',
      caption: 'Test caption',
      tags_json: '["mountain"]',
      entities_json: '["Alps"]',
      quality_score: 9.0,
      embedding_version: 'bge-m3-v1',
      created_at: 1770000000000,
    };
    expect(repr.caption).toBe('Test caption');
    expect(repr.quality_score).toBe(9.0);

    const run: ProcessingRunRecord = {
      run_id: 'process:ast_abc123:v1',
      asset_id: 'ast_abc123',
      pipeline_version: 'v1',
      status: 'completed',
      step_checkpoint: 'sync-vectorize',
      error_details: null,
      started_at: 1770000000000,
      completed_at: 1770000005000,
    };
    expect(run.status).toBe('completed');
  });

  it('instantiates valid OutboxEventRecord and ConsumedEventRecord', () => {
    const outbox: OutboxEventRecord = {
      event_id: 'evt_100',
      type: 'asset.ready',
      schema_version: 1,
      aggregate_type: 'asset',
      aggregate_id: 'ast_abc123',
      aggregate_version: 1,
      correlation_id: 'trace_100',
      causation_id: null,
      payload_json: '{"ready":true}',
      occurred_at: 1770000000000,
      dispatched_at: null,
    };
    expect(outbox.dispatched_at).toBeNull();

    const consumed: ConsumedEventRecord = {
      consumer: 'index_projector',
      event_id: 'evt_100',
      consumed_at: 1770000001000,
    };
    expect(consumed.consumer).toBe('index_projector');
  });

  it('validates 0003_v2_canonical_models.sql DDL completeness', () => {
    const migrationPath = resolve(__dirname, '../migrations/0003_v2_canonical_models.sql');
    const ddl = readFileSync(migrationPath, 'utf-8');

    // Asserts all 7 core tables from ADR-0006 Section 6 are present in migration
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS assets');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS asset_sources');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS media_objects');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS representations');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS processing_runs');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS outbox_events');
    expect(ddl).toContain('CREATE TABLE IF NOT EXISTS consumed_events');

    // Asserts critical index and constraints
    expect(ddl).toContain('idx_assets_source');
    expect(ddl).toContain('idx_media_objects_r2_key');
    expect(ddl).toContain('idx_outbox_pending');
  });
});
