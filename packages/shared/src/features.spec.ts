import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_FEATURE_FLAGS,
  FEATURE_FLAGS,
  isFeaturePathEnabled,
  setFeatureFlags,
} from './features.js';

const ALL_OFF = { redemption: false, services: false, reports: false, cms: false };
afterEach(() => setFeatureFlags(DEFAULT_FEATURE_FLAGS));

it('defaults every module ON', () => {
  expect(FEATURE_FLAGS).toEqual({
    sales: true,
    finance: true,
    payroll: true,
    commissions: true,
    services: true,
    redemption: true,
    network: true,
    reports: true,
    cms: true,
  });
  expect(isFeaturePathEnabled('/admin/points')).toBe(true);
  expect(isFeaturePathEnabled('/admin/audit')).toBe(true);
});

it('ignores unknown keys and non-boolean values', () => {
  setFeatureFlags({ services: 'no', bogus: false, reports: false } as Record<string, unknown>);
  expect(FEATURE_FLAGS.services).toBe(true);
  expect(FEATURE_FLAGS.reports).toBe(false);
});

describe('switches for the remaining modules', () => {
  it('Sales hides its screens and the import API but keeps shared customer APIs', () => {
    setFeatureFlags({ sales: false });
    expect(isFeaturePathEnabled('/admin/customers/applications')).toBe(false);
    expect(isFeaturePathEnabled('/admin/sales/reservations/new')).toBe(false);
    expect(isFeaturePathEnabled('/admin/products')).toBe(false);
    expect(isFeaturePathEnabled('/admin/ist/my-sales')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/customer-imports')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/customers')).toBe(true);
    expect(isFeaturePathEnabled('/admin/customer-lookup')).toBe(true);
    expect(isFeaturePathEnabled('/admin/points')).toBe(true);
  });
  it('Finance, Payroll and Commissions switch independently', () => {
    setFeatureFlags({ finance: false });
    expect(isFeaturePathEnabled('/admin/finance')).toBe(false);
    expect(isFeaturePathEnabled('/admin/finance/payments')).toBe(false);
    expect(isFeaturePathEnabled('/admin/memberships/abc')).toBe(false);
    expect(isFeaturePathEnabled('/admin/finance/payroll')).toBe(true);
    expect(isFeaturePathEnabled('/admin/finance/commissions')).toBe(true);
    setFeatureFlags({ finance: true, payroll: false, commissions: false });
    expect(isFeaturePathEnabled('/admin/finance/payroll')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/queues/payroll/batches')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/queues/finance')).toBe(true);
    expect(isFeaturePathEnabled('/admin/commissions/settings')).toBe(false);
    expect(isFeaturePathEnabled('/admin/ist/team-commissions')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/commissions')).toBe(false);
    expect(isFeaturePathEnabled('/admin/finance/payments')).toBe(true);
  });
  it('Network hides the genealogy and members screens and APIs', () => {
    setFeatureFlags({ network: false });
    expect(isFeaturePathEnabled('/admin/genealogy/abc')).toBe(false);
    expect(isFeaturePathEnabled('/admin/network/members')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/genealogy')).toBe(false);
    expect(isFeaturePathEnabled('/api/v1/members')).toBe(false);
    expect(isFeaturePathEnabled('/admin/staff')).toBe(true);
  });
  it('never hides the always-on parts', () => {
    setFeatureFlags(Object.fromEntries(Object.keys(DEFAULT_FEATURE_FLAGS).map((k) => [k, false])));
    for (const path of [
      '/admin',
      '/admin/profile',
      '/admin/customer-lookup',
      '/admin/staff',
      '/admin/roles',
      '/admin/settings/modules',
      '/admin/audit',
      '/api/v1/reports/audit',
      '/api/v1/settings/features',
    ])
      expect(isFeaturePathEnabled(path)).toBe(true);
  });
});

describe('modules switched off at runtime', () => {
  it('disables Redemption and operational Services on every entry path', () => {
    setFeatureFlags(ALL_OFF);
    expect(FEATURE_FLAGS).toMatchObject(ALL_OFF);
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
      '/sales/reports','/employee/reports',
      '/admin/cms', '/admin/cms/pages', '/api/v1/cms/pages',
    ])
      expect(isFeaturePathEnabled(path), path).toBe(false);
  });
  it('preserves sales, finance, customers, network, organization and other reports', () => {
    setFeatureFlags(ALL_OFF);
    for (const path of [
      // The audit log is never hidden by a switch (owner 2026-11-21).
      '/admin/audit',
      '/api/v1/reports/audit',
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
