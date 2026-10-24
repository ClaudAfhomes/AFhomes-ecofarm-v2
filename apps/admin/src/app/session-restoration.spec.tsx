import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
      signOut: vi.fn(),
    },
  }),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn(),
  clearSession: vi.fn(),
}));

import { renderWithProviders } from '../test/utils';
import App from './App';

beforeEach(() => {
  vi.clearAllMocks();
  auth.getSession.mockImplementation(() => new Promise(() => {}));
  auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

describe('admin session restoration', () => {
  it('hands an OST identity back to portal routing instead of rendering a stale IST screen', async () => {
    renderWithProviders(<App />, { route: '/sales/genealogy', user: {
      id: '146e27b9-d2d8-4b62-8329-179302b446ff', name: 'Mariel Soriano',
      email: 'mariel@afhomes-local.test', roleId: 'ost-role', roleSlug: 'ost',
      roleName: 'OST', status: 'active', afHomesPermissions: [],
    } });
    expect(await screen.findByRole('heading', { name: 'Staff Login' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Page not found' })).not.toBeInTheDocument();
  });
  it('does not render protected mutation controls while authentication is restoring', async () => {
    renderWithProviders(<App />, { route: '/admin/staff' });

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
  });
});
