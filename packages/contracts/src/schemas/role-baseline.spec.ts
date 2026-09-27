/**
 * Structural pins for the Phase 2 default role permission baseline.
 *
 * These guard the TABLE itself, not any database: every invariant here is a
 * property the migration SQL must also hold, so a reviewer can see the intent
 * without reading SQL.
 */
import { describe, expect, it } from 'vitest';

import { afHomesModuleKeySchema } from './afhomes.js';
import {
  BASELINE_EXCLUDED_MODULES,
  BASELINE_ROLES,
  BASELINE_ROW_COUNT,
  DEFAULT_ROLE_BASELINE,
} from './role-baseline.js';

const ALL_KEYS = new Set(afHomesModuleKeySchema.options);

describe('default role permission baseline', () => {
  it('covers exactly the eight operational roles (never super_admin or customer)', () => {
    expect([...BASELINE_ROLES].sort()).toEqual(
      [
        'admin',
        'employee',
        'finance',
        'hr',
        'ost',
        'sales_manager',
        'senior_sales_manager',
        'vice_director',
      ].sort(),
    );
    expect(Object.keys(DEFAULT_ROLE_BASELINE).sort()).toEqual([...BASELINE_ROLES].sort());
  });

  it('uses only existing module keys, with no duplicates per role', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_BASELINE)) {
      const keys = grants.map((grant) => grant.moduleKey);
      for (const key of keys) {
        expect(ALL_KEYS.has(key), `${role}: unknown module ${key}`).toBe(true);
      }
      expect(new Set(keys).size, `${role}: duplicate module`).toBe(keys.length);
      expect(keys.length, `${role}: zero modules`).toBeGreaterThan(0);
    }
  });

  it('grants canDelete to nobody (no delete endpoint exists to authorize)', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_BASELINE)) {
      for (const grant of grants) {
        expect(grant.canDelete, `${role} ${grant.moduleKey}: canDelete`).toBe(false);
      }
    }
  });

  it('never grants create/update without view (the database CHECK requires it)', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_BASELINE)) {
      for (const grant of grants) {
        if (grant.canCreate || grant.canUpdate) {
          expect(grant.canView, `${role} ${grant.moduleKey}: action without view`).toBe(true);
        }
      }
    }
  });

  it('leaves exactly the four unresolved modules ungranted to everyone', () => {
    expect([...BASELINE_EXCLUDED_MODULES].sort()).toEqual(
      [
        'finance.commission_payouts',
        'finance.final_qualification',
        'governance.config',
        'network.withdrawals',
      ].sort(),
    );
    const granted = new Set(
      Object.values(DEFAULT_ROLE_BASELINE).flatMap((grants) => grants.map((g) => g.moduleKey)),
    );
    for (const key of BASELINE_EXCLUDED_MODULES) {
      expect(granted.has(key), `${key} must stay ungranted`).toBe(false);
    }
    // And the union of granted + excluded is the whole module vocabulary.
    expect(new Set([...granted, ...BASELINE_EXCLUDED_MODULES])).toEqual(ALL_KEYS);
  });

  it('gives sellers no sales.uplines row (they must never assign an upline)', () => {
    for (const role of ['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'] as const) {
      const keys = DEFAULT_ROLE_BASELINE[role].map((grant) => grant.moduleKey);
      expect(keys, `${role} must not hold sales.uplines`).not.toContain('sales.uplines');
    }
    expect(DEFAULT_ROLE_BASELINE.admin.map((grant) => grant.moduleKey)).toContain('sales.uplines');
  });

  it('reserves the commission qualification decision (update) for admin alone', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_BASELINE)) {
      const commissions = grants.find((grant) => grant.moduleKey === 'network.commissions');
      if (!commissions) continue;
      expect(commissions.canUpdate, `${role} network.commissions update`).toBe(role === 'admin');
    }
  });

  it('keeps finance.points read-only everywhere (no adjustment endpoint exists)', () => {
    for (const [role, grants] of Object.entries(DEFAULT_ROLE_BASELINE)) {
      const points = grants.find((grant) => grant.moduleKey === 'finance.points');
      if (!points) continue;
      expect(points.canCreate, `${role} finance.points`).toBe(false);
      expect(points.canUpdate, `${role} finance.points`).toBe(false);
    }
  });

  it('reports the flat row count the migration must install (70)', () => {
    expect(BASELINE_ROW_COUNT).toBe(70);
    expect(DEFAULT_ROLE_BASELINE.admin.length).toBe(20);
    expect(DEFAULT_ROLE_BASELINE.finance.length).toBe(8);
    expect(DEFAULT_ROLE_BASELINE.hr.length).toBe(3);
    expect(DEFAULT_ROLE_BASELINE.vice_director.length).toBe(10);
    expect(DEFAULT_ROLE_BASELINE.senior_sales_manager.length).toBe(8);
    expect(DEFAULT_ROLE_BASELINE.sales_manager.length).toBe(10);
    expect(DEFAULT_ROLE_BASELINE.ost.length).toBe(8);
    expect(DEFAULT_ROLE_BASELINE.employee.length).toBe(3);
  });
});
