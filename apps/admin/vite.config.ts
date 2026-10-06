/// <reference types="vitest/config" />
import { fileURLToPath, URL } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  // Served under /admin on the same origin as the web app + API in production
  // (see scripts/assemble-vercel-output.mjs); local dev keeps the root base.
  base: mode === 'production' ? '/admin/' : '/',
  // Single shared env source: repo-root `.env.local` (see AGENTS.md). Vite only
  // inlines `VITE_`-prefixed vars, so server-only keys in that file stay safe.
  // Without this, a documented root-only setup leaves VITE_SUPABASE_URL empty
  // and staff login fails with a generic "could not sign you in".
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5174,
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
    // Mirror apps/web: heavy shell/page suites exceed the 5s default under
    // parallel load and flake without headroom.
    testTimeout: 30000,
  },
}));
