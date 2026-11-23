/**
 * Module switches. Defaults are ON (owner instruction 2026-11-21, superseding the
 * Phase 1 "all off" decision D9). An authorized administrator can switch a module
 * off at runtime from Admin > Settings > Modules; both apps load the stored values
 * at startup and the API re-reads them on a short cache, then call
 * `setFeatureFlags`. A missing or unreadable store keeps these defaults.
 *
 * Turning a module off only HIDES and blocks its routes. It never deletes data,
 * and server-side permission checks still apply when it is on.
 */
export const FEATURE_FLAG_KEYS = [
  'sales',
  'finance',
  'payroll',
  'commissions',
  'services',
  'redemption',
  'network',
  'reports',
  'cms',
] as const;
export type FeatureFlagKey = (typeof FEATURE_FLAG_KEYS)[number];
export type FeatureFlags = Record<FeatureFlagKey, boolean>;

export const DEFAULT_FEATURE_FLAGS: Readonly<FeatureFlags> = Object.freeze(
  Object.fromEntries(FEATURE_FLAG_KEYS.map((key) => [key, true])) as FeatureFlags,
);

/**
 * Screen (admin/portal) and API prefixes each newer switch blocks. API prefixes are
 * listed only where the family belongs to that module alone: shared families such
 * as `customers` and `payments` also serve Services and the customer portal, so
 * Sales and Finance hide their screens but leave those shared APIs to permissions.
 */
const MODULE_PATHS: Partial<Record<FeatureFlagKey, { screens: string[]; api: string[] }>> = {
  sales: {
    screens: [
      '/admin/customers',
      '/admin/sales',
      '/admin/products',
      '/admin/ist/my-sales',
      '/admin/ist/team-sales',
    ],
    api: ['/customer-imports'],
  },
  finance: {
    screens: [
      '/admin/finance/payments',
      '/admin/finance/month-end',
      '/admin/finance/activation',
      '/admin/memberships',
    ],
    api: [],
  },
  payroll: { screens: ['/admin/finance/payroll'], api: ['/queues/payroll'] },
  commissions: {
    screens: [
      '/admin/finance/commissions',
      '/admin/commissions',
      '/admin/ist/my-commissions',
      '/admin/ist/team-commissions',
    ],
    api: ['/commissions'],
  },
  network: { screens: ['/admin/genealogy', '/admin/network'], api: ['/genealogy', '/members'] },
};

const current: FeatureFlags = { ...DEFAULT_FEATURE_FLAGS };

/** The live switch values (read-only view; change them with `setFeatureFlags`). */
export const FEATURE_FLAGS: Readonly<FeatureFlags> = current;

/** Apply stored switch values. Unknown keys and non-boolean values are ignored. */
export function setFeatureFlags(next: Partial<Record<string, unknown>> | null | undefined): void {
  if (!next) return;
  for (const key of FEATURE_FLAG_KEYS) {
    const value = next[key];
    if (typeof value === 'boolean') current[key] = value;
  }
}

export function isFeaturePathEnabled(pathname: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(pathname.split('?')[0] ?? '');
  } catch {
    return false;
  }
  const isApi = /^\/api(?:\/v1)?(?=\/)/.test(path);
  path = path.replace(/^\/api(?:\/v1)?(?=\/)/, '');
  if (!isApi) path = path.replace(/^\/(employee|finance|hr|sales)(?=\/)/, '/admin');
  const covers = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);
  // The audit log is governance, not a report: it follows only `governance.audit` and
  // is never hidden by a switch, so a switch-off can always be traced (owner 2026-11-21).
  if (!FEATURE_FLAGS.reports && ['/admin/reports', '/reports'].some(covers) && !covers('/reports/audit'))
    return false;
  if (!FEATURE_FLAGS.cms && ['/admin/cms', '/cms'].some(covers)) return false;
  if (
    !FEATURE_FLAGS.redemption &&
    [
      '/admin/redemption',
      '/admin/member-lookup',
      '/customer/redemptions',
      '/redemptions',
      '/reports/redemptions',
    ].some(covers)
  )
    return false;
  if (!FEATURE_FLAGS.services && ['/admin/points', '/customer/refunds', '/earning'].some(covers) && !(isApi && path === '/earning/adjust'))
    return false;
  if (!FEATURE_FLAGS.services && !isApi && covers('/customer/points')) return false;
  for (const [key, paths] of Object.entries(MODULE_PATHS) as [
    FeatureFlagKey,
    { screens: string[]; api: string[] },
  ][]) {
    if (!FEATURE_FLAGS[key] && (isApi ? paths.api : paths.screens).some(covers)) return false;
  }
  // The Finance landing page belongs to Finance; its Payroll and Commissions
  // children stay reachable on their own switches.
  if (!FEATURE_FLAGS.finance && !isApi && path === '/admin/finance') return false;
  return true;
}
