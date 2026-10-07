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
  MIGRATION_SEEDED_GRANTS,
  type BaselineRole,
} from './role-baseline.js';

const ALL_KEYS = new Set(afHomesModuleKeySchema.options);

const COMMUNICATION_MODULES = [
  'communications.messages',
  'communications.announcements',
  'communications.notifications',
] as const;

/** `canView, canCreate, canUpdate, canDelete` for one (role, module) pair. */
type GrantTuple = [boolean, boolean, boolean, boolean];

const tupleOf = (role: BaselineRole, moduleKey: string): GrantTuple | null => {
  const grant = DEFAULT_ROLE_BASELINE[role].find((g) => g.moduleKey === moduleKey);
  return grant ? [grant.canView, grant.canCreate, grant.canUpdate, grant.canDelete] : null;
};

/**
 * Asserts the EXACT tuple for one (role, module) pair. A missing row fails
 * with the module key in the message, so a row that was never added reads as a
 * missing grant rather than an undefined comparison.
 */
const expectGrant = (role: BaselineRole, moduleKey: string, expected: GrantTuple): GrantTuple => {
  const actual = tupleOf(role, moduleKey);
  expect(actual === null, `${role} holds no ${moduleKey} row`).toBe(false);
  expect(actual, `${role} ${moduleKey} tuple`).toEqual(expected);
  return actual as GrantTuple;
};

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

  it('leaves the four unresolved and four Phase 6 CMS modules ungranted to everyone', () => {
    expect([...BASELINE_EXCLUDED_MODULES].sort()).toEqual(
      [
        'finance.commission_payouts',
        'finance.final_qualification',
        'governance.config',
        'network.withdrawals',
        'cms.pages',
        'cms.media',
        'cms.settings',
        'cms.history',
      ].sort(),
    );
    const granted = new Set(
      Object.values(DEFAULT_ROLE_BASELINE).flatMap((grants) => grants.map((g) => g.moduleKey)),
    );
    for (const key of BASELINE_EXCLUDED_MODULES) {
      expect(granted.has(key), `${key} must stay ungranted`).toBe(false);
    }
    // And the union of granted + excluded + migration-seeded is the whole
    // module vocabulary. Migration-seeded grants stay out of the matrix so
    // the Phase-2-reviewed history is never rewritten.
    expect(
      new Set([
        ...granted,
        ...BASELINE_EXCLUDED_MODULES,
        ...MIGRATION_SEEDED_GRANTS.map((g) => g.moduleKey),
      ]),
    ).toEqual(ALL_KEYS);
  });

  it('reserves bulk customer import for admin via its migration-seeded grant', () => {
    expect(MIGRATION_SEEDED_GRANTS).toContainEqual({
      moduleKey: 'governance.customer_import',
      roles: ['admin'],
    });
    const granted = new Set(
      Object.values(DEFAULT_ROLE_BASELINE).flatMap((grants) => grants.map((g) => g.moduleKey)),
    );
    expect(granted.has('governance.customer_import')).toBe(false);
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

  /* ---- Communications (approved matrix, see the design spec) ---------- */

  it('grants communications messages create to every operational role', () => {
    for (const role of BASELINE_ROLES) {
      // update is admin + the three management tiers; those rows carry it.
      const canUpdate = [
        'admin',
        'vice_director',
        'senior_sales_manager',
        'sales_manager',
      ].includes(role);
      expectGrant(role, 'communications.messages', [true, true, canUpdate, false]);
    }
  });

  it('grants communications messages update only to admin, vice_director, senior_sales_manager and sales_manager', () => {
    const updatable = ['admin', 'vice_director', 'senior_sales_manager', 'sales_manager'];
    for (const role of BASELINE_ROLES) {
      const grant = DEFAULT_ROLE_BASELINE[role].find(
        (g) => g.moduleKey === 'communications.messages',
      );
      expect(grant !== undefined, `${role} must hold a communications.messages row`).toBe(true);
      expect(grant?.canUpdate, `${role} communications.messages update`).toBe(
        updatable.includes(role),
      );
    }
  });

  it('grants communications announcements create and update to admin only', () => {
    for (const role of BASELINE_ROLES) {
      const isAdmin = role === 'admin';
      expectGrant(role, 'communications.announcements', [true, isAdmin, isAdmin, false]);
    }
  });

  it('grants communications notifications view and update to every operational role', () => {
    for (const role of BASELINE_ROLES) {
      expectGrant(role, 'communications.notifications', [true, false, true, false]);
    }
  });

  it('grants no communications module to customer or super_admin', () => {
    expect([...BASELINE_ROLES]).not.toContain('customer');
    expect([...BASELINE_ROLES]).not.toContain('super_admin');
    expect(Object.keys(DEFAULT_ROLE_BASELINE)).not.toContain('customer');
    expect(Object.keys(DEFAULT_ROLE_BASELINE)).not.toContain('super_admin');
    // Neither identity appears in the matrix at all, so there is nothing to
    // look up: a customer can never hold a staff module and Super Admin's
    // access is implicit by slug.
    for (const role of ['customer', 'super_admin'] as const) {
      const grants = DEFAULT_ROLE_BASELINE[role as BaselineRole];
      expect(grants, `${role} must have no baseline rows at all`).toBeUndefined();
    }
  });

  it('uses only keys present in afHomesModuleKeySchema', () => {
    for (const key of COMMUNICATION_MODULES) {
      expect(ALL_KEYS.has(key), `${key} must be a valid module key`).toBe(true);
    }
    const granted = new Set(
      Object.values(DEFAULT_ROLE_BASELINE).flatMap((grants) => grants.map((g) => g.moduleKey)),
    );
    for (const key of granted) {
      expect(ALL_KEYS.has(key), `${key} must be a valid module key`).toBe(true);
    }
    // Communications is granted, never excluded.
    for (const key of COMMUNICATION_MODULES) {
      expect(BASELINE_EXCLUDED_MODULES).not.toContain(key);
    }
  });

  it('reports the flat row count the migration must install', () => {
    expect(BASELINE_ROW_COUNT).toBe(94);
    expect(DEFAULT_ROLE_BASELINE.admin.length).toBe(23);
    expect(DEFAULT_ROLE_BASELINE.finance.length).toBe(11);
    expect(DEFAULT_ROLE_BASELINE.hr.length).toBe(6);
    expect(DEFAULT_ROLE_BASELINE.vice_director.length).toBe(13);
    expect(DEFAULT_ROLE_BASELINE.senior_sales_manager.length).toBe(11);
    expect(DEFAULT_ROLE_BASELINE.sales_manager.length).toBe(13);
    expect(DEFAULT_ROLE_BASELINE.ost.length).toBe(11);
    expect(DEFAULT_ROLE_BASELINE.employee.length).toBe(6);
  });
});
