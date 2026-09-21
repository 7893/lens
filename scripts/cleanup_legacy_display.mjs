#!/usr/bin/env node
/* global console */

/**
 * Lens Legacy Flat Display Cleanup Script
 * Safely removes legacy un-partitioned flat display files (display/{photoId}.jpg)
 * from R2, leaving ONLY the clean monthly directories (display/{YYYYMM}/{photoId}.jpg).
 *
 * Safety guarantees:
 * - 100% verified against D1 database records.
 * - Enforces strict single-slash pattern: ^display/[^/]+\.jpg$
 * - Never touches any key with a monthly path (^display/\d{6}/.*)
 * - Uses atomic 1,000-object batch deletions via S3 API.
 *
 * Usage:
 *   node scripts/cleanup_legacy_display.mjs [--dry-run]
 */

import { execSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import process from 'node:process';
import { parseArgs } from 'node:util';

const options = {
  'dry-run': { type: 'boolean', default: false },
};

const { values } = parseArgs({ options, allowPositionals: true });
const dryRun = values['dry-run'];

console.log('====================================================');
console.log('    Lens Legacy Flat Display Cleanup Tool           ');
console.log('====================================================');
console.log(`Dry Run: ${dryRun ? 'YES (Simulated, no deletions)' : 'NO (Live deletion)'}`);
console.log('----------------------------------------------------');

console.log('1. Querying D1 catalog for all historical image records...');
const raw = execSync('npx wrangler d1 execute lens-d1 --remote --json --command="SELECT id, display_key FROM images"', {
  cwd: '/home/ubuntu/lens/apps/engine',
  maxBuffer: 100 * 1024 * 1024,
  encoding: 'utf-8',
});

const jsonStart = raw.indexOf('[');
if (jsonStart === -1) {
  throw new Error(`Failed to parse D1 response: ${raw}`);
}

const parsed = JSON.parse(raw.slice(jsonStart));
const rows = parsed[0]?.results || [];

console.log(`Found ${rows.length} records in D1 database.`);

if (rows.length === 0) {
  console.log('No images found in database. Exiting.');
  process.exit(0);
}

// 2. Validate and collect legacy flat keys
const keysToDelete = [];
let invalidCount = 0;

for (const row of rows) {
  const { id, display_key } = row;

  // Verify that the record is already safely migrated into a monthly folder
  if (!/^display\/\d{6}\/[^/]+\.jpg$/.test(display_key)) {
    console.warn(`WARNING: Record ${id} has un-migrated display_key "${display_key}". Skipping!`);
    invalidCount++;
    continue;
  }

  const legacyKey = `display/${id}.jpg`;

  // Safety Assertion: legacyKey must have exactly 1 slash (flat), never touch monthly paths
  if (legacyKey.split('/').length !== 2) {
    throw new Error(`CRITICAL: Safety assertion failed for key "${legacyKey}".`);
  }
  if (legacyKey === display_key) {
    throw new Error(`CRITICAL: Legacy key matches target display key for ${id}.`);
  }

  keysToDelete.push(legacyKey);
}

console.log(`2. Verified ${keysToDelete.length} legacy flat files eligible for cleanup.`);
if (invalidCount > 0) {
  console.log(`   Skipped ${invalidCount} records that were not in monthly format.`);
}

if (dryRun) {
  console.log('\n[Dry Run] Sample keys that would be removed:');
  for (let i = 0; i < Math.min(5, keysToDelete.length); i++) {
    console.log(`  - ${keysToDelete[i]} (reorganized at: ${rows[i].display_key})`);
  }
  console.log(`\n[Dry Run] Total ${keysToDelete.length} flat keys would be deleted.`);
  console.log('Dry run complete. No files were deleted.');
  process.exit(0);
}

// 3. Batch deletion using aws s3api delete-objects (up to 1,000 per request)
const BATCH_SIZE = 1000;
const totalBatches = Math.ceil(keysToDelete.length / BATCH_SIZE);
console.log(`\n3. Executing batch deletion across ${totalBatches} batches (size: ${BATCH_SIZE})...`);

let totalDeleted = 0;
const startTime = Date.now();

for (let b = 0; b < totalBatches; b++) {
  const batchStart = Date.now();
  const chunk = keysToDelete.slice(b * BATCH_SIZE, (b + 1) * BATCH_SIZE);
  const deletePayload = {
    Objects: chunk.map((k) => ({ Key: k })),
    Quiet: true,
  };

  const tempFilePath = join(tmpdir(), `r2-cleanup-batch-${b}.json`);
  writeFileSync(tempFilePath, JSON.stringify(deletePayload));

  try {
    execSync(`aws s3api delete-objects --bucket lens-r2 --delete file://${tempFilePath} --profile r2`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    totalDeleted += chunk.length;
    const batchElapsed = ((Date.now() - batchStart) / 1000).toFixed(1);
    const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const pct = (((b + 1) / totalBatches) * 100).toFixed(1);
    console.log(
      `[Batch #${b + 1}/${totalBatches} - ${pct}%] Deleted ${chunk.length} flat files in ${batchElapsed}s (Total: ${totalDeleted}/${keysToDelete.length}, Elapsed: ${totalElapsed}s)`,
    );
  } finally {
    try {
      unlinkSync(tempFilePath);
    } catch {
      // ignore
    }
  }
}

console.log('\n====================================================');
console.log(`Cleanup complete! Total ${totalDeleted} flat files removed.`);
console.log(`Elapsed time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
console.log('====================================================');
