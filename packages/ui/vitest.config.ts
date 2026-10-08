/// <reference types="vitest/config" />
import { defineConfig } from 'vite';

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    // Same headroom apps/web and apps/admin give their runs, for the same
    // reason: jsdom + user-event files run in parallel alongside six other
    // workspace packages, and a wall-clock timeout measures machine speed, not
    // behaviour. user-event's per-keystroke waits are what cross 5s.
    testTimeout: 30000,
  },
});
