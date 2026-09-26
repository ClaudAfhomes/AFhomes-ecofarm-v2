import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ResetPasswordPage } from './ResetPasswordPage';
import { renderWithProviders } from '../../../test/utils';

const mocks = vi.hoisted(() => ({
  hasSession: false,
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: mocks.hasSession ? { user: { id: 'u' } } : null },
      }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      updateUser: mocks.updateUser,
      signOut: mocks.signOut,
    },
  }),
  isSupabaseConfigured: () => true,
}));

function renderReset() {
  return renderWithProviders(<ResetPasswordPage />, { route: '/auth/reset-password' });
}

describe('ResetPasswordPage (SCR-AUTH-006)', () => {
  beforeEach(() => {
    mocks.hasSession = false;
    mocks.updateUser.mockReset();
    mocks.signOut.mockReset();
    mocks.updateUser.mockResolvedValue({ error: null });
    mocks.signOut.mockResolvedValue(undefined);
  });

  it('shows the invalid/expired state without a recovery session', async () => {
    renderReset();

    expect(await screen.findByText('Link invalid or expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/auth/forgot-password',
    );
  });

  it('renders the new-password form when a recovery session is present', async () => {
    mocks.hasSession = true;
    renderReset();

    expect(
      await screen.findByRole('heading', { name: 'Choose a new password' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('New password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm new password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update password' })).toBeInTheDocument();
  });

  it('validates length and a matching confirmation', async () => {
    mocks.hasSession = true;
    const user = userEvent.setup();
    renderReset();

    await screen.findByLabelText('New password');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.type(screen.getByLabelText('Confirm new password'), 'different');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(screen.getByText('Password must be at least 8 characters.')).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(mocks.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password, signs out the recovery session, and confirms', async () => {
    mocks.hasSession = true;
    const user = userEvent.setup();
    renderReset();

    await screen.findByLabelText('New password');
    await user.type(screen.getByLabelText('New password'), 'NewPass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'NewPass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));

    expect(await screen.findByText('Password updated')).toBeInTheDocument();
    expect(mocks.updateUser).toHaveBeenCalledWith({ password: 'NewPass123' });
    expect(mocks.signOut).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login');
  });
});
