import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS, isFeaturePathEnabled } from './features.js';

describe('Phase 1 feature flags', () => {
  it('disables Redemption and operational Services on every entry path', () => {
    expect(FEATURE_FLAGS).toEqual({ redemption: false, services: false, reports: false, cms: false });
    for (const path of [
      '/admin/redemption',
      '/admin/redemption/history',
      '/admin/member-lookup',
      '/admin/points',
      '/admin/points/payments',
      '/customer/redemptions',
      '/customer/points',
      '/api/v1/redemptions',
      '/api/earning/services',
      '/api/v1/earning/public/services',
      '/api/v1/customer/refunds',
      '/api/v1/reports/redemptions',
      '/api/v1/%65arning/claims',
      '/admin/reports', '/admin/reports/sales', '/api/v1/reports/sales',
      '/admin/audit','/sales/reports','/employee/reports',
      '/admin/cms', '/admin/cms/pages', '/api/v1/cms/pages',
    ])
      expect(isFeaturePathEnabled(path), path).toBe(false);
  });
  it('preserves sales, finance, customers, network, organization and other reports', () => {
    for (const path of [
      '/admin/sales',
      '/admin/finance/payments',
      '/admin/customers',
      '/admin/customer-lookup',
      '/admin/genealogy',
      '/admin/network/members',
      '/admin/staff',
      '/admin/roles',
      '/api/v1/sales',
      '/api/v1/payments',
      '/api/v1/customer/payments',
      '/api/v1/ost',
      '/experiences',
      '/api/v1/memberships',
      '/api/v1/earning/adjust',
    ])
      expect(isFeaturePathEnabled(path), path).toBe(true);
  });
});
