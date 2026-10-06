/**
 * Phase 15 Reports and Audit Center admin surface.
 *
 * Pins the UX halves: the new routes are gated on the same module keys the
 * server enforces, the report selector only offers reports the session's
 * permissions allow, and export envelopes decode back to their bytes. The
 * backend remains authoritative - these tests only pin the UX layer.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { AfHomesPermission } from '@afhomes/contracts';

import { ADMIN_NAV_ITEMS, navItemsForPermissions } from '../../app/navigation';
import { RequireRole } from '../../app/RequireRole';
import { SessionProvider, type SessionUser } from '../../lib/session';
import { renderWithProviders } from '../../test/utils';
import { availableReports } from './reports';
import { exportToBlob } from './services';

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
  roleName: 'Tester',
  status: 'active',
  afHomesPermissions: permissions,
});

function renderPath(permissions: AfHomesPermission[], path: string) {
  return render(
    <SessionProvider initialUser={user(permissions)}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/reports"
            element={
              <RequireRole>
                <p>Reports screen</p>
              </RequireRole>
            }
          />
          <Route
            path="/admin/audit"
            element={
              <RequireRole>
                <p>Audit screen</p>
              </RequireRole>
            }
          />
          <Route path="*" element={<p>Not found</p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

describe('reports navigation', () => {
  it('exposes nav entries for the reports screen and the audit log', () => {
    const paths = ADMIN_NAV_ITEMS.flatMap((item) => [
      item.to,
      ...(item.dropdown?.map((child) => child.to) ?? []),
    ]);
    expect(paths).toContain('/admin/reports');
    expect(paths).toContain('/admin/audit');
  });

  it('denies /admin/reports to a bare dashboard role (no report grant)', () => {
    // Deliberate Phase 30 correction (was: "opens to every role with
    // dashboard.view"). Three independent controls agree a bare dashboard
    // role sees no reports, aligned intentionally since Phase 25
    // (`canViewReports`, commit cbc61ed):
    //   1. navItemsForPermissions filters the /admin/reports child by
    //      canViewReports, so the sidebar hides it;
    //   2. canAccessNavTarget answers /admin/reports with canViewReports, so
    //      RequireRole shows Access denied (asserted here);
    //   3. availableReports([] for bare dashboard) offers zero report types.
    // Opening the section anyway would show an empty selector while implying
    // access - the denial below is the secure, consistent behavior. Report
    // authorization itself is NOT weakened: the server re-checks every
    // report's module grant on each request.
    renderPath([view('dashboard.view')], '/admin/reports');
    expect(screen.queryByText('Reports screen')).toBeNull();
    expect(screen.getByText('Access denied')).toBeTruthy();
  });

  it('opens /admin/reports with dashboard.view plus a report grant', () => {
    renderPath([view('dashboard.view'), view('sales.card_sales')], '/admin/reports');
    expect(screen.getByText('Reports screen')).toBeTruthy();
  });

  it('blocks /admin/audit without governance.audit (Invariant E)', () => {
    renderPath([view('dashboard.view')], '/admin/audit');
    expect(screen.queryByText('Audit screen')).toBeNull();
    expect(screen.getByText('Access denied')).toBeTruthy();
  });

  it('allows /admin/audit with governance.audit', () => {
    renderPath([view('dashboard.view'), view('governance.audit')], '/admin/audit');
    expect(screen.getByText('Audit screen')).toBeTruthy();
  });

  it('hides the audit child from sellers and employees', () => {
    const nav = navItemsForPermissions([view('dashboard.view'), view('sales.card_sales')]);
    const reports = nav.find((item) => item.label === 'Reports');
    expect(reports?.dropdown?.map((item) => ('label' in item ? item.label : ''))).toEqual([
      'Reports',
    ]);
  });
});

describe('report selector scoping (UX only)', () => {
  it('offers finance only the financial reports', () => {
    const types = availableReports([
      view('dashboard.view'),
      view('finance.payment_verification'),
      view('finance.card_activation'),
      view('finance.points'),
      view('network.commissions'),
    ]).map((def) => def.type);
    expect(types).toEqual(
      expect.arrayContaining(['payments', 'memberships', 'commissions', 'points']),
    );
    expect(types).not.toContain('genealogy');
    expect(types).not.toContain('redemptions');
  });

  it('offers employees the redemption report plus card lookup', () => {
    // Memberships accepts the redemption view (same as authorizeCardStaff:
    // redemption, activation, and customer service may all look a card up).
    const types = availableReports([view('dashboard.view'), view('operations.redemption')]).map(
      (def) => def.type,
    );
    expect(types).toEqual(['memberships', 'redemptions']);
  });

  it('offers sellers no redemption or audit surface', () => {
    const types = availableReports([
      view('dashboard.view'),
      view('sales.card_sales'),
      view('sales.customers'),
      view('network.genealogy'),
    ]).map((def) => def.type);
    expect(types).not.toContain('redemptions');
    expect(types).toContain('sales');
    expect(types).toContain('genealogy');
  });

  it('offers nothing reportable to a bare dashboard role', () => {
    expect(availableReports([view('dashboard.view')])).toEqual([]);
  });
});

describe('export download', () => {
  it('decodes a base64 envelope back to its bytes and mime', async () => {
    const blob = exportToBlob({ mime: 'text/csv', content: btoa('a,b\r\n1,2\r\n') });
    expect(blob.type).toBe('text/csv');
    expect(await blob.text()).toBe('a,b\r\n1,2\r\n');
  });

  it('renders the reports screen shell through the shared provider', () => {
    renderWithProviders(<p>reports-shell</p>, { route: '/admin/reports' });
    expect(screen.getByText('reports-shell')).toBeTruthy();
  });
});
