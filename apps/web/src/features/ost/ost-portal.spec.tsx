/**
 * OST portal: login routing, guard, dashboard, and recovery targets.
 *
 * Renders the REAL pages through the REAL router. Sign-in is stubbed at the
 * Supabase client and identity at stubbed fetch, so portal decisions -
 * approved in, pending explained, missing redirected - are exercised.
 */
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../../test/utils';
import App from '../../app/App';
import { CustomerLoginForm } from '../customer/CustomerLoginForm';
import { Navigate, Route, Routes } from 'react-router';
import { OstGuard } from '../../app/OstGuard';

vi.mock('../../lib/PortalRedirect', () => ({
  PortalRedirect: ({ to }: { to: string }) =>
    to.startsWith('/admin') ? <p>Opening password setup: {to}</p> : <Navigate to={to} replace />,
}));

const supabaseMock = vi.hoisted(() => ({ impl: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: (...args: unknown[]) =>
    (supabaseMock.impl as (...a: unknown[]) => unknown)(...args),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn(),
  clearSession: vi.fn(),
  resetSupabaseClientForTest: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
  updateUser: vi.fn(),
  resetPasswordForEmail: vi.fn(),
}));

/** Mirrors Supabase: no session until sign-in succeeds. */
let signedIn = false;

const portalsBody = vi.hoisted(() => ({ current: null as unknown }));
const routes = new Map<string, () => { status: number; body: unknown }>();

const ok = (body: unknown) => () => ({ status: 200, body });

const OST_PORTALS = {
  staff: null,
  customer: null,
  ost: { status: 'active', ostNumber: 'OST-000007' },
};
const OST_ME = {
  ostNumber: 'OST-000007',
  fullName: 'Ollie Seller',
  status: 'active',
  sponsorName: 'Sam Manager',
  approvedAt: '2026-09-01T00:00:00.000Z',
};

const OST_DASHBOARD = {
  head: {
    headId: '22222222-2222-4222-8222-222222222222',
    headName: 'Sam Manager',
    headRole: 'sales_manager',
    headStatus: 'active',
    relationship: 'Direct Sponsor',
  },
  sales: {
    totalSales: 0,
    periodSales: 0,
    qualifyingSaleStatus: 'active',
  },
  commissions: {
    toEarn: { count: 0, amount: '0.00' },
    earned: { count: 0, amount: '0.00' },
    paid: { count: 0, amount: '0.00' },
    cancelled: { count: 0, amount: '0.00' },
  },
  commissionHistory: [],
};

function installFetch() {
  routes.clear();
  // Read the current probe result lazily: tests reassign it per case.
  routes.set('/auth/portals', () => ok(portalsBody.current)());
  routes.set('/ost/me', ok(OST_ME));
  routes.set('/ost/me/dashboard', ok(OST_DASHBOARD));
  routes.set(
    '/profile-photo/staff',
    ok({ url: null, expiresAt: null, canUpload: true, notice: null }),
  );
  routes.set(
    '/sale-team/me',
    ok({
      aaNumber: 'AA-J6P3N8V5C2S0',
      kind: 'OST',
      fullName: 'Ollie Seller',
      status: 'accredited',
      startsOn: '2026-09-01',
      expiresOn: '2027-09-01',
    }),
  );
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const path = url
        .replace(/^https?:\/\/[^/]+/, '')
        .replace(/^\/api\/v1/, '')
        .split('?')[0]!;
      const handler = routes.get(path);
      if (!handler) {
        return new Response(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'x' } }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const { status, body } = handler();
      return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  signedIn = false;
  supabaseMock.impl.mockReturnValue({
    auth: {
      signInWithPassword: authMock.signInWithPassword,
      getSession: authMock.getSession,
      onAuthStateChange: authMock.onAuthStateChange,
      signOut: authMock.signOut,
      updateUser: authMock.updateUser,
      resetPasswordForEmail: authMock.resetPasswordForEmail,
    },
  });
  authMock.signInWithPassword.mockImplementation(async () => {
    signedIn = true;
    return { error: null };
  });
  authMock.getSession.mockImplementation(async () =>
    signedIn
      ? { data: { session: { access_token: 't', user: { id: 'u', email: 'u@x.test' } } } }
      : { data: { session: null } },
  );
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  authMock.resetPasswordForEmail.mockResolvedValue({ error: null });
  portalsBody.current = OST_PORTALS;
  installFetch();
});

