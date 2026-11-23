import { afterEach, expect, it } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared';
import type { AfHomesPermission } from '@afhomes/contracts';
import { canAccessNavTarget, navItemsForPermissions } from './navigation';
import { availableReports } from '../features/reports/reports';

afterEach(() => setFeatureFlags(DEFAULT_FEATURE_FLAGS));

it('hides switched-off modules and denies direct URLs even with full effective grants', () => {
  setFeatureFlags({ services: false, redemption: false, reports: false, cms: false });
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
    '/admin/cms/pages',
    '/admin/cms/site-settings',
  ])
    expect(canAccessNavTarget(permissions, path)).toBe(false);
  expect(canAccessNavTarget(permissions, '/admin/sales')).toBe(true);
  expect(availableReports(permissions)).toEqual([]);
  // The audit log stays reachable with Reports off, and its group opens on it.
  expect(canAccessNavTarget(permissions, '/admin/audit')).toBe(true);
  const reportsGroup = nav.find((item) => item.label === 'Reports');
  expect(reportsGroup?.to).toBe('/admin/audit');
  expect(reportsGroup?.dropdown?.map((child) => ('to' in child ? child.to : null))).toEqual(['/admin/audit']);
});
