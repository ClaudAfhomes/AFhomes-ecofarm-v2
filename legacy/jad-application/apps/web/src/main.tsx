import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';

import App from './app/App';
import { queryClient } from './lib/query';
import { SessionProvider } from './lib/session';
import { isSupabaseConfigured } from './lib/supabase';
import { createMemberMockServer } from './mock';

import '@jad/ui/tokens.css';
import '@jad/ui/base.css';
import './styles/global.css';

// Disable browser scroll restoration as early as possible - before the router mounts.
// This prevents the browser from restoring scroll position on navigation.
if ('scrollRestoration' in history) {
  history.scrollRestoration = 'manual';
}

// Dev-only mock API. Installed only when Supabase is not configured - with a
// backend, requests flow through the Vite proxy to api/v1 instead. The app
// talks to it through the real service functions (lib/api/client) exactly as
// it will talk to the backend in production.
if (import.meta.env.DEV && !isSupabaseConfigured()) {
  createMemberMockServer().install();
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

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
);
