import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: process.env.LIVE_TEST === '1' ? [] : ['tests/live/**', 'node_modules/**'],
  },
});
