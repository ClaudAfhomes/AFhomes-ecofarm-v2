import { screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const shell = vi.hoisted(() => ({ loaded: vi.fn() }));

vi.mock('./AdminLayout', () => {
  shell.loaded();
  return { AdminLayout: () => null };
});
vi.mock('../lib/supabase', () => ({
  getSupabaseClient: () => null,
  isSupabaseConfigured: () => false,
}));
vi.mock('../lib/portals', () => ({
  getAuthPortals: async () => ({ customer: null, staff: null, ost: null }),
}));

import { renderWithProviders } from '../test/utils';
import App from './App';
import { preloadAdminShell } from './preload-shell';

it('renders the public staff login without downloading the signed-in shell', async () => {
  renderWithProviders(<App />, { route: '/admin/login' });
  expect(await screen.findByRole('heading', { name: 'Admin Login' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /^sign in$/i })).toBeInTheDocument();
  expect(shell.loaded).not.toHaveBeenCalled();
  await preloadAdminShell('/staff/login');
  await preloadAdminShell('/admin/reset-password');
  await preloadAdminShell('/admin/mfa');
  expect(shell.loaded).not.toHaveBeenCalled();
  await preloadAdminShell('/finance/customers');
  expect(shell.loaded).toHaveBeenCalledTimes(1);
});
