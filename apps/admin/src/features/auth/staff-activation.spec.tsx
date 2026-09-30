import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../app/App';
import { renderWithProviders } from '../../test/utils';
import { AdminActivateAccountPage } from './AdminActivateAccountPage';

const supabaseMock = vi.hoisted(() => ({ impl: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: (...args: unknown[]) =>
    (supabaseMock.impl as (...values: unknown[]) => unknown)(...args),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn(),
  clearSession: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  getSession: vi.fn(),
  setSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  signInWithPassword: vi.fn(),
}));

const STAFF_ID = '11111111-1111-4111-8111-111111111111';
let accessToken: string | null;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

const installFetch = (activationStatus = 200) => {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/admin/afhomes/account-activation')) {
      return activationStatus === 200
        ? jsonResponse({ id: STAFF_ID, email: 'invitee@afhomes.test', fullName: 'Invited Staff' })
        : jsonResponse(
            { error: { code: 'FORBIDDEN', message: 'Invitation session required' } },
            activationStatus,
          );
    }
    if (url.endsWith('/admin/afhomes/session')) {
      return jsonResponse({
        id: STAFF_ID,
        email: 'invitee@afhomes.test',
        fullName: 'Invited Staff',
        status: 'active',
        roleId: '22222222-2222-4222-8222-222222222222',
        roleSlug: 'finance',
        roleName: 'Finance',
        mustChangePassword: false,
        permissions: [],
        testPurgeEnabled: false,
      });
    }
    return jsonResponse({ error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
};

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, '', '/admin/activate-account');
  accessToken = 'invite-token';
  authMock.getSession.mockImplementation(async () => ({
    data: {
      session: accessToken
        ? { access_token: accessToken, user: { id: STAFF_ID, email: 'invitee@afhomes.test' } }
        : null,
    },
  }));
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  authMock.setSession.mockResolvedValue({
    data: {
      session: { access_token: 'ACCESS', user: { id: STAFF_ID, email: 'invitee@afhomes.test' } },
    },
    error: null,
  });
  authMock.updateUser.mockResolvedValue({ error: null });
  authMock.signOut.mockImplementation(async () => {
    accessToken = null;
    return { error: null };
  });
  authMock.signInWithPassword.mockImplementation(async () => {
    accessToken = 'password-token';
    return { error: null };
  });
  supabaseMock.impl.mockReturnValue({ auth: authMock });
  installFetch();
});

const renderActivation = () =>
  renderWithProviders(<AdminActivateAccountPage />, { route: '/admin/activate-account' });

