/**
 * AF Homes default role permission baseline (Phase 2).
 *
 * Single source of truth for the explicit, reviewed, database-backed default
 * grants that take every non-customer operational role from zero modules to
 * its intended set. The migration
 * `supabase/migrations/20260930000001_afhomes_role_permission_baseline.sql`
 * is the database copy of THIS table; `api/_handlers/role-baseline.spec.ts`
 * proves the behaviour, and `supabase/db-integration.ts` section 38 proves
 * the installed rows.
 *
 * Rules this table obeys (each pinned by `role-baseline.spec.ts` in this
 * package and by the migration's own CHECKs):
 *
 * - Only the 24 keys of `afHomesModuleKeySchema` appear. No new vocabulary.
 * - `canDelete` is false everywhere: no handler exposes a delete endpoint,
 *   so a delete grant would authorize nothing and only widen the surface.
 * - `canCreate`/`canUpdate` imply `canView` (the database CHECK enforces it).
 * - `super_admin` and `customer` have NO rows here. Super Admin is implicit
 *   full access by slug (`private.has_permission()` and the server resolver);
 *   the customer portal is ownership-based, never permission-based.
 * - Four modules are granted to NOBODY because no workflow exists for them
 *   yet: `finance.final_qualification`, `finance.commission_payouts`,
 *   `network.withdrawals`, `governance.config`. Granting them would be a
 *   guess. They are listed in `BASELINE_EXCLUDED_MODULES` so the omission is
 *   explicit and reportable, not an accident.
 * - Sellers hold NO `sales.uplines` row (not even view): assigning or
 *   correcting an upline requires that module and a seller must never call
 *   those paths; view alone authorizes no endpoint, and reading the network
 *   is covered by `network.referrals` view.
 * - `operations.redemption` create (spending points) belongs to `employee`
 *   only. Sellers resolve members through `sales.customers` instead.
 * - `network.commissions` update (the manual qualification decision) belongs
 *   to `admin` only. Finance and sellers inspect (view).
 * - `finance.points` is view everywhere: no adjustment endpoint exists, so a
 *   create/update grant would authorize nothing.
 * - `operations.catalog` create/update (catalog maintenance) belongs to
 *   `admin` only. `employee` reads the catalog in order to redeem.
 */
import type { AfHomesModuleKey } from './afhomes.js';

export type BaselineGrant = {
  moduleKey: AfHomesModuleKey;
  canView: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
};

const v = (moduleKey: AfHomesModuleKey): BaselineGrant => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

const vc = (moduleKey: AfHomesModuleKey): BaselineGrant => ({
  ...v(moduleKey),
  canCreate: true,
});

const vu = (moduleKey: AfHomesModuleKey): BaselineGrant => ({
  ...v(moduleKey),
  canUpdate: true,
});

const vcu = (moduleKey: AfHomesModuleKey): BaselineGrant => ({
  ...v(moduleKey),
  canCreate: true,
  canUpdate: true,
});

/** Roles covered by the baseline. `super_admin` and `customer` are absent by design. */
export const BASELINE_ROLES = [
  'admin',
  'finance',
  'hr',
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
  'employee',
] as const;
export type BaselineRole = (typeof BASELINE_ROLES)[number];

/**
 * Modules granted to NOBODY in this phase. Each needs an explicit,
 * approved workflow before it is granted to anyone.
 */
export const BASELINE_EXCLUDED_MODULES: readonly AfHomesModuleKey[] = [
  'finance.final_qualification',
  'finance.commission_payouts',
  'network.withdrawals',
  'governance.config',
];

export const DEFAULT_ROLE_BASELINE: Record<BaselineRole, readonly BaselineGrant[]> = {
  admin: [
    v('dashboard.view'),
    vc('sales.card_sales'),
    vu('sales.card_plans'),
    vcu('sales.customers'),
    v('sales.id_documents'),
    vcu('sales.uplines'),
    vu('finance.payment_verification'),
    vu('finance.card_activation'),
    v('finance.points'),
    vu('network.commissions'),
    v('network.genealogy'),
    v('network.ost_members'),
    v('network.ost_registrations'),
    v('network.referrals'),
    vcu('operations.catalog'),
    v('operations.redemption'),
    vc('organization.departments'),
    vcu('organization.roles'),
    vcu('organization.staff'),
    v('governance.audit'),
  ],
  finance: [
    v('dashboard.view'),
    vu('finance.payment_verification'),
    vu('finance.card_activation'),
    v('finance.points'),
    v('network.commissions'),
    v('sales.customers'),
    v('sales.card_sales'),
    v('sales.card_plans'),
  ],
  hr: [v('dashboard.view'), vcu('organization.staff'), vc('organization.departments')],
  vice_director: [
    v('dashboard.view'),
    vc('sales.card_sales'),
    vcu('sales.customers'),
    v('sales.id_documents'),
    v('sales.card_plans'),
    v('network.genealogy'),
    v('network.referrals'),
    v('network.ost_members'),
    v('network.ost_registrations'),
    v('network.commissions'),
  ],
  senior_sales_manager: [
    v('dashboard.view'),
    vc('sales.card_sales'),
    vcu('sales.customers'),
    v('sales.id_documents'),
    v('sales.card_plans'),
    v('network.genealogy'),
    v('network.referrals'),
    v('network.commissions'),
  ],
  sales_manager: [
    v('dashboard.view'),
    vc('sales.card_sales'),
    vcu('sales.customers'),
    v('sales.id_documents'),
    v('sales.card_plans'),
    v('network.genealogy'),
    v('network.referrals'),
    v('network.ost_members'),
    v('network.ost_registrations'),
    v('network.commissions'),
  ],
  ost: [
    v('dashboard.view'),
    vc('sales.card_sales'),
    vcu('sales.customers'),
    v('sales.id_documents'),
    v('sales.card_plans'),
    v('network.commissions'),
    v('network.referrals'),
    v('network.genealogy'),
  ],
  employee: [v('dashboard.view'), vc('operations.redemption'), v('operations.catalog')],
};

/** Flat row count, for reporting only. Never assert behaviour from a count. */
export const BASELINE_ROW_COUNT = (
  Object.values(DEFAULT_ROLE_BASELINE) as BaselineGrant[][]
).reduce((sum, grants) => sum + grants.length, 0);
