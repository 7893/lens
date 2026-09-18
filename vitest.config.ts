import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      'cloudflare:workers': path.resolve(__dirname, './apps/engine/tests/mocks/cloudflare-workers.ts'),
    },
  },

  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      exclude: ['packages/shared/dist/**', '**/node_modules/**'],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 20,
        statements: 60,
      },
    },
    testTimeout: 30000,
  },
});
