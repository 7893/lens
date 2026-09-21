#!/usr/bin/env node
/* global console, fetch, setTimeout */

/**
 * Lens Historical Image Storage Reorganization Script (方案一)
 * Migrates historical images into monthly archives:
 * - Raw: {YYYYMM}/{photoId}.jpg (backup)
 * - Display: display/{YYYYMM}/{photoId}.jpg (Web thumbnails)
 *
 * Usage:
 *   node scripts/migrate_storage.mjs [--batch-size 50] [--max-batches 10] [--endpoint <url>]
 */

import process from 'node:process';
import { parseArgs } from 'node:util';

const options = {
  'batch-size': { type: 'string', default: '80' },
  'max-batches': { type: 'string', default: '0' },
  endpoint: { type: 'string', default: 'https://lens.53.workers.dev' },
  'delete-old': { type: 'boolean', default: false },
  workers: { type: 'string', default: '2' },
  order: { type: 'string', default: 'desc' },
};

const { values } = parseArgs({ options, allowPositionals: true });

const batchSize = Math.max(1, Math.min(parseInt(values['batch-size'], 10) || 80, 200));
const maxBatches = parseInt(values['max-batches'], 10) || 0;
const endpoint = values.endpoint.replace(/\/+$/, '');
const deleteOld = values['delete-old'] || false;
const workerCount = Math.max(1, Math.min(parseInt(values.workers, 10) || 1, 2));
const defaultOrder = values.order === 'asc' ? 'asc' : 'desc';

console.log('====================================================');
console.log('   Lens Historical Storage Reorganization (方案一)   ');
console.log('====================================================');
console.log(`Endpoint:    ${endpoint}`);
console.log(`Batch Size:  ${batchSize}`);
console.log(`Workers:     ${workerCount}`);
console.log(`Order:       ${workerCount === 2 ? 'Dual (Worker 1: DESC, Worker 2: ASC)' : defaultOrder}`);
console.log(`Max Batches: ${maxBatches === 0 ? 'Unlimited (until complete)' : maxBatches}`);
console.log(`Delete Old:  ${deleteOld}`);
console.log('----------------------------------------------------');

async function getStatus() {
  const res = await fetch(`${endpoint}/internal/storage/reorganize`);
  if (!res.ok) throw new Error(`Status check failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function runBatch(size, delOld, order) {
  const res = await fetch(`${endpoint}/internal/storage/reorganize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ limit: size, deleteOld: delOld, order }),
  });
  if (!res.ok) throw new Error(`Batch execution failed: ${res.status} ${await res.text()}`);
  return await res.json();
}

async function main() {
  const initialStatus = await getStatus();
  console.log(`Initial Status:`);
  console.log(`  Total Images:        ${initialStatus.total}`);
  console.log(`  Already Reorganized: ${initialStatus.reorganized}`);
  console.log(`  Pending Migration:   ${initialStatus.pending}`);
  console.log(`  Progress:            ${initialStatus.percentage}%\n`);

  if (initialStatus.pending === 0) {
    console.log('All historical images are already reorganized! Nothing to do.');
    return;
  }

  let totalMigrated = 0;
  let shouldStop = false;
  const startTime = Date.now();

  async function workerLoop(workerId, order) {
    let batchCount = 0;
    while (!shouldStop) {
      batchCount++;
      const batchStart = Date.now();

      try {
        const response = await runBatch(batchSize, deleteOld, order);
        const result = response.result || {};
        const migrated = result.migrated || 0;
        const remaining = result.remaining ?? 0;
        totalMigrated += migrated;

        const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);
        const batchSec = ((Date.now() - batchStart) / 1000).toFixed(1);
        const percentage =
          initialStatus.total > 0
            ? (((initialStatus.total - remaining) / initialStatus.total) * 100).toFixed(2)
            : '100.00';

        console.log(
          `[Worker #${workerId} (${order.toUpperCase()}) Batch #${batchCount}] Migrated: ${migrated}, Remaining: ${remaining} (${percentage}%) in ${batchSec}s (Total in run: ${totalMigrated}, Elapsed: ${elapsedSec}s)`,
        );

        if (result.processed === 0 || remaining === 0) {
          shouldStop = true;
          break;
        }

        if (maxBatches > 0 && batchCount >= maxBatches) {
          console.log(`[Worker #${workerId}] Reached max batches limit (${maxBatches}).`);
          break;
        }

        await new Promise((resolve) => setTimeout(resolve, 200));
      } catch (err) {
        console.error(`[Worker #${workerId} Batch #${batchCount} Error] ${err.message}. Retrying in 3s...`);
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    }
  }

  if (workerCount === 2) {
    await Promise.all([workerLoop(1, 'desc'), workerLoop(2, 'asc')]);
  } else {
    await workerLoop(1, defaultOrder);
  }

  const finalStatus = await getStatus();
  console.log('\n----------------------------------------------------');
  console.log('Final Status:');
  console.log(`  Total Images:        ${finalStatus.total}`);
  console.log(`  Reorganized:         ${finalStatus.reorganized}`);
  console.log(`  Pending:             ${finalStatus.pending}`);
  console.log(`  Final Progress:      ${finalStatus.percentage}%`);
  console.log('====================================================');
}

main().catch((err) => {
  console.error('Fatal error during migration:', err);
  process.exit(1);
});
