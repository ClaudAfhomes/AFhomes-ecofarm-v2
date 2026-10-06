/**
 * Portal entries: `/admin/login` (Super Admin + Admin) and `/staff/login`
 * (the six operational roles).
 *
 * Renders the REAL pages through the REAL router with the Supabase client
 * stubbed and the portals probe answered over stubbed fetch, so entry
 * gating, wrong-portal messaging, and post-login destinations are exercised.
 */
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'react-router';

import App from '../../app/App';
import { renderWithProviders } from '../../test/utils';

const supabaseMock = vi.hoisted(() => ({ impl: vi.fn() }));
vi.mock('../../lib/supabase', () => ({
  getSupabaseClient: (...args: unknown[]) =>
    (supabaseMock.impl as (...a: unknown[]) => unknown)(...args),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn(),
  clearSession: vi.fn(),
}));

const authMock = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

const portalsBody = vi.hoisted(() => ({ current: null as unknown }));

/** Mirrors Supabase: no session until sign-in succeeds. */
let signedIn = false;

const SESSION_BODY = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'fin@afhomes.test',
  fullName: 'Fin Staffer',
  status: 'active',
  roleId: '22222222-2222-4222-8222-222222222222',
  roleSlug: 'finance',
  roleName: 'Finance',
  mustChangePassword: false,
  permissions: [
    {
      moduleKey: 'dashboard.view',
      canView: true,
      canCreate: false,
      canUpdate: false,
      canDelete: false,
    },
    {
      moduleKey: 'operations.redemption',
      canView: true,
      canCreate: true,
      canUpdate: false,
      canDelete: false,
    },
  ],
  testPurgeEnabled: false,
};

function installFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('/auth/portals')
        ? portalsBody.current
        : url.includes('/admin/afhomes/session')
          ? SESSION_BODY
          : { data: [], meta: { total: 0 } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }),
  );
}

const staffPortals = (roleSlug: string, mustChangePassword = false) => ({
  staff: { roleSlug, roleName: roleSlug, status: 'active', mustChangePassword },
  customer: null,
  ost: null,
});
const customerOnly = { staff: null, customer: { status: 'active' }, ost: null };

function LocationProbe() {
  return <output data-testid="location">{useLocation().pathname}</output>;
}

async function expectLocation(pathname: string) {
  const probe = await screen.findByTestId('location');
  await waitFor(() => expect(probe).toHaveTextContent(pathname));
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  signedIn = false;
  supabaseMock.impl.mockReturnValue({
    auth: {
      signInWithPassword: authMock.signInWithPassword,
      getSession: authMock.getSession,
      onAuthStateChange: authMock.onAuthStateChange,
      signOut: authMock.signOut,
    },
  });
  authMock.signInWithPassword.mockImplementation(async () => {
    signedIn = true;
    return { error: null };
  });
  authMock.getSession.mockImplementation(async () =>
    signedIn
      ? {
          data: {
            session: { access_token: 'test-jwt', user: { id: 'u', email: 'u@x.test' } },
          },
        }
      : { data: { session: null } },
  );
  authMock.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
  authMock.signOut.mockResolvedValue({});
  portalsBody.current = null;
  installFetch();
});

async function signInAs(email = 'fin@afhomes.test', password = 'Password123!') {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email/i), email);
  await user.type(screen.getByLabelText(/^password$/i), password);
  await user.click(screen.getByRole('button', { name: /^sign in$/i }));
}

describe('portal entries render', () => {
  it('serves the Admin Login at /admin/login with no staff links', async () => {
    renderWithProviders(<App />, { route: '/admin/login' });
    expect(
      await screen.findByRole('heading', { name: 'Admin Login' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /staff login/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /customer login/i })).not.toBeInTheDocument();
  });

  it('serves the Staff Login at /staff/login with member and OST links', async () => {
    renderWithProviders(<App />, { route: '/staff/login' });
    expect(await screen.findByRole('heading', { name: 'Staff Login' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /customer login/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/customer/login'),
    );
    expect(screen.getByRole('link', { name: /ost login/i })).toHaveAttribute(
      'href',
      expect.stringContaining('/ost/login'),
    );
    expect(screen.queryByRole('link', { name: /administration/i })).not.toBeInTheDocument();
  });

  it('marks both entries noindex, nofollow', async () => {
    renderWithProviders(<App />, { route: '/staff/login' });
    await screen.findByRole('heading', { name: 'Staff Login' });
    expect(document.querySelector('meta[name="robots"]')).toHaveAttribute(
      'content',
      'noindex, nofollow',
    );
  });

  it('serves the staff recovery pair under /staff', async () => {
    renderWithProviders(<App />, { route: '/staff/forgot-password' });
    expect(
      await screen.findByRole('heading', { name: /reset your password/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute(
      'href',
      '/staff/login',
    );
  });
});

describe('staff entry decisions', () => {
  it('accepts finance and lands on the console', async () => {
    portalsBody.current = staffPortals('finance');
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/staff/login' },
    );
    await signInAs();
    await expectLocation('/admin');
  });

  it('lands employees on the redemption dashboard by default', async () => {
    portalsBody.current = staffPortals('employee');
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/staff/login' },
    );
    await signInAs('emp@afhomes.test');
    await expectLocation('/admin');
  });

  it('refuses an admin with the Administration message and link', async () => {
    portalsBody.current = staffPortals('admin');
    renderWithProviders(<App />, { route: '/staff/login' });
    await signInAs('admin@afhomes.test');
    expect(await screen.findByText(/uses the Administration portal/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to administration login/i })).toHaveAttribute(
      'href',
      '/admin/login',
    );
  });

  it('refuses a customer-only sign-in without a generic error', async () => {
    portalsBody.current = customerOnly;
    renderWithProviders(<App />, { route: '/staff/login' });
    await signInAs('member@afhomes.test');
    expect(await screen.findByText(/this is a customer account/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not sign you in/i)).not.toBeInTheDocument();
  });

  it('routes a temporary password to the change screen', async () => {
    portalsBody.current = staffPortals('sales_manager', true);
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/staff/login' },
    );
    await signInAs('sm@afhomes.test');
    await expectLocation('/admin/profile');
  });
});

describe('admin entry decisions', () => {
  it('accepts an admin', async () => {
    portalsBody.current = staffPortals('admin');
    renderWithProviders(
      <>
        <App />
        <LocationProbe />
      </>,
      { route: '/admin/login' },
    );
    await signInAs('admin@afhomes.test');
    await expectLocation('/admin');
  });

  it('refuses an employee with the Staff Portal message and link', async () => {
    portalsBody.current = staffPortals('employee');
    renderWithProviders(<App />, { route: '/admin/login' });
    await signInAs('emp@afhomes.test');
    expect(await screen.findByText(/uses the staff portal/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to staff login/i })).toHaveAttribute(
      'href',
      '/staff/login',
    );
  });
});
