import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ForgotPasswordPage } from './ForgotPasswordPage';
import { renderWithProviders } from '../../../test/utils';

const mocks = vi.hoisted(() => ({
  configured: false,
  resetPasswordForEmail: vi.fn(),
}));

vi.mock('../../../lib/supabase', () => ({
  getSupabaseClient: () =>
    mocks.configured ? { auth: { resetPasswordForEmail: mocks.resetPasswordForEmail } } : null,
  isSupabaseConfigured: () => mocks.configured,
}));

function renderForgot() {
  return renderWithProviders(<ForgotPasswordPage />, { route: '/auth/forgot-password' });
}

describe('ForgotPasswordPage (SCR-AUTH-006)', () => {
  beforeEach(() => {
    mocks.configured = false;
    mocks.resetPasswordForEmail.mockReset();
    mocks.resetPasswordForEmail.mockResolvedValue({ error: null });
  });

  it('renders the recovery request form', () => {
    renderForgot();

    expect(screen.getByRole('heading', { name: 'Forgot your password?' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeInTheDocument();
  });

  it('validates the email before submitting', async () => {
    const user = userEvent.setup();
    renderForgot();

    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Email address'), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
  });

  it('shows an error when password recovery is unavailable', async () => {
    const user = userEvent.setup();
    renderForgot();

    await user.type(screen.getByLabelText('Email address'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(
      await screen.findByText('Password reset is unavailable right now. Please try again later.'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Check your email')).not.toBeInTheDocument();
    expect(mocks.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('requests a reset email via Supabase and links back to login', async () => {
    mocks.configured = true;
    const user = userEvent.setup();
    renderForgot();

    await user.type(screen.getByLabelText('Email address'), 'a@b.com');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));

    expect(await screen.findByText('Check your email')).toBeInTheDocument();
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith('a@b.com', {
      redirectTo: expect.stringContaining('/auth/reset-password'),
    });
    expect(screen.getByRole('link', { name: 'Back to login' })).toHaveAttribute('href', '/login');
  });
});
