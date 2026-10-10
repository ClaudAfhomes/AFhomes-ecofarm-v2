import { describe, expect, it } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';
import { breadcrumbItems, canAccessNavTarget, navItemsForPermissions } from './navigation';

const permission = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

describe('AF Homes navigation', () => {
  it('places Customer Lookup after Dashboard for employee without weakening route guards', () => {
    const grants = [
      permission('dashboard.view'),
      permission('operations.redemption'),
      permission('sales.id_documents'),
    ];
    const items = navItemsForPermissions(grants, 'employee');
    expect(items.slice(0, 2).map((item) => item.label)).toEqual(['Dashboard', 'Customer Lookup']);
    expect(items.map((item) => item.label)).not.toContain('Membership Lookup');
    expect(JSON.stringify(items)).not.toContain('/admin/documents');
    expect(canAccessNavTarget([], '/admin/documents')).toBe(false);
    expect(canAccessNavTarget([], '/admin/documents/test')).toBe(false);
    expect(canAccessNavTarget(grants, '/admin/documents/test')).toBe(true);
  });

  it('keeps the member-TRANSACTION lookup out of the global nav', () => {
    // The member lookup shows Membership Codes, so it must not be presented as a
    // system-wide general lookup. It belongs under Redemption, next to the action
    // that follows it.
    const items = navItemsForPermissions(
      [permission('dashboard.view'), permission('operations.redemption')],
      'employee',
    );
    const topLevel = items.filter((item) => !item.dropdown).map((item) => item.to);
    expect(topLevel).not.toContain('/admin/member-lookup');
    expect(topLevel).toContain('/admin/customer-lookup');
    const redemption = items.find((item) => item.to === '/admin/redemption');
    // A dropdown child may be a divider rather than a link, so narrow before
    // reading `to` instead of asserting on the union type.
    const redemptionTargets = (redemption?.dropdown ?? []).flatMap((child) =>
      'to' in child ? [child.to] : [],
    );
    expect(redemptionTargets).not.toContain('/admin/member-lookup');
  });

  it('reserves Customer Lookup to the operations.redemption grant', () => {
    // The employee/GSD role holds `operations.redemption` and no `sales.customers`
    // row, so this is the check that keeps the GSD desk reachable without widening
    // anyone's permissions.
    const employee = [permission('dashboard.view'), permission('operations.redemption')];
    expect(canAccessNavTarget(employee, '/admin/customer-lookup')).toBe(true);
    // A dropdown child may be a divider rather than a link, so narrow before reading
    // `to` instead of asserting on the union.
    const targets = navItemsForPermissions(employee, 'employee').flatMap((item) =>
      item.dropdown
        ? item.dropdown.flatMap((child) => ('to' in child ? [child.to] : []))
        : [item.to],
    );
    expect(targets.filter((to) => to?.includes('customer-lookup'))).toEqual([
      '/admin/customer-lookup',
    ]);
  });
  it.each([
    'super_admin',
    'admin',
    'finance',
    'hr',
    'vice_director',
    'senior_sales_manager',
    'sales_manager',
    'ost',
    'customer',
    undefined,
  ])('hides the standalone lookup for %s even with a view grant', (role) => {
    const grants = [permission('operations.redemption')];
    expect(
      navItemsForPermissions(grants, role).some((item) => item.to === '/admin/customer-lookup'),
    ).toBe(false);
    // Sidebar visibility must not revoke existing support-route authorization.
    expect(canAccessNavTarget(grants, '/admin/customer-lookup')).toBe(true);
  });
  it('does not grant employee lookup without its effective permission', () => {
    expect(navItemsForPermissions([], 'employee')).toEqual([]);
    expect(canAccessNavTarget([], '/admin/customer-lookup')).toBe(false);
    expect(canAccessNavTarget([permission('dashboard.view')], '/admin/customer-lookup')).toBe(
      false,
    );
  });
  it('shows only server-granted groups and links', () => {
    const items = navItemsForPermissions([
      permission('dashboard.view'),
      permission('organization.staff'),
    ]);
    // Phase 25 removes the dead Reports destination when none of its real
    // report modules are visible.
    expect(items.map((item) => item.label)).toEqual(['Dashboard', 'Organization']);
    expect(items[1]?.dropdown?.map((item) => ('label' in item ? item.label : ''))).toEqual([
      'Staff',
    ]);
  });
  it('reveals the Audit Log only with the governance grant', () => {
    const items = navItemsForPermissions([
      permission('dashboard.view'),
      permission('governance.audit'),
    ]);
    expect(items.map((item) => item.label)).toEqual(['Dashboard', 'Reports']);
    expect(items[1]?.dropdown?.map((item) => ('label' in item ? item.label : ''))).toEqual([
      'Audit Log',
    ]);
  });
  it('hides every destination when the server grants nothing', () =>
    expect(navItemsForPermissions([])).toEqual([]));
  it('builds organization breadcrumbs', () =>
    expect(breadcrumbItems('/admin/roles')).toEqual([
      { label: 'Dashboard', to: '/admin' },
      { label: 'Organization' },
      { label: 'Roles & Permissions' },
    ]));
});
