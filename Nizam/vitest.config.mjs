import { defineConfig } from 'vitest';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'api/__tests__/**/*.test.js', 'api/__tests__/**/*.spec.js'],
    setupFiles: ['src/test-setup.ts']
  }
});