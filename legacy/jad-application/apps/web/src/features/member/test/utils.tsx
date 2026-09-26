import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter } from 'react-router';

import { SessionProvider, type SessionUser } from '../../../lib/session';

/**
 * Member-panel test renderer: fresh QueryClient (no retries), MemoryRouter,
 * and the app session provider (restore instant).
 */
export function renderMember(
  ui: ReactElement,
  { route = '/member', user }: { route?: string; user?: SessionUser } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const result = render(
    <SessionProvider initialUser={user} restoreDelayMs={0}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </QueryClientProvider>
    </SessionProvider>,
  );
  return { ...result, client };
}
