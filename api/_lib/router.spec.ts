import { describe, expect, it } from 'vitest';

import { resolveRequestUrl, selectHandler } from './router.js';

describe('selectHandler', () => {
  it('routes the health probe on both the bare and versioned paths', () => {
    expect(selectHandler('/health', {})?.routeKey).toBe('health');
    expect(selectHandler('/api/v1/health', {})?.routeKey).toBe('health');
  });

  it('routes the AF Homes surface and captures the sub-path', () => {
    const q: Record<string, string | undefined> = {};
    expect(selectHandler('/api/v1/admin/afhomes/session', q)?.routeKey).toBe(
      'admin/afhomes/session',
    );
    expect(q.afPath).toBe('session');

    expect(selectHandler('/api/v1/admin/afhomes/roles', q)?.routeKey).toBe('admin/afhomes/roles');
    expect(selectHandler('/api/v1/admin/afhomes/dashboard', q)?.routeKey).toBe(
      'admin/afhomes/dashboard',
    );
    expect(
      selectHandler('/api/v1/admin/afhomes/staff/6f1c0f7e-0e4a-4a1e-9a1b-2c3d4e5f6a7b', q)
        ?.routeKey,
    ).toBe('admin/afhomes/staff/6f1c0f7e-0e4a-4a1e-9a1b-2c3d4e5f6a7b');
  });

  it('routes the Phase 2 business families and captures the sub-path', () => {
    const q: Record<string, string | undefined> = {};
    for (const [path, expected] of [
      ['card-products', 'cards/card-products'],
      ['customers', 'customers/customers'],
      ['sales', 'sales/sales'],
      ['memberships', 'memberships/memberships'],
      ['points', 'memberships/points'],
      ['commissions', 'commissions/commissions'],
      ['referrals', 'referrals/referrals'],
      ['genealogy', 'genealogy/genealogy'],
      ['queues', 'queues/queues'],
    ] as const) {
      expect(selectHandler(`/api/v1/${path}`, q)?.routeKey, path).toBe(expected);
      expect(q.familyPath, path).toBe('');
    }

    q.familyPath = '';
    expect(selectHandler('/api/v1/sales/abc/payments', q)?.routeKey).toBe('sales/abc/payments');
    expect(q.familyPath).toBe('abc/payments');
    expect(selectHandler('/api/v1/payments/abc/verify', q)?.routeKey).toBe('sales/abc/verify');
    expect(selectHandler('/api/v1/queues/finance', q)?.routeKey).toBe('queues/finance');
    expect(selectHandler('/api/v1/points/ledger/abc', q)?.routeKey).toBe('memberships/ledger/abc');
  });

  it('routes every Phase 6 CMS endpoint through the literal CMS handler', () => {
    const q: Record<string, string | undefined> = {};
    for (const path of [
      'public',
      'documents',
      'pages',
      'media',
      'history',
      'public/pages/about-us',
    ]) {
      expect(selectHandler(`/api/v1/cms/${path}`, q)?.routeKey).toBe(`cms/${path}`);
      expect(q.familyPath).toBe(path);
    }
  });

  it('serves the bare /api prefix used by the local dev server', () => {
    const q: Record<string, string | undefined> = {};
    expect(selectHandler('/api/admin/afhomes/departments', q)?.routeKey).toBe(
      'admin/afhomes/departments',
    );
    expect(q.afPath).toBe('departments');
    expect(selectHandler('/api/sales/xyz', q)?.routeKey).toBe('sales/xyz');
  });

  it('does not let a family prefix swallow a longer unknown path', () => {
    expect(selectHandler('/api/v1/salesx', {})).toBeNull();
    expect(selectHandler('/api/v1/customers-archive', {})).toBeNull();
  });

  it('requires a sub-path on the AF Homes prefix', () => {
    // The catch-all is `(.+)`; the bare prefix must not swallow the prefix itself.
    expect(selectHandler('/api/v1/admin/afhomes', {})).toBeNull();
    expect(selectHandler('/api/v1/admin/afhomes/', {})).toBeNull();
  });

  it('returns null for the retired JAD route families', () => {
    for (const path of [
      '/api/v1/admin/members',
      '/api/v1/admin/queues',
      '/api/v1/admin/registrations',
      '/api/v1/admin/vouchers',
      '/api/v1/admin/withdrawals',
      '/api/v1/admin/properties',
      '/api/v1/admin/roles',
      '/api/v1/admin/staff',
      '/api/v1/admin/session',
      '/api/v1/me/wallet',
      '/api/v1/me/ledger',
      '/api/v1/auth/register',
      '/api/v1/auth/verify-email',
      '/api/v1/config/public',
      '/api/v1/policies',
      '/api/v1/programs',
      '/api/v1/locations/provinces',
      '/api/v1/contact',
      '/api/v1/registration/location-verify',
      '/api/v1/crons/commission-clearing',
    ]) {
      expect(selectHandler(path, {}), path).toBeNull();
    }
  });

  it('returns null for unknown paths', () => {
    expect(selectHandler('/api/v1/nope', {})).toBeNull();
    expect(selectHandler('/api/v1/admin/nope', {})).toBeNull();
  });
});

describe('resolveRequestUrl', () => {
  it('keeps the original /api/v1 URL and its query string', () => {
    const req = {
      url: '/api/v1/admin/afhomes/dashboard?range=month',
      query: { path: 'admin/afhomes/dashboard' },
    };
    expect(resolveRequestUrl(req)).toBe('/api/v1/admin/afhomes/dashboard?range=month');
  });

  it('rebuilds the path from the rewrite query param', () => {
    expect(resolveRequestUrl({ url: '/api/router', query: { path: 'admin/afhomes/roles' } })).toBe(
      '/api/v1/admin/afhomes/roles',
    );
    expect(
      resolveRequestUrl({ url: '/api/router', query: { path: 'admin/afhomes/staff/abc-123' } }),
    ).toBe('/api/v1/admin/afhomes/staff/abc-123');
  });

  it('joins array path params and falls back to the raw url', () => {
    expect(
      resolveRequestUrl({ url: '/api/router', query: { path: ['admin', 'afhomes', 'roles'] } }),
    ).toBe('/api/v1/admin/afhomes/roles');
    expect(resolveRequestUrl({ url: '/', query: {} })).toBe('/');
  });
});