const render = (route: string, sessionUser: { authUserId: string; email: string } | null = null) =>
  renderWithProviders(<App />, { route, sessionUser });

describe('OST login', () => {
  it('routes temporary-password OST login to the existing password setup', async () => {
    portalsBody.current = {
      ...OST_PORTALS,
      staff: { roleSlug: 'ost', roleName: 'OST', status: 'active', mustChangePassword: true },
    };
    const user = userEvent.setup();
    render('/ost/login');
    await user.type(screen.getByLabelText('Email'), 'ost@afhomes.test');
    await user.type(screen.getByLabelText('Password'), 'Temporary123!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(
      await screen.findByRole('heading', { name: 'Create your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ollie Seller')).not.toBeInTheDocument();
  });

  it('blocks a direct dashboard visit until password setup completes', async () => {
    portalsBody.current = {
      ...OST_PORTALS,
      staff: { roleSlug: 'ost', roleName: 'OST', status: 'active', mustChangePassword: true },
    };
    render('/ost/dashboard', { authUserId: 'u', email: 'ost@afhomes.test' });
    expect(
      await screen.findByRole('heading', { name: 'Create your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('Ollie Seller')).not.toBeInTheDocument();
  });

  it('explains temporary-password sign-in without a registration link', async () => {
    render('/ost/login');
    expect(await screen.findByRole('heading', { name: 'OST Login' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /register as ost/i })).not.toBeInTheDocument();
    expect(screen.getByText(/temporary password provided/i)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/administration/i);
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('requires a new password before entering with a temporary password', async () => {
    portalsBody.current = {
      ...OST_PORTALS,
      staff: { roleSlug: 'ost', roleName: 'OST', status: 'active', mustChangePassword: true },
    };
    const user = userEvent.setup();
    render('/ost/login');
    await user.type(screen.getByLabelText('Email'), 'ost@afhomes.test');
    await user.type(screen.getByLabelText('Password'), 'TempPass123');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(
      await screen.findByRole('heading', { name: 'Create your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('OST-000007')).not.toBeInTheDocument();
    await user.type(await screen.findByLabelText('Temporary password'), 'TempPass123');
    await user.type(screen.getByLabelText('New password'), 'OwnPassword123');
    await user.type(screen.getByLabelText('Confirm new password'), 'WrongPassword123');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();
    routes.set('/admin/afhomes/session/password', ok({ changed: true }));
    authMock.signOut.mockResolvedValue({ error: null });
    await user.clear(screen.getByLabelText('Confirm new password'));
    await user.type(screen.getByLabelText('Confirm new password'), 'OwnPassword123');
    await user.click(screen.getByRole('button', { name: 'Save password' }));
    expect(await screen.findByText(/Sign in with your new password/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/afhomes/session/password'),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ currentPassword: 'TempPass123', newPassword: 'OwnPassword123' }),
      }),
    );
    expect(authMock.updateUser).not.toHaveBeenCalled();
  });

  it('signs an approved OST in and lands on the dashboard', async () => {
    const user = userEvent.setup();
    render('/ost/login');
    await user.type(screen.getByLabelText('Email'), 'ost@afhomes.test');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect((await screen.findAllByText('OST-000007')).length).toBeGreaterThan(0);
    expect(await screen.findByText('AA-J6P3N8V5C2S0')).toBeInTheDocument();
    expect(screen.getByText('2027-09-01')).toBeInTheDocument();
    expect(await screen.findByText('Ollie Seller')).toBeInTheDocument();
  });

  it('lands on dashboard after login prompted by a protected feature route', async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Routes>
        <Route
          path="/"
          element={<Navigate to="/ost/login" state={{ from: '/ost/previous-feature' }} />}
        />
        <Route path="*" element={<App />} />
      </Routes>,
    );
    await user.type(await screen.findByLabelText('Email'), 'ost@afhomes.test');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect((await screen.findAllByText('OST-000007')).length).toBeGreaterThan(0);
    expect(await screen.findByText('Ollie Seller')).toBeInTheDocument();
  });

  it('explains a non-approved record instead of entering', async () => {
    portalsBody.current = {
      staff: null,
      customer: null,
      ost: { status: 'suspended', ostNumber: 'OST-000007' },
    };
    const user = userEvent.setup();
    render('/ost/login');
    await user.type(screen.getByLabelText('Email'), 'ost@afhomes.test');
    await user.type(screen.getByLabelText('Password'), 'Password123!');
    await user.click(screen.getByRole('button', { name: /^sign in$/i }));
    expect(await screen.findByText(/record is suspended/i)).toBeInTheDocument();
  });
});

describe('OST dashboard guard', () => {
  it('blocks direct dashboard access until the temporary password is changed', async () => {
    signedIn = true;
    portalsBody.current = {
      ...OST_PORTALS,
      staff: { roleSlug: 'ost', roleName: 'OST', status: 'active', mustChangePassword: true },
    };
    render('/ost/dashboard', { authUserId: 'u', email: 'ost@afhomes.test' });
    expect(
      await screen.findByRole('heading', { name: 'Create your own password' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('OST-000007')).not.toBeInTheDocument();
  });
  it('sends visitors without a session to OST login', async () => {
    render('/ost/dashboard');
    expect(await screen.findByRole('heading', { name: 'OST Login' })).toBeInTheDocument();
  });

  it('replaces a signed-in customer’s wrong OST entry with the customer dashboard', async () => {
    portalsBody.current = { staff: null, customer: { status: 'active' }, ost: null };
    renderWithProviders(
      <Routes>
        <Route
          path="/ost/dashboard"
          element={
            <OstGuard>
              <p>OST private content</p>
            </OstGuard>
          }
        />
        <Route path="/customer" element={<h1>Authorized customer dashboard</h1>} />
      </Routes>,
      {
        route: '/ost/dashboard',
        sessionUser: { authUserId: 'c', email: 'member@example.invalid' },
      },
    );
    expect(
      await screen.findByRole('heading', { name: 'Authorized customer dashboard' }),
    ).toBeInTheDocument();
    expect(screen.queryByText('OST private content')).not.toBeInTheDocument();
  });
});

describe('OST recovery targets', () => {
  it('preserves email recovery without requiring a temporary password', async () => {
    signedIn = true;
    authMock.updateUser.mockResolvedValue({ error: null });
    authMock.signOut.mockResolvedValue({ error: null });
    render('/ost/reset-password');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('New password'), 'RecoveredPass123');
    expect(screen.queryByLabelText('Temporary password')).not.toBeInTheDocument();
    await user.type(screen.getByLabelText('Confirm new password'), 'RecoveredPass123');
    await user.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText(/Sign in with your new password/)).toBeInTheDocument();
    expect(authMock.updateUser).toHaveBeenCalledWith({ password: 'RecoveredPass123' });
  });
  it('requests recovery for the OST reset page', async () => {
    const user = userEvent.setup();
    render('/ost/forgot-password');
    await user.type(screen.getByLabelText('Email'), 'ost@afhomes.test');
    await user.click(screen.getByRole('button', { name: /send reset link/i }));
    expect(authMock.resetPasswordForEmail).toHaveBeenCalledWith(
      'ost@afhomes.test',
      expect.objectContaining({ redirectTo: expect.stringContaining('/ost/reset-password') }),
    );
  });

  it('returns to OST login after recovery pages', async () => {
    render('/ost/forgot-password');
    expect(await screen.findByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/ost/login',
    );
  });
});

it('fresh customer login ignores the saved feature route and lands home', async () => {
  portalsBody.current = { staff: null, customer: { status: 'active' }, ost: null };
  const user = userEvent.setup();
  renderWithProviders(
    <Routes>
      <Route
        path="/"
        element={<Navigate to="/customer/login" state={{ from: '/customer/membership' }} />}
      />
      <Route path="/customer/login" element={<CustomerLoginForm />} />
      <Route path="/customer" element={<h1>QA Customer Dashboard</h1>} />
      <Route path="/customer/membership" element={<h1>QA Member Feature</h1>} />
    </Routes>,
  );
  await user.type(await screen.findByLabelText('Email'), 'member@afhomes.test');
  await user.type(screen.getByLabelText('Password'), 'Password123!');
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
  expect(await screen.findByRole('heading', { name: 'QA Customer Dashboard' })).toBeInTheDocument();
  expect(screen.queryByText('QA Member Feature')).not.toBeInTheDocument();
});
