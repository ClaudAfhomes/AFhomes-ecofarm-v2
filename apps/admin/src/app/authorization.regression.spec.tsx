/**
 * Frontend authorization regression suite (Invariants E and F).
 *
 * The backend suite (`api/_handlers/authorization.regression.spec.ts`) is
 * authoritative. These tests pin the two frontend-side halves:
 *
 *   E - a directly requested URL is filtered by the same module map that hides
 *       a nav link, so hiding a link is never the only thing standing between a
 *       user and a screen.
 *   F - client permission state is UX only: it can hide a control, but it can
 *       never make the API succeed, and a 403 is surfaced rather than swallowed.
 *
 * The Invariant E route inventory is DERIVED, not hand-written: it is read from
 * the route tree `App` actually declares (via `createRoutesFromChildren`), and
 * each route's guarding module is probed from `canAccessNavTarget`, the very
 * function `RequireRole` calls. A new route therefore joins this suite the
 * moment it is declared, and a route with no module guard fails it.
 */
import { render, screen } from '@testing-library/react';
import { Children, isValidElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  MemoryRouter,
  Navigate,
  Route,
  Routes,
  createRoutesFromChildren,
  type RouteObject,
} from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  afHomesModuleKeySchema,
  operationsPath,
  type AfHomesModuleKey,
  type AfHomesPermission,
} from '@afhomes/contracts';
import { isFeaturePathEnabled } from '@afhomes/shared';

// Only the Supabase client is replaced: the real SessionProvider, the real API
// client and the real RequireRole run in the session-resolution tests below.
const supabaseAuth = vi.hoisted(() => ({ getSession: vi.fn(), onAuthStateChange: vi.fn() }));
vi.mock('../lib/supabase', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/supabase')>()),
  getSupabaseClient: () => ({
    auth: {
      getSession: supabaseAuth.getSession,
      onAuthStateChange: supabaseAuth.onAuthStateChange,
      signOut: vi.fn(),
    },
  }),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn().mockResolvedValue(false),
  clearSession: vi.fn(),
}));

import { SessionProvider, useSession, type SessionUser } from '../lib/session';

beforeEach(() => {
  // Default: Supabase holds no session, exactly as an unconfigured client
  // behaves. Tests that resolve a real session override this.
  supabaseAuth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  supabaseAuth.onAuthStateChange.mockReturnValue({
    data: { subscription: { unsubscribe: vi.fn() } },
  });
});
import { setApiAccessTokenForTests } from '../lib/api/client';
import { ErrorState } from '@afhomes/ui';
import { renderWithProviders } from '../test/utils';
import App from './App';
import {
  ADMIN_NAV_ITEMS,
  EXTRA_GATED_ROUTES,
  canAccessNavTarget,
  canViewModule,
  navItemsForPermissions,
} from './navigation';
import { RequireRole } from './RequireRole';

const ALL_MODULES: readonly AfHomesModuleKey[] = afHomesModuleKeySchema.options;

const view = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

const user = (permissions: AfHomesPermission[]): SessionUser => ({
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Tester',
  email: 'tester@afhomes.test',
  roleId: '00000000-0000-4000-8000-000000000002',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: permissions,
});