describe('staff account activation', () => {
  it('consumes the real invite fragment, removes its tokens, and shows the setup form', async () => {
    window.history.replaceState(
      null,
      '',
      '/admin/activate-account#access_token=ACCESS&refresh_token=REFRESH&type=invite',
    );
    const fetchMock = installFetch();
    renderActivation();

    expect(await screen.findByLabelText('New Password')).toBeInTheDocument();
    expect(authMock.setSession).toHaveBeenCalledWith({
      access_token: 'ACCESS',
      refresh_token: 'REFRESH',
    });
    expect(window.location.pathname).toBe('/admin/activate-account');
    expect(window.location.hash).toBe('');
    expect(window.location.href).not.toContain('ACCESS');
    expect(
      fetchMock.mock.calls.some(([input]) =>
        String(input).endsWith('/admin/afhomes/account-activation'),
      ),
    ).toBe(true);
    expect(
      screen.queryByText('Invitation link is invalid or has expired.'),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['missing refresh token', '#access_token=ACCESS&type=invite'],
    ['malformed callback type', '#access_token=ACCESS&refresh_token=REFRESH&type=recovery'],
    ['explicit callback error', '#error=access_denied&error_code=otp_expired'],
  ])('rejects a %s and removes callback data', async (_label, hash) => {
    window.history.replaceState(null, '', `/admin/activate-account${hash}`);
    renderActivation();
    expect(
      await screen.findByText('Invitation link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('');
    expect(authMock.setSession).not.toHaveBeenCalled();
  });

  it('rejects a callback when Supabase cannot establish its session', async () => {
    authMock.setSession.mockResolvedValue({
      data: { session: null },
      error: { message: 'invalid token' },
    });
    window.history.replaceState(
      null,
      '',
      '/admin/activate-account#access_token=BAD&refresh_token=BAD&type=invite',
    );
    renderActivation();
    expect(
      await screen.findByText('Invitation link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(window.location.hash).toBe('');
  });

  it('is a real route outside the normal admin guard and renders the password fields', async () => {
    renderWithProviders(<App />, { route: '/admin/activate-account' });
    expect(
      await screen.findByRole('heading', { name: 'Set Up Your Staff Account' }),
    ).toBeInTheDocument();
    expect(await screen.findByLabelText('New Password')).toBeInTheDocument();
    expect(screen.getByLabelText('Confirm Password')).toBeInTheDocument();
    expect(screen.getByDisplayValue('invitee@afhomes.test')).toHaveAttribute('readonly');
  });

  it('rejects weak and mismatched passwords before calling Supabase', async () => {
    const user = userEvent.setup();
    renderActivation();
    const password = await screen.findByLabelText('New Password');
    const confirm = screen.getByLabelText('Confirm Password');

    await user.type(password, 'short');
    await user.type(confirm, 'short');
    await user.click(screen.getByRole('button', { name: 'Create Password' }));
    expect(await screen.findByText('Password must be at least 10 characters.')).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();

    await user.clear(password);
    await user.clear(confirm);
    await user.type(password, 'ValidPass123');
    await user.type(confirm, 'Different123');
    await user.click(screen.getByRole('button', { name: 'Create Password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('creates the password in Supabase, proves password sign-in, activates, and signs out', async () => {
    const user = userEvent.setup();
    const fetchMock = installFetch();
    renderActivation();
    await user.type(await screen.findByLabelText('New Password'), 'ValidPass123');
    await user.type(screen.getByLabelText('Confirm Password'), 'ValidPass123');
    await user.click(screen.getByRole('button', { name: 'Create Password' }));

    expect(
      await screen.findByText('Your account has been activated. Sign in using your new password.'),
    ).toBeInTheDocument();
    expect(authMock.updateUser).toHaveBeenCalledWith({ password: 'ValidPass123' });
    expect(authMock.signInWithPassword).toHaveBeenCalledWith({
      email: 'invitee@afhomes.test',
      password: 'ValidPass123',
    });
    expect(authMock.signOut).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('link', { name: 'Return to Staff Login' })).toHaveAttribute(
      'href',
      '/admin/login',
    );

    // AF Homes handlers receive bearer tokens only. The chosen password is
    // sent to Supabase Auth and never appears in an application API request.
    for (const call of fetchMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('ValidPass123');
    }
  });

  it('fails safely for a missing, expired, reused, customer, or normal-staff session', async () => {
    accessToken = null;
    renderActivation();
    expect(
      await screen.findByText('Invitation link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('fails safely when the server rejects a session that is not an eligible staff invitation', async () => {
    installFetch(403);
    renderActivation();
    expect(
      await screen.findByText('Invitation link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('keeps password recovery separate and does not treat a recovery error as an invite', async () => {
    window.history.replaceState(
      null,
      '',
      '/admin/activate-account?error=access_denied&error_code=otp_expired',
    );
    renderActivation();
    window.history.replaceState(null, '', '/admin/activate-account');
    expect(
      await screen.findByText('Invitation link is invalid or has expired.'),
    ).toBeInTheDocument();
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('offers ordinary login if password creation succeeded but activation verification failed', async () => {
    const user = userEvent.setup();
    authMock.signInWithPassword.mockResolvedValue({ error: { message: 'temporary failure' } });
    renderActivation();
    await user.type(await screen.findByLabelText('New Password'), 'ValidPass123');
    await user.type(screen.getByLabelText('Confirm Password'), 'ValidPass123');
    await user.click(screen.getByRole('button', { name: 'Create Password' }));
    expect(await screen.findByText(/password was created/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Return to Staff Login' })).toBeInTheDocument();
    await waitFor(() => expect(authMock.signOut).toHaveBeenCalled());
  });
});
