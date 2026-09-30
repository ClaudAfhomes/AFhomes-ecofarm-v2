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
  it('does not render protected mutation controls while authentication is restoring', async () => {
    renderWithProviders(<App />, { route: '/admin/staff' });

    expect(await screen.findByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'New Staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deactivate' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Permanently' })).not.toBeInTheDocument();
  });
});