function renderPath(permissions: AfHomesPermission[], path: string, sessionUser = user(permissions)) {
  return render(
    <SessionProvider initialUser={sessionUser}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path={path}
            element={
              <RequireRole>
                <div>protected content</div>
              </RequireRole>
            }
          />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

/** Render, read the outcome synchronously, unmount. The test session is resolved, so no wait. */
function outcome(permissions: AfHomesPermission[], path: string): 'served' | 'denied' | 'other' {
  const { unmount } = renderPath(permissions, path);
  const denied = screen.queryByText('Access denied') !== null;
  const served = screen.queryByText('protected content') !== null;
  unmount();
  if (denied && !served) return 'denied';
  if (served && !denied) return 'served';
  return 'other';
}

// ---------------------------------------------------------------------------
// Route inventory, derived from the router App actually declares.
// ---------------------------------------------------------------------------

type RouterEntry = { path: string; guarded: boolean; redirect: boolean };

function routesChildren(node: ReactNode): ReactNode | undefined {
  if (!isValidElement<{ children?: ReactNode }>(node)) return undefined;
  if (node.type === Routes) return node.props.children;
  for (const child of Children.toArray(node.props.children)) {
    const found = routesChildren(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function flattenRoutes(routes: RouteObject[]): RouterEntry[] {
  return routes.flatMap((route) => [
    ...(route.path
      ? [
          {
            path: route.path,
            guarded: isValidElement(route.element) && route.element.type === RequireRole,
            redirect: isValidElement(route.element) && route.element.type === Navigate,
          },
        ]
      : []),
    ...flattenRoutes(route.children ?? []),
  ]);
}

let inventoryCache: RouterEntry[] | undefined;
/**
 * Every `<Route>` App declares, including the role-portal clones `roleRoutes`
 * adds. `App()` is invoked as a plain function inside a probe's render so its
 * hooks run under the probe; nothing it returns is mounted.
 */
function routerInventory(): RouterEntry[] {
  if (inventoryCache) return inventoryCache;
  const sink: { routes?: RouteObject[] } = {};
  function Capture() {
    const children = routesChildren(App());
    if (children === undefined) throw new Error('App no longer renders a <Routes> tree');
    sink.routes = createRoutesFromChildren(children);
    return null;
  }
  const { unmount } = render(
    <SessionProvider initialUser={null}>
      <MemoryRouter initialEntries={['/admin/login']}>
        <Capture />
      </MemoryRouter>
    </SessionProvider>,
  );
  unmount();
  if (!sink.routes) throw new Error('route capture did not run');
  inventoryCache = flattenRoutes(sink.routes);
  return inventoryCache;
}

/** A concrete URL for a route pattern (`:id` -> a UUID). */
const concrete = (pattern: string) =>
  pattern.replace(/:[^/]+/g, '00000000-0000-4000-8000-0000000000aa');

/** Modules whose VIEW alone opens `pathname`, probed from the guard itself. */
const grantingModules = (pathname: string) =>
  ALL_MODULES.filter((key) => canAccessNavTarget([view(key)], pathname));

/** Entry screens a visitor must reach without a session. */
const PUBLIC_ENTRY = new Set([
  '/admin/login',
  '/staff/login',
  '/admin/activate-account',
  '/admin/forgot-password',
  '/admin/reset-password',
  '/staff/forgot-password',
  '/staff/reset-password',
  '*',
]);
/** Unguarded redirects; each must land on a route that is itself guarded. */
const UNGUARDED_REDIRECTS = new Set(['/admin/cms', '/admin/customers/applications/new']);
/** Gated by ROLE (admin/super_admin) inside RequireRole before any module check; pinned below. */
const ROLE_GATED = new Set(['/admin/mfa']);
/**
 * `findNavItem` lets the Dashboard entry (`/admin`) prefix-cover EVERY console
 * path, so a route nobody mapped silently falls back to `dashboard.view`, which
 * every staff role holds. Only these screens may rely on that fallback:
 * - `/admin/profile`: My Account; any staff session must reach it.
 * - `/admin/mfa`: role-gated above, the module result is never consulted.
 */
const DASHBOARD_FALLBACK_ALLOWED = new Set(['/admin/profile', '/admin/mfa']);
const covers = (target: string, path: string) => path === target || path.startsWith(`${target}/`);
/** Is `path` mapped by a nav link or extra gate of its own, not just the `/admin` catch-all? */
const explicitlyMapped = (path: string) =>
  path === '/admin' ||
  [
    ...ADMIN_NAV_ITEMS.flatMap((item) => [item.to, ...(item.dropdown ?? []).map((child) => child.to)]),
    ...EXTRA_GATED_ROUTES.map((entry) => entry.pathPrefix),
  ]
    .filter((target) => target !== '/admin')
    .some((target) => covers(target, path));

/**
 * Spot-checks of the exact module behind well-known screens. The derived
 * inventory proves every route HAS a guard; these prove a few have the RIGHT one.
 */
const PINNED: { path: string; module: AfHomesModuleKey }[] = [
  { path: '/admin', module: 'dashboard.view' },
  { path: '/admin/staff', module: 'organization.staff' },
  { path: '/admin/network/members', module: 'network.members' },
  { path: '/admin/departments', module: 'organization.departments' },
  { path: '/admin/roles', module: 'organization.roles' },
  // My Account rides the Dashboard fallback on purpose; pin that it stays there.
  { path: '/admin/profile', module: 'dashboard.view' },
  // OST screens left the sidebar but kept their routes; they are gated only
  // through EXTRA_GATED_ROUTES, on the keys their removed nav entries carried.
  { path: '/admin/ost/applications', module: 'network.ost_registrations' },
  { path: '/admin/ost/applications/new', module: 'network.ost_registrations' },
  { path: concrete('/admin/ost/members/:id'), module: 'network.ost_members' },
  { path: '/admin/ost/referral-code', module: 'network.referrals' },
];

describe('Invariant E - a direct URL cannot bypass navigation permission filtering', () => {
  it('derives a non-trivial route inventory from the router App declares', () => {
    const guarded = routerInventory().filter((entry) => entry.guarded);
    // Guards against a capture that silently finds nothing and passes vacuously.
    expect(guarded.length).toBeGreaterThan(50);
    const paths = new Set(guarded.map((entry) => entry.path));
    for (const known of ['/admin', '/admin/roles', '/admin/staff/:id', '/admin/ost/applications/:id'])
      expect(paths, known).toContain(known);
  });

  it('puts every routable admin screen behind RequireRole', () => {
    const unguarded = routerInventory().filter((entry) => !entry.guarded);
    const unexplained = unguarded
      .filter(
        (entry) =>
          !PUBLIC_ENTRY.has(entry.path) &&
          !(entry.redirect && UNGUARDED_REDIRECTS.has(operationsPath(entry.path))),
      )
      .map((entry) => entry.path);
    expect(unexplained).toEqual([]);
  });

  it('gives every guarded route a module guard: denied to a session with no permissions', () => {
    // Every route, including every role-portal clone (`/employee/...` etc.).
    const leaks = routerInventory()
      .filter((entry) => entry.guarded)
      .map((entry) => concrete(entry.path))
      .filter((path) => outcome([], path) !== 'denied');
    expect(leaks).toEqual([]);
  });

  it('maps every guarded route to a module of its own, never only the Dashboard catch-all', () => {
    const unmapped = [
      ...new Set(
        routerInventory()
          .filter((entry) => entry.guarded)
          .map((entry) => operationsPath(concrete(entry.path)))
          .filter((path) => !DASHBOARD_FALLBACK_ALLOWED.has(path) && !explicitlyMapped(path)),
      ),
    ];
    expect(unmapped).toEqual([]);
  });

  it('serves each guarded route on its own module and denies it on every other module', () => {
    const logical = [
      ...new Set(
        routerInventory()
          .filter((entry) => entry.guarded && entry.path.startsWith('/admin'))
          .map((entry) => concrete(entry.path))
          .filter((path) => !ROLE_GATED.has(path)),
      ),
    ];
    expect(logical.length).toBeGreaterThan(40);
    const failures: string[] = [];
    for (const path of logical) {
      const granting = grantingModules(path);
      if (granting.length === 0) {
        // Only a feature-flagged-off screen may open for no module, and then it
        // must stay shut even for a session holding everything.
        if (isFeaturePathEnabled(path)) failures.push(`${path}: no module grants it`);
        else if (outcome(ALL_MODULES.map(view), path) !== 'denied')
          failures.push(`${path}: feature-disabled but served`);
        continue;
      }
      if (granting.length === ALL_MODULES.length) {
        failures.push(`${path}: not module-gated (any single module opens it)`);
        continue;
      }
      for (const key of granting)
        if (outcome([view(key)], path) !== 'served') failures.push(`${path}: not served on ${key}`);
      const others = ALL_MODULES.filter((key) => !granting.includes(key)).map(view);
      if (outcome(others, path) !== 'denied')
        failures.push(`${path}: served without ${granting.join('|')}`);
    }
    expect(failures).toEqual([]);
  });

  it('declares every nav link and every extra gate on a guarded router route', () => {
    const guardedPaths = routerInventory()
      .filter((entry) => entry.guarded)
      .map((entry) => entry.path);
    const leaves = ADMIN_NAV_ITEMS.flatMap((item) => (item.dropdown?.length ? item.dropdown : [item]));
    expect(leaves.map((leaf) => leaf.to).filter((to) => !guardedPaths.includes(to))).toEqual([]);
    const deadGates = EXTRA_GATED_ROUTES.filter(
      ({ pathPrefix }) =>
        !guardedPaths.some((path) => path === pathPrefix || path.startsWith(`${pathPrefix}/`)),
    ).map(({ pathPrefix }) => pathPrefix);
    expect(deadGates).toEqual([]);
  });

  it('agrees between nav visibility and direct-route access for every link and module', () => {
    const leaves = ADMIN_NAV_ITEMS.flatMap((item) =>
      (item.dropdown?.length ? item.dropdown : [item]).map((leaf) => ({ parent: item.to, to: leaf.to })),
    );
    const visible = (permissions: AfHomesPermission[], parent: string, to: string) =>
      navItemsForPermissions(permissions).some((item) =>
        item.to === parent &&
        (item.dropdown === undefined
          ? item.to === to
          : item.dropdown.some((child) => 'to' in child && child.to === to)),
      );
    const disagreements: string[] = [];
    for (const permissions of [[], ...ALL_MODULES.map((key) => [view(key)])]) {
      for (const { parent, to } of leaves) {
        const shown = visible(permissions, parent, to);
        const reachable = canAccessNavTarget(permissions, to);
        if (shown !== reachable)
          disagreements.push(`${to} [${permissions[0]?.moduleKey ?? 'none'}]: nav=${shown} route=${reachable}`);
      }
    }
    expect(disagreements).toEqual([]);
  });

  it.each(PINNED)('gates $path on exactly $module', ({ path, module }) => {
    expect(grantingModules(path)).toEqual([module]);
  });

  it.each(PINNED)('serves $path when $module is granted', async ({ path, module }) => {
    renderPath([view(module)], path);
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it.each(PINNED)('blocks $path when $module is not granted', async ({ path, module }) => {
    // Grant every catalog module except the one guarding this path.
    renderPath(ALL_MODULES.filter((key) => key !== module).map(view), path);
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('gates /admin/mfa on role, not on any module permission', async () => {
    const everything = ALL_MODULES.map(view);
    const { unmount } = renderPath(everything, '/admin/mfa', { ...user(everything), roleSlug: 'finance' });
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    unmount();
    renderPath([], '/admin/mfa', { ...user([]), roleSlug: 'admin' });
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  /**
   * The Operational Services split, asserted on the NAVIGATION rather than on a
   * page. A GSD holds `operations.sales` (record a sale, record a receipt) and
   * must therefore SEE the sale screen while being denied the two screens that
   * would let them administer pricing or verify their own money.
   */
  it('hides disabled Services even when the GSD has effective permissions', () => {
    const gsd: AfHomesPermission[] = [
      view('dashboard.view'),
      { ...view('operations.sales'), canCreate: true },
      view('operations.redemption'),
      view('operations.catalog'),
    ];
    // The declared navigation, which is where the labels actually live; the
    // filtered sidebar union carries dividers as well and is checked below.
    const shown = navItemsForPermissions(gsd);
    const declared = ADMIN_NAV_ITEMS.filter((item) =>
      shown.some((s) => s.to === item.to),
    ).flatMap((item) => [
      item.label,
      // Children are filtered by the SAME permission the sidebar uses, so this
      // reports what a GSD actually sees rather than what is merely declared.
      ...(item.dropdown ?? [])
        .filter((child) => canViewModule(gsd, child.module))
        .map((child) => child.label),
    ]);
    const labels = declared.join(' | ');

    // Selling is the GSD's job.
    expect(labels).not.toContain('New Sale');
    // `employee` holds `operations.catalog` VIEW, because it needs the catalog to
    // sell from and redeem against, so the Products & Services screen stays
    // readable: read is enough to explain a sale. It is WITHHELD at the write
    // controls instead, and the server refuses those writes regardless.
    expect(labels).not.toContain('Catalog');
    // Verification is never the seller's, on its own key the GSD does not hold.
    expect(labels).not.toContain('Sales Records & Verification');
  });

  it('denies a GSD the verification route directly, not only in the nav', async () => {
    renderPath(
      [view('dashboard.view'), { ...view('operations.sales'), canCreate: true }, view('operations.redemption')],
      '/admin/points/payments',
    );
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  it('agrees between the nav link and the direct route for the same module', async () => {
    const withRoles: AfHomesPermission[] = [view('dashboard.view'), view('organization.staff')];
    // The link is hidden...
    const organization = navItemsForPermissions(withRoles).find(
      (item) => item.label === 'Organization',
    );
    const childPaths = (organization?.dropdown ?? [])
      .map((child) => ('to' in child ? child.to : null))
      .filter((to): to is string => typeof to === 'string');
    expect(childPaths).toEqual(['/admin/staff']);
    // ...and the route is denied, from the same permission list.
    renderPath(withRoles, '/admin/roles');
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
  });

  it('hides and denies everything for a principal with no permissions (deny by default)', async () => {
    expect(navItemsForPermissions([])).toEqual([]);
    expect(navItemsForPermissions(undefined)).toEqual([]);
    for (const { path } of PINNED) {
      const { unmount } = renderPath([], path);
      expect(await screen.findByText('Access denied')).toBeInTheDocument();
      unmount();
    }
  });

  it('treats a missing permission entry as denied', () => {
    expect(canViewModule(undefined, 'dashboard.view')).toBe(false);
    expect(canViewModule([], 'dashboard.view')).toBe(false);
  });

  it('sends an unauthenticated visitor away instead of rendering content', () => {
    render(
      <SessionProvider initialUser={null}>
        <MemoryRouter initialEntries={['/admin/roles']}>
          <Routes>
            <Route
              path="/admin/roles"
              element={
                <RequireRole>
                  <div>protected content</div>
                </RequireRole>
              }
            />
          </Routes>
        </MemoryRouter>
      </SessionProvider>,
    );
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });
});

describe('Invariant F - client permission state cannot authorize a server action', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'FORBIDDEN', message: 'Insufficient permission', timestamp: 'now' },
          }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('surfaces a 403 as an error state instead of rendering data', async () => {
    // The component "believes" it holds dashboard.view; the server disagrees.
    function Panel() {
      const query = useQuery({
        queryKey: ['afhomes', 'dashboard'],
        queryFn: async () => {
          const response = await fetch('/api/v1/admin/afhomes/dashboard');
          if (!response.ok) throw new Error(`denied ${response.status}`);
          return response.json();
        },
      });
      if (query.isError) return <ErrorState onRetry={() => void query.refetch()} />;
      return <div>dashboard data</div>;
    }

    renderWithProviders(
      <SessionProvider initialUser={user([view('dashboard.view')])}>
        <Panel />
      </SessionProvider>,
    );

    expect(await screen.findByText(/error|try again|failed/i)).toBeInTheDocument();
    expect(screen.queryByText('dashboard data')).not.toBeInTheDocument();
  });

  it('never substitutes cached or mock data for a denied response', async () => {
    setApiAccessTokenForTests('test-access-token');
    let calls = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        calls += 1;
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'FORBIDDEN', message: 'Insufficient permission', timestamp: 'now' },
            }),
            { status: 403, headers: { 'content-type': 'application/json' } },
          ),
        );
      }),
    );

    const { getAfHomesRoles } = await import('../features/afhomes/services');
    await expect(getAfHomesRoles()).rejects.toMatchObject({ status: 403 });
    expect(calls).toBe(1);
  });

  describe('the real SessionProvider resolves permissions from the server only', () => {
    const SERVER_PRINCIPAL = {
      id: '00000000-0000-4000-8000-0000000000e1',
      email: 'gsd@afhomes.test',
      fullName: 'LOW PRIVILEGE',
      status: 'active',
      roleId: '00000000-0000-4000-8000-0000000000e2',
      roleSlug: 'employee',
      roleName: 'Employee',
      mustChangePassword: false,
      permissions: [view('dashboard.view')],
      testPurgeEnabled: false,
      mfaRequired: false,
    };
    const FORGED_PERMISSIONS = ALL_MODULES.map((moduleKey) => ({
      moduleKey,
      canView: true,
      canCreate: true,
      canUpdate: true,
      canDelete: true,
    }));
    const FORGED_PRINCIPAL = {
      ...SERVER_PRINCIPAL,
      roleSlug: 'super_admin',
      roleName: 'Super Admin',
      permissions: FORGED_PERMISSIONS,
      afHomesPermissions: FORGED_PERMISSIONS,
    };
    // Plausible keys an attacker (or a future regression) would use, plus the
    // one storage key the console really reads, forged to the other portal.
    const FORGED_KEYS = [
      'afhomes:permissions',
      'afhomes:session',
      'afhomes:user',
      'afh-session',
      'afHomesPermissions',
      'permissions',
      'session',
      'user',
      'role',
    ];
    /** The only storage key the console reads: the login entry hint (src/lib/portal.ts). */
    const STORAGE_READS_ALLOWED = ['afh-entry-portal'];
    const SESSION_PATH = /\/admin\/afhomes\/session$/;

    const forgeStorage = () => {
      for (const store of [localStorage, sessionStorage])
        for (const key of FORGED_KEYS)
          store.setItem(key, JSON.stringify(key.includes('ermission') ? FORGED_PERMISSIONS : FORGED_PRINCIPAL));
      localStorage.setItem('afh-entry-portal', 'admin');
    };

    function NavProbe() {
      const { user: sessionUser } = useSession();
      return (
        <p data-testid="nav">
          {navItemsForPermissions(sessionUser?.afHomesPermissions)
            .map((item) => item.label)
            .join('|')}
        </p>
      );
    }

    const renderGuarded = (path: string) =>
      render(
        <SessionProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route
                path={path}
                element={
                  <RequireRole>
                    <div>protected content</div>
                  </RequireRole>
                }
              />
              <Route path="/admin/login" element={<p>login screen</p>} />
              <Route path="/staff/login" element={<p>login screen</p>} />
            </Routes>
            <NavProbe />
          </MemoryRouter>
        </SessionProvider>,
      );

    beforeEach(() => {
      // The real client must fetch with the Supabase session token, not a test override.
      setApiAccessTokenForTests(undefined);
      supabaseAuth.getSession.mockResolvedValue({
        data: { session: { access_token: 'server-token', user: { id: SERVER_PRINCIPAL.id } } },
        error: null,
      });
      supabaseAuth.onAuthStateChange.mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      });
      forgeStorage();
    });
    afterEach(() => {
      localStorage.clear();
      sessionStorage.clear();
    });

    it('keeps a protected route denied when storage claims Super Admin but the server says GSD', async () => {
      const fetchMock = vi.fn(async (input: RequestInfo | URL) =>
        SESSION_PATH.test(String(input))
          ? new Response(JSON.stringify(SERVER_PRINCIPAL), {
              status: 200,
              headers: { 'content-type': 'application/json' },
            })
          : new Response('{}', { status: 403 }),
      );
      vi.stubGlobal('fetch', fetchMock);
      const getItem = vi.spyOn(Storage.prototype, 'getItem');
      try {
        renderGuarded('/admin/roles');

        // `Access denied` renders only once the session is AUTHENTICATED, so this
        // also proves the server principal resolved rather than staying loading.
        expect(await screen.findByText('Access denied')).toBeInTheDocument();
        expect(screen.queryByText('protected content')).not.toBeInTheDocument();
        // A permission consumer shows exactly what the server granted.
        expect(screen.getByTestId('nav')).toHaveTextContent(/^Dashboard$/);
        // The decision came from the server round-trip, on the server token.
        expect(fetchMock).toHaveBeenCalledWith(
          expect.stringMatching(SESSION_PATH),
          expect.objectContaining({
            headers: expect.objectContaining({ Authorization: 'Bearer server-token' }),
          }),
        );
        // Nothing permission-, role- or session-shaped was read from storage.
        const keysRead = getItem.mock.calls.map(([key]) => key);
        expect(keysRead.filter((key) => !STORAGE_READS_ALLOWED.includes(key))).toEqual([]);
      } finally {
        getItem.mockRestore();
      }
    });

    it('renders nothing protected when the server refuses the session, whatever storage says', async () => {
      // e.g. inactive or suspended staff: the session endpoint answers 403.
      const fetchMock = vi.fn(async () =>
        new Response(
          JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Account inactive', timestamp: 'now' } }),
          { status: 403, headers: { 'content-type': 'application/json' } },
        ),
      );
      vi.stubGlobal('fetch', fetchMock);
      renderGuarded('/admin');

      expect(await screen.findByText('login screen')).toBeInTheDocument();
      expect(screen.queryByText('protected content')).not.toBeInTheDocument();
      expect(screen.getByTestId('nav')).toHaveTextContent(/^$/);
      expect(fetchMock).toHaveBeenCalledWith(expect.stringMatching(SESSION_PATH), expect.anything());
    });

    it('shows the loading state, not content, while the server session is unresolved', async () => {
      supabaseAuth.getSession.mockImplementation(() => new Promise(() => {}));
      renderGuarded('/admin');

      expect(await screen.findByRole('status', { name: 'Loading' })).toBeInTheDocument();
      expect(screen.queryByText('protected content')).not.toBeInTheDocument();
      expect(screen.queryByText('login screen')).not.toBeInTheDocument();
    });
  });
});
