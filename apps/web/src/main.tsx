import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';

import App from './app/App';
import { loadFeatureFlags } from './lib/feature-flags';
import { CustomerSessionProvider } from './lib/customer-session';
import { queryClient } from './lib/query';

import '@afhomes/ui/tokens.css';
import '@afhomes/ui/base.css';
import './styles/global.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found');
}

// Module switches decide which routes and links exist, so they load first.
void loadFeatureFlags().then(() =>
  createRoot(rootElement).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <CustomerSessionProvider>
            <App />
          </CustomerSessionProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </StrictMode>,
  ),
);
