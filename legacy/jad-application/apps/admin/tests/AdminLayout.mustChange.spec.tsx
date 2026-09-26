import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { MOCK_SUPER_ADMIN } from '@jad/mock';

import { SessionProvider } from '../lib/session';
import { AdminLayout } from './AdminLayout';
/**
 * While a temporary-password change is required, the admin shell must not
 * fire admin data requests (they 403) and must recover cleanly once the flag
 * clears. Red: AdminLayout fires useRoles/useAdminQueues unconditionally.
 */
describe('AdminLayout mustChangePassword', () => {
  const requested: string[] = [];
  let client: QueryClient;

  function renderWithFlag(mustChangePassword: boolean) {
    return (
      <SessionProvider initialUser={{ ...MOCK_SUPER_ADMIN, mustChangePassword }} restoreDelayMs={0}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin']}>
            <AdminLayout />
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>
    );
  }

  beforeEach(() => {
    requested.length = 0;
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/admin/')) requested.push(url);
      if (url.includes('/admin/roles')) return Response.json({ data: [], meta: {} });
      if (url.includes('/admin/queues'))
        return Response.json({
          registrations: 0,
          sales: 0,
          salesSubmitted: 0,
          salesReadyToQualify: 0,
          members: 0,
          withdrawals: 0,
        });
      return Response.json({ error: { code: 'NOT_FOUND' } }, { status: 404 });
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('does not fetch admin data while a password change is required', async () => {
    render(renderWithFlag(true));
    await screen.findByAltText('JA&D');
    await new Promise((r) => setTimeout(r, 50));
    expect(requested).toEqual([]);
  });

  it('hides navigation while a password change is required', async () => {
    render(renderWithFlag(true));
    await screen.findByAltText('JA&D');
    expect(screen.queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Members' })).not.toBeInTheDocument();
    // No spurious "unavailable" warning - the empty nav is intentional here.
    expect(screen.queryByText('Navigation unavailable')).not.toBeInTheDocument();
  });

  it('fetches admin data once the flag clears', async () => {
    const { rerender } = render(renderWithFlag(true));
    await screen.findByAltText('JA&D');
    expect(requested).toEqual([]);

    rerender(renderWithFlag(false));
    await waitFor(() => expect(requested.length).toBeGreaterThan(0));
    expect(requested.some((u) => u.includes('/admin/roles'))).toBe(true);
    // The badge count comes from the cheap /admin/queues counts, not the full
    // registrations list (the list is fetched only on the registrations page).
    expect(requested.some((u) => u.includes('/admin/queues'))).toBe(true);
  });

  it('does not fetch admin data while the session is still resolving', async () => {
    // No initialUser -> the mock session stays 'loading' for the restore
    // window. mustChangePassword defaults to false while loading, but the
    // admin queries must wait for an authenticated session (otherwise they
    // 403 against verifyStaff before the flag is even known).
    render(
      <SessionProvider restoreDelayMs={1000}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={['/admin']}>
            <AdminLayout />
          </MemoryRouter>
        </QueryClientProvider>
      </SessionProvider>,
    );
    await screen.findByAltText('JA&D');
    await new Promise((r) => setTimeout(r, 100));
    expect(requested).toEqual([]);
  });
});
