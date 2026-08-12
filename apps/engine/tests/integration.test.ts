import { unstable_dev, type UnstableDevWorker } from 'wrangler';
import { describe, beforeAll, afterAll, it, expect } from 'vitest';

describe('Lens Engine E2E Integration', () => {
  let worker: UnstableDevWorker;

  beforeAll(async () => {
    worker = await unstable_dev('apps/engine/src/index.ts', {
      experimental: { disableExperimentalWarning: true },
    });
  });

  afterAll(async () => {
    if (worker) {
      await worker.stop();
    }
  });

  it('responds with 404 for unknown endpoints', async () => {
    const resp = await worker.fetch('/api/unknown-xyz');
    expect(resp.status).toBe(404);
  });

  it('search API rejects missing query parameter', async () => {
    const resp = await worker.fetch('/api/search');
    expect(resp.status).toBe(400);
    const text = await resp.text();
    expect(text).toContain('Missing query param');
  });

  it('stats API rejects invalid payload format', async () => {
    const resp = await worker.fetch('/api/stats/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'data' }),
    });
    // Expected to fail validation
    expect(resp.status).toBe(400);
  });
});
