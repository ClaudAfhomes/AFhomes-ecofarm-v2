import { expect, it } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';
import { canAccessNavTarget, navItemsForPermissions } from './navigation';
import { availableReports } from '../features/reports/reports';

it('hides disabled modules and denies direct URLs even with full effective grants', () => {
  const permissions = [
    'dashboard.view',
    'operations.redemption',
    'operations.sales',
    'operations.catalog',
    'operations.payments',
    'sales.customers',
    'sales.card_sales',
    'governance.audit',
    'cms.pages',
    'cms.settings',
  ].map((moduleKey) => ({
    moduleKey,
    canView: true,
    canCreate: true,
    canUpdate: true,
    canDelete: true,
  })) as AfHomesPermission[];
  const nav = navItemsForPermissions(permissions);
  expect(nav.some((item) => item.to === '/admin/redemption' || item.to === '/admin/points')).toBe(
    false,
  );
  for (const path of [
    '/admin/redemption',
    '/admin/redemption/history',
    '/admin/points/rules',
    '/admin/member-lookup',
    '/admin/reports',
    '/admin/audit',
    '/admin/cms/pages',
    '/admin/cms/site-settings',
  ])
    expect(canAccessNavTarget(permissions, path)).toBe(false);
  expect(canAccessNavTarget(permissions, '/admin/sales')).toBe(true);
  expect(availableReports(permissions)).toEqual([]);
});
