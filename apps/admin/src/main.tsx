import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './app/App';
import { preloadAdminShell } from './app/preload-shell';
import { loadFeatureFlags } from './lib/feature-flags';
import { queryClient } from './lib/query';
import { SessionProvider } from './lib/session';

import '@afhomes/ui/tokens.css';
import '@afhomes/ui/base.css';
import './styles/global.css';

// Installed only when Supabase is not configured - with a backend, requests
// flow through the Vite proxy to api/v1 instead.
const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Module switches decide which routes and links exist, so they load first.
// Protected entries need the shell; overlap its download without loading it on public entries.
void preloadAdminShell(window.location.pathname).catch(() => {
  // The routed import retains the normal error-boundary path if this speculative fetch fails.
});
void loadFeatureFlags().then(() =>
  createRoot(rootElement).render(
    <StrictMode>
      <SessionProvider>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </SessionProvider>
    </StrictMode>,
  ),
);
