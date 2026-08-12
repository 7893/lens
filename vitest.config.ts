import { defineConfig } from 'vitest/config';

export default defineConfig({
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
  },
});
