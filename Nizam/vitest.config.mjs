import { defineConfig } from 'vitest/config';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  // Without this plugin Angular's `templateUrl`/`styleUrl` are never compiled,
  // so TestBed reports "Component 'X' is not resolved".
  plugins: [angular()],
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/*.spec.ts', 'api/__tests__/**/*.test.js', 'api/__tests__/**/*.spec.js'],
    setupFiles: ['src/test-setup.ts'],
    // A hanging spec would otherwise block the whole run indefinitely, since
    // nothing in this suite has a natural timeout.
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});