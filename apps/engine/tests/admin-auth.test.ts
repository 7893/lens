import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { ApiBindings } from '@lens/shared';
import { adminAuth } from '../src/middleware/adminAuth';
import admin from '../src/routes/admin';

const secret = 'test-only-administrative-secret-32-characters';
const env = () =>
  ({
    INTERNAL_API_SECRET: secret,
    ADMIN_RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
  }) as unknown as ApiBindings;
const app = new Hono<{ Bindings: ApiBindings }>();
app.use('*', adminAuth);
app.get('/', (c) => c.json({ ok: true }));

describe('administrative access', () => {
  it('rejects missing secrets even in development', async () => {
    expect((await app.request('/', {}, { ENVIRONMENT: 'development' } as ApiBindings)).status).toBe(503);
  });
  it('rejects forged identity headers and invalid tokens', async () => {
    for (const headers of [
      {},
      { 'cf-access-authenticated-user-email': 'admin@example.test' },
      { authorization: 'Bearer fake' },
    ]) {
      expect((await app.request('/', { headers }, env())).status).toBe(401);
    }
  });
  it('accepts the configured bearer and fails closed on limiter outages', async () => {
    const bindings = env();
    const options = { headers: { authorization: `Bearer ${secret}` } };
    expect((await app.request('/', options, bindings)).status).toBe(200);
    bindings.ADMIN_RATE_LIMITER = {
      limit: async () => {
        throw new Error('offline');
      },
    };
    expect((await app.request('/', options, bindings)).status).toBe(503);
    bindings.ADMIN_RATE_LIMITER = { limit: async () => ({ success: false }) };
    expect((await app.request('/', options, bindings)).status).toBe(429);
  });
  it('protects compensation before external calls and rejects invalid batches', async () => {
    expect((await admin.request('/compensate', { method: 'POST' }, env())).status).toBe(401);
    for (const body of [
      '{',
      JSON.stringify({ photoIds: ['../bad'] }),
      JSON.stringify({ photoIds: Array(21).fill('photo') }),
    ]) {
      expect(
        (
          await admin.request(
            '/compensate',
            {
              method: 'POST',
              headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
              body,
            },
            env(),
          )
        ).status,
      ).toBe(400);
    }
  });
});
