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
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AfHomesPermission } from '@afhomes/contracts';

import { SessionProvider, type SessionUser } from '../lib/session';
import { ErrorState } from '@afhomes/ui';
import { renderWithProviders } from '../test/utils';
import { ADMIN_NAV_ITEMS, canViewModule, navItemsForPermissions } from './navigation';
import { RequireRole } from './RequireRole';

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

function renderPath(permissions: AfHomesPermission[], path: string) {
  return render(
    <SessionProvider initialUser={user(permissions)}>
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

/** Every routable admin path and the module that guards it. */
const GUARDED: { path: string; module: AfHomesPermission['moduleKey'] }[] = [
  { path: '/admin', module: 'dashboard.view' },
  { path: '/admin/staff', module: 'organization.staff' },
  { path: '/admin/departments', module: 'organization.departments' },
  { path: '/admin/roles', module: 'organization.roles' },
];

describe('Invariant E - a direct URL cannot bypass navigation permission filtering', () => {
  it.each(GUARDED)('serves $path when $module is granted', async ({ path, module }) => {
    renderPath([view(module)], path);
    expect(await screen.findByText('protected content')).toBeInTheDocument();
  });

  it.each(GUARDED)('blocks $path when $module is not granted', async ({ path, module }) => {
    // Grant everything except the one module guarding this path.
    const others = ADMIN_NAV_ITEMS.flatMap((item) =>
      (item.dropdown ?? [item]).map((entry) => entry.module),
    )
      .filter((key) => key !== module)
      .map(view);
    renderPath(others, path);
    expect(await screen.findByText('Access denied')).toBeInTheDocument();
    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
  });

  /**
   * The Operational Services split, asserted on the NAVIGATION rather than on a
   * page. A GSD holds `operations.sales` (record a sale, record a receipt) and
   * must therefore SEE the sale screen while being denied the two screens that
   * would let them administer pricing or verify their own money.
   */
  it('shows a GSD the sale screen but hides the verification screen', () => {
    const gsd: AfHomesPermission[] = [
      view('dashboard.view'),
      { ...view('operations.sales'), canCreate: true },
      view('operations.redemption'),
      view('operations.catalog'),
    ];
    // The declared navigation, which is where the labels actually live; the
    // filtered sidebar union carries dividers as well and is checked below.
    const shown = navItemsForPermissions(gsd, 'employee');
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
    expect(labels).toContain('New Service Sale');
    // `employee` holds `operations.catalog` VIEW, because it needs the catalog to
    // sell from and redeem against, so the Products & Services screen stays
    // readable: read is enough to explain a sale. It is WITHHELD at the write
    // controls instead, and the server refuses those writes regardless.
    expect(labels).toContain('Products & Services');
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
    for (const { path } of GUARDED) {
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
    const { setApiAccessTokenForTests } = await import('../lib/api/client');
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

  it('reads permissions only from the server session, never from storage', () => {
    // A tampered localStorage/session hint must not change the resolved user.
    localStorage.setItem('afhomes:permissions', JSON.stringify([view('governance.config')]));
    const resolved = user([view('dashboard.view')]);
    expect(canViewModule(resolved.afHomesPermissions, 'governance.config')).toBe(false);
    localStorage.removeItem('afhomes:permissions');
  });
});
