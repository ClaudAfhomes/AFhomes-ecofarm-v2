/**
 * Phase 16 customer password recovery (web SPA).
 *
 * Renders the REAL pages through the REAL router with only the Supabase
 * client stubbed. Also proves the marketing `/:slug` route cannot swallow
 * the new `/customer/*` recovery paths.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../app/App';
import { renderWithProviders } from '../../test/utils';
import { RECOVERY_SENT_MESSAGE } from '@afhomes/shared';
import { CustomerForgotPasswordPage } from './CustomerForgotPasswordPage';
import { CustomerResetPasswordPage } from './CustomerResetPasswordPage';

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  window.scrollTo = vi.fn() as never;
  supabaseMock.impl.mockReturnValue({
    auth: {
      resetPasswordForEmail: authMock.resetPasswordForEmail,
      getSession: authMock.getSession,
      onAuthStateChange: authMock.onAuthStateChange,
      updateUser: authMock.updateUser,
      signOut: authMock.signOut,
    },
  });
  authMock.resetPasswordForEmail.mockResolvedValue({ error: null });
  authMock.getSession.mockResolvedValue({ data: { session: null } });
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  authMock.signOut.mockResolvedValue({});
  window.history.replaceState(null, '', '/');
});

const renderForgot = () =>
  renderWithProviders(<CustomerForgotPasswordPage />, { route: '/customer/forgot-password' });

const renderReset = () =>
  renderWithProviders(<CustomerResetPasswordPage />, { route: '/customer/reset-password' });

describe('customer forgot-password', () => {
  it('renders through the real /customer/forgot-password route, not the marketing 404', async () => {
    renderWithProviders(<App />, { route: '/customer/forgot-password' });
    expect(
      await screen.findByRole('heading', { name: /reset your password/i }),
    ).toBeInTheDocument();
  });

  it('sends a validated customer reset redirect for a valid email', async () => {
    const user = userEvent.setup();
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'member@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    await waitFor(() =>
      expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith('member@example.com', {
        redirectTo: 'http://localhost:5173/customer/reset-password',
      }),
    );
    expect(await screen.findByText(RECOVERY_SENT_MESSAGE)).toBeInTheDocument();
  });

  it('shows the SAME generic success for an unknown address (no enumeration)', async () => {
    const user = userEvent.setup();
    authMock.resetPasswordForEmail.mockResolvedValue({ error: { message: 'User not found' } });
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'nobody@example.com');
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

  it('reports rate limits and an unavailable provider safely', async () => {
    const user = userEvent.setup();
    authMock.resetPasswordForEmail.mockResolvedValue({ error: { status: 429, message: 'x' } });
    renderForgot();
    await user.type(screen.getByLabelText(/email/i), 'member@example.com');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(await screen.findByText(/too many attempts/i)).toBeInTheDocument();
    expect(screen.queryByText(RECOVERY_SENT_MESSAGE)).toBeNull();
  });
});

describe('customer reset-password', () => {
  it('renders through the real /customer/reset-password route', async () => {
    renderWithProviders(<App />, { route: '/customer/reset-password' });
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
  });

  it('requires a recovery session and never touches onboarding tokens', async () => {
    renderReset();
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute(
      'href',
      '/customer/forgot-password',
    );
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('treats a Supabase error redirect as an expired link', async () => {
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'x' } } } });
    window.history.replaceState(null, '', '/customer/reset-password?error=access_denied');
    renderReset();
    expect(await screen.findByText(/invalid or has expired/i)).toBeInTheDocument();
    window.history.replaceState(null, '', '/customer/reset-password');
  });

  it('rejects a weak password and a mismatch without calling updateUser', async () => {
    const user = userEvent.setup();
    authMock.getSession.mockResolvedValue({ data: { session: { user: { id: 'x' } } } });
    renderReset();
    const passwordField = await screen.findByLabelText('New password');
    const confirmField = screen.getByLabelText('Confirm new password');
    await user.type(passwordField, 'weak');
    await user.type(confirmField, 'weak');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();

    await user.clear(passwordField);
    await user.clear(confirmField);
    await user.type(passwordField, 'ValidPass123');
    await user.type(confirmField, 'OtherPass123');
    await user.click(screen.getByRole('button', { name: /update password/i }));
    expect(await screen.findByText(/do not match/i)).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('updates, signs out, and returns the member to customer login', async () => {
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
    // Recovery ends at the ordinary customer sign-in, where ownership and
    // status are enforced again - never inside the portal.
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/customer/login',
    );
  });
});

describe('recovery pages never log or persist secrets', () => {
  it('contains no password/token sink in the new customer sources', () => {
    const stripComments = (text: string) =>
      text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .map((line) => (line.trimStart().startsWith('//') ? '' : line))
        .join('\n');
    for (const file of ['CustomerForgotPasswordPage.tsx', 'CustomerResetPasswordPage.tsx']) {
      const source = stripComments(readFileSync(join(__dirname, file), 'utf8'));
      expect(source, file).not.toMatch(/console\.(log|error|warn|info|debug)/);
      expect(source, file).not.toMatch(/localStorage|sessionStorage/);
      expect(source, file).not.toMatch(/SUPABASE_SERVICE_ROLE|serviceClient|service_role_key/i);
      // Recovery is Auth-ownership only: no onboarding-token identifier may
      // appear in executable code (comments documenting the separation aside).
      expect(source, file).not.toMatch(/onboarding_?token|claim_customer/i);
    }
  });
});
