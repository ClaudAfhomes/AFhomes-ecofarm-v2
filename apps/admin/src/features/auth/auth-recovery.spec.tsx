/**
 * Phase 16 staff password recovery (admin SPA).
 *
 * Renders the REAL pages through the REAL router with only the Supabase
 * client stubbed, so redirect construction, enumeration-safe wording, session
 * gating, and the post-reset sign-out are all exercised, not assumed.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../app/App';
import { renderWithProviders } from '../../test/utils';
import { RECOVERY_SENT_MESSAGE } from '@jad/shared';
import { AdminForgotPasswordPage } from './AdminForgotPasswordPage';
import { AdminResetPasswordPage } from './AdminResetPasswordPage';

const supabaseMock = vi.hoisted(() => ({ impl: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: (...args: unknown[]) =>
    (supabaseMock.impl as (...a: unknown[]) => unknown)(...args),
}));

const authMock = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
}));

const client = () => ({
  auth: {
    resetPasswordForEmail: authMock.resetPasswordForEmail,
    getSession: authMock.getSession,
    onAuthStateChange: authMock.onAuthStateChange,
    updateUser: authMock.updateUser,
    signOut: authMock.signOut,
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  supabaseMock.impl.mockReturnValue(client());
  authMock.resetPasswordForEmail.mockResolvedValue({ error: null });
  authMock.getSession.mockResolvedValue({ data: { session: null } });
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  authMock.signOut.mockResolvedValue({});
});

const renderForgot = () =>
  renderWithProviders(<AdminForgotPasswordPage />, { route: '/admin/forgot-password' });

const renderReset = () =>
  renderWithProviders(<AdminResetPasswordPage />, { route: '/admin/reset-password' });

describe('admin forgot-password', () => {
  it('renders through the real /admin/forgot-password route', async () => {
    renderWithProviders(<App />, { route: '/admin/forgot-password' });
    expect(
      await screen.findByRole('heading', { name: /reset your password/i }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
  });

  it('sends a validated admin reset redirect for a valid email', async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'staff@afhomes.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() =>
      expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith('staff@afhomes.test', {
        redirectTo: 'http://localhost:5174/admin/reset-password',
      }),
    );
    expect(await screen.findByText(RECOVERY_SENT_MESSAGE)).toBeInTheDocument();
  });

  it('shows the SAME generic success for an unknown address (no enumeration)', async () => {
    const user = userEvent.setup();
    authMock.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'nobody@afhomes.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(RECOVERY_SENT_MESSAGE)).toBeInTheDocument();
  });

  it('rejects a malformed email without calling Supabase', async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'not-an-email');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(/valid email address/i)).toBeInTheDocument();
    expect(authMock.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('reports rate limits without leaking account state', async () => {
    const user = userEvent.setup();
    authMock.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, message: 'slow' } });
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'staff@afhomes.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.queryByText(RECOVERY_SENT_MESSAGE)).toBeNull();
  });

  it('reports an unavailable provider when Supabase is unconfigured', async () => {
    const user = userEvent.setup();
    supabaseMock.impl.mockReturnValue(null);
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'staff@afhomes.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(/unavailable right now/i)).toBeInTheDocument();
  });
});

describe('admin reset-password', () => {
  it('renders through the real /admin/reset-password route', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    renderWithProviders(<App />, { route: '/admin/reset-password' });
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it('requires a recovery session: no session is an invalid link', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: null } });
    renderReset();
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/admin/forgot-password',
    );
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('treats a Supabase error redirect as an expired link', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'x' } } } });
    window.history.replaceState(
      null,
      '',
      '/admin/reset-password?error=access_denied&error_code=otp_expired',
    );
    renderReset();
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    window.history.replaceState(null, '', '/admin/reset-password');
  });

  it('rejects a weak password and a mismatch without calling updateUser', async () => {
    const user = userEvent.setup();
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'x' } } } });
    renderReset();
    const passwordField = await screen.findByLabelText('New password');
    const confirmField = screen.getByLabelText('Confirm new password');
    await user.type(passwordField, 'short');
    await user.type(confirmField, 'short');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();

    await user.clear(passwordField);
    await user.clear(confirmField);
    await user.type(passwordField, 'ValidPass123');
    await user.type(confirmField, 'Different123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('updates, signs the recovery session out, and sends staff back to login', async () => {
    const user = userEvent.setup();
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'x' } } } });
    authMock.updateUser.mockResolvedValue({ error: null });
    renderReset();
    await user.type(await screen.findByLabelText('New password'), 'ValidPass123');
    await user.type(screen.getByLabelText('Confirm new password'), 'ValidPass123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    await waitFor(() =>
      expect(authMock.updateUser).toHaveBeenCalledWith({ password: 'ValidPass123' }),
    );
    expect(authMock.signOut).toHaveBeenCalled();
    expect(await screen.findByText(/password has been updated/i)).toBeInTheDocument();
    // Recovery ends at the ordinary staff sign-in, where account status is
    // enforced again - never inside the console.
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/admin/login',
    );
  });
});

describe('recovery pages never log or persist secrets', () => {
  it('contains no password/token sink in the new auth sources', () => {
    for (const file of ['AdminForgotPasswordPage.tsx', 'AdminResetPasswordPage.tsx']) {
      const source = readFileSync(join(__dirname, file), 'utf8');
      expect(source, file).not.toMatch(/console\.(log|error|warn|info|debug)/);
      expect(source, file).not.toMatch(/localStorage|sessionStorage/);
      // No secret-bearing identifier: the prose phrase "service-role" in a
      // comment is fine, a key reference or client is not.
      expect(source, file).not.toMatch(/SUPABASE_SERVICE_ROLE|serviceClient|service_role_key/i);
    }
  });
});
