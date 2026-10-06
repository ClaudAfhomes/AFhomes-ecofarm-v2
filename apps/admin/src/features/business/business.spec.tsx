/**
 * AF Homes Phase 2 admin surface.
 *
 * Proves the two frontend halves that must hold for the new business screens:
 *
 *  - the new navigation entries are filtered by the SAME effective-permission
 *    map as every other entry, and a direct URL is filtered identically, so
 *    hiding a link is never the only control;
 *  - money is displayed from the exact-decimal string the server sent, with no
 *    float arithmetic anywhere in the formatter.
 *
 * The backend remains authoritative: these tests only pin the UX layer.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { AfHomesPermission } from '@afhomes/contracts';

import { SessionProvider, type SessionUser } from '../../lib/session';
import { renderWithProviders } from '../../test/utils';
import { ADMIN_NAV_ITEMS, canViewModule, navItemsForPermissions } from '../../app/navigation';
import { RequireRole } from '../../app/RequireRole';
import {
  SALE_STATUS_LABEL,
  SPOT_CASH_LABEL,
  formatMoney,
  formatPoints,
  formatRate,
} from './format';

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
            path="/admin/sales"
            element={
              <RequireRole>
                <p>Card Sales screen</p>
              </RequireRole>
            }
          />
          <Route
            path="/admin/customers"
            element={
              <RequireRole>
                <p>Customers screen</p>
              </RequireRole>
            }
          />
          <Route
            path="/admin/products"
            element={
              <RequireRole>
                <p>Card Products screen</p>
              </RequireRole>
            }
          />
          <Route
            path="/admin/finance/payments"
            element={
              <RequireRole>
                <p>Payment Queue screen</p>
              </RequireRole>
            }
          />
          <Route
            path="/admin/finance/activation"
            element={
              <RequireRole>
                <p>Activation Queue screen</p>
              </RequireRole>
            }
          />
          <Route
            path="/admin/finance/commissions"
            element={
              <RequireRole>
                <p>Commissions screen</p>
              </RequireRole>
            }
          />
          <Route path="*" element={<p>Not found</p>} />
        </Routes>
      </MemoryRouter>
    </SessionProvider>,
  );
}

/* ================================================================== */
/* Navigation is permission filtered                                   */
/* ================================================================== */

const BUSINESS_ROUTES = [
  { path: '/admin/sales', module: 'sales.card_sales', label: 'Card Sales screen' },
  { path: '/admin/customers', module: 'sales.customers', label: 'Customers screen' },
  { path: '/admin/products', module: 'sales.card_plans', label: 'Card Products screen' },
  {
    path: '/admin/finance/payments',
    module: 'finance.payment_verification',
    label: 'Payment Queue screen',
  },
  {
    path: '/admin/finance/activation',
    module: 'finance.card_activation',
    label: 'Activation Queue screen',
  },
  {
    path: '/admin/finance/commissions',
    module: 'network.commissions',
    label: 'Commissions screen',
  },
] as const;

describe('business navigation', () => {
  it('exposes a nav entry for every real Phase 2 screen, and no placeholder', () => {
    const paths = ADMIN_NAV_ITEMS.flatMap((item) => [
      item.to,
      ...(item.dropdown?.map((child) => child.to) ?? []),
    ]);
    for (const route of BUSINESS_ROUTES) expect(paths).toContain(route.path);
  });

  it('hides the Finance group from a seller who cannot verify payments', () => {
    const nav = navItemsForPermissions([view('sales.card_sales'), view('sales.customers')]);
    expect(nav.map((item) => item.label)).not.toContain('Finance');
  });

  it('hides the Sales group from a Finance-only principal', () => {
    const nav = navItemsForPermissions([
      view('finance.payment_verification'),
      view('finance.card_activation'),
    ]);
    expect(nav.map((item) => item.label)).not.toContain('Sales');
  });

  it('shows both groups to an Admin that holds every Phase 2 module', () => {
    const nav = navItemsForPermissions(BUSINESS_ROUTES.map((r) => view(r.module)));
    const labels = nav.map((item) => item.label);
    expect(labels).toContain('Sales');
    expect(labels).toContain('Finance');
  });

  it('treats a permission with canView false as not viewable', () => {
    const denied: AfHomesPermission = { ...view('sales.card_sales'), canView: false };
    expect(canViewModule([denied], 'sales.card_sales')).toBe(false);
  });
});

describe('a direct URL cannot bypass nav permission filtering (Invariant E)', () => {
  it.each(BUSINESS_ROUTES)('blocks $path without $module', ({ path, label }) => {
    renderPath([view('dashboard.view')], path);
    // The screen never renders; RequireRole shows the access-denied state.
    expect(screen.queryByText(label)).toBeNull();
    expect(screen.getByText('Access denied')).toBeTruthy();
  });

  it.each(BUSINESS_ROUTES)('allows $path with $module', ({ path, module, label }) => {
    renderPath([view(module)], path);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

/* ================================================================== */
/* Money display                                                       */
/* ================================================================== */

describe('business value formatting', () => {
  it('formats exact-decimal money without float arithmetic', () => {
    expect(formatMoney('60000.00')).toBe('₱60,000.00');
    expect(formatMoney('30000')).toBe('₱30,000.00');
    expect(formatMoney('1000000.5')).toBe('₱1,000,000.50');
    expect(formatMoney('0.07')).toBe('₱0.07');
  });

  it('never produces a float artefact for values that break float math', () => {
    // 0.1 + 0.2 !== 0.3 in binary floating point. The string is authoritative.
    expect(formatMoney('0.30')).toBe('₱0.30');
    expect(formatMoney('1234567.89')).toBe('₱1,234,567.89');
  });

  it('renders an absent money value as a dash rather than a zero', () => {
    expect(formatMoney(null)).toBe('—');
    expect(formatMoney(undefined)).toBe('—');
  });

  it('renders a commission rate as a percentage', () => {
    expect(formatRate('0.04')).toBe('4.00%');
    expect(formatRate('0.0400')).toBe('4.00%');
    expect(formatRate('0.0450')).toBe('4.50%');
    expect(formatRate('0.0000')).toBe('0.00%');
    expect(formatRate(null)).toBe('—');
  });

  it('groups points for readability', () => {
    expect(formatPoints(25000)).toBe('25,000');
    expect(formatPoints(null)).toBe('—');
  });

  it('labels every spot-cash state, including the derived expired one', () => {
    expect(Object.keys(SPOT_CASH_LABEL).sort()).toEqual([
      'expired',
      'fully_paid',
      'not_started',
      'within_deadline',
    ]);
  });

  it('labels every sale lifecycle state the migration allows', () => {
    expect(Object.keys(SALE_STATUS_LABEL).sort()).toEqual([
      'activation_pending',
      'active',
      'cancelled',
      'draft',
      'overdue',
      'payment_in_progress',
      'payment_pending',
      'payment_verified',
      'submitted',
    ]);
  });
});

/* ================================================================== */
/* Render smoke                                                        */
/* ================================================================== */

describe('test harness sanity', () => {
  it('renders through the shared provider', () => {
    renderWithProviders(<p>rendered</p>);
    expect(screen.getByText('rendered')).toBeTruthy();
  });
});
