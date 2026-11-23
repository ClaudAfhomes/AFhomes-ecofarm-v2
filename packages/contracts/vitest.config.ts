/// <reference types="vitest/config" />
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.spec.{ts,tsx}'],
    // Same headroom apps/web and apps/admin give their full-suite runs, for the
    // same reason: these files run in parallel across eight workspace packages,
    // and a wall-clock timeout is a machine-speed measurement, not a behaviour.
    // The customer-code test generates 1,000 codes and takes ~120ms on its own,
    // which is comfortably inside 5s - but not when seven other packages
    // compete for the CPU at once.
    testTimeout: 30000,
  },
});