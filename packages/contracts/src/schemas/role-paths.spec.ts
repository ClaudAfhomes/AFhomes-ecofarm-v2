import { expect, it } from 'vitest';
import { operationsPath, staffPortalPath } from './portal-routing.js';
it.each([
  'employee',
  'finance',
  'hr',
  'sales_manager',
  'senior_sales_manager',
  'vice_director',
  'admin',
  'super_admin',
])('round trips shared operational URLs for %s', (role) => {
  const logical = '/admin/customers/applications/qa';
  expect(operationsPath(staffPortalPath(role, logical))).toBe(logical);
});
it('avoids a repeated finance prefix', () =>
  expect(staffPortalPath('finance', '/admin/finance/payments')).toBe('/finance/payments'));
it('preserves the separate customer namespace', () =>
  expect(staffPortalPath('finance', '/customer/login')).toBe('/customer/login'));
