import { render, type RenderOptions } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { MemoryRouter } from 'react-router';

import { CustomerSessionProvider } from '../lib/customer-session';
import type { CustomerSessionUser } from '../lib/customer-session';

type ProvidersOptions = Omit<RenderOptions, 'wrapper'> & {
  route?: string;
  queryClient?: QueryClient;
  /**
   * The Auth session the test pretends to hold. `null` (the default) means
   * signed out, so a guard test must opt in explicitly.
   */
  sessionUser?: CustomerSessionUser | null;
};

/** Fresh, retry-free QueryClient so tests never wait on backoff. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Renders a tree with the app's providers (Query client + Router + session). */
export function renderWithProviders(ui: ReactElement, options: ProvidersOptions = {}) {
  const {
    route = '/',
    queryClient = createTestQueryClient(),
    sessionUser = null,
    ...renderOptions
  } = options;

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={[route]}>
          <CustomerSessionProvider initialUser={sessionUser}>
            {children}
          </CustomerSessionProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...renderOptions });
}

export * from '@testing-library/react';
