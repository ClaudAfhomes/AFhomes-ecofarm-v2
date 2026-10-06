/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Single shared env source: repo-root `.env.local` (see AGENTS.md). Vite only
  // inlines `VITE_`-prefixed vars, so server-only keys in that file stay safe.
  // Tests stay hermetic: under `vitest` (mode === 'test') the app-local dir is
  // used, so a developer's real `.env.local` can never leak URLs or keys into
  // assertions that pin schema defaults (e.g. recovery redirect origins).
  envDir:
    mode === 'test'
      ? fileURLToPath(new URL('./', import.meta.url))
      : fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.spec.{ts,tsx}'],
    // Full-suite files run in parallel; heavy user-event flows need headroom.
    testTimeout: 30000,
  },
}));
