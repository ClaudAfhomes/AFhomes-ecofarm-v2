import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { SessionProvider, type SessionUser } from '../lib/session';

type ProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  route?: string;
  user?: SessionUser;
  queryClient?: QueryClient;
};

/** Fresh, retry-free QueryClient so tests never wait on backoff. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/**
 * Test renderer mirroring the providers used in `main.tsx`: fresh QueryClient
 * (no retries), MemoryRouter, and the resolved session provider.
 */
export function renderWithProviders(
  ui: ReactElement,
  { route = '/admin', user, queryClient = createTestQueryClient(), ...renderOptions }: ProvidersOptions = {},
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <SessionProvider initialUser={user}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper, ...renderOptions });
  return { ...result, client: queryClient };
}

export * from '@testing-library/react';
