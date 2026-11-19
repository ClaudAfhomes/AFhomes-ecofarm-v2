import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './app/App';
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
