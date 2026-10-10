import type { AfHomesModuleKey, AfHomesPermission } from '@afhomes/contracts';
import type { BreadcrumbItem, SidebarItem } from '@afhomes/ui';

export type NavLink = { to: string; label: string; module: AfHomesModuleKey };
export type AdminNavItem = {
  to: string;
  label: string;
  icon?: SidebarItem['icon'];
  end?: boolean;
  module: AfHomesModuleKey;
  dropdown?: NavLink[];
};

export const ADMIN_NAV_ITEMS: AdminNavItem[] = [
  { to: '/admin', label: 'Dashboard', icon: 'home', end: true, module: 'dashboard.view' },
  {
    // General Customer Lookup, for the GSD/Employee desk. Keyed on
    // `operations.redemption` because that is what `employee` already holds - see
    // `role-baseline.ts`, where employee deliberately has NO `sales.customers` row.
    // Reusing the existing key keeps this a read-only screen without inventing a
    // module or widening a role.
    //
    // It REPLACES the old top-level "VIP Member Lookup", which presented a member
    // TRANSACTION screen as a system-wide general lookup and displayed Membership
    // Codes to anyone who could see the nav. That screen still exists at
    // `/admin/member-lookup` and is reachable from Redemption, where a till belongs.
    to: '/admin/customer-lookup',
    label: 'Customer Lookup',
    icon: 'search',
    module: 'operations.redemption',
  },
  {
    to: '/admin/sales',
    label: 'Sales',
    icon: 'file-text',
    module: 'sales.card_sales',
    dropdown: [
      { to: '/admin/sales', label: 'Card Sales', module: 'sales.card_sales' },
      { to: '/admin/customers', label: 'Customers', module: 'sales.customers' },
      {
        to: '/admin/customers/import-export',
        label: 'Import / Export',
        module: 'governance.customer_import',
      },
      {
        to: '/admin/customers/applications',
        label: 'Customer Applications',
        module: 'sales.customers',
      },
      { to: '/admin/sales/reservations', label: 'IST Reservations', module: 'sales.card_sales' },
      { to: '/admin/products', label: 'Card Plans', module: 'sales.card_plans' },
      {
        to: '/admin/sales/payment-scheme-guide',
        label: 'Payment Scheme Guide',
        module: 'sales.card_sales',
      },
    ],
  },
  {
    to: '/admin/finance',
    label: 'Finance',
    icon: 'dollar-sign',
    module: 'finance.payment_verification',
    dropdown: [
      {
        to: '/admin/finance/payments',
        label: 'Payment Queue',
        module: 'finance.payment_verification',
      },
      {
        to: '/admin/finance/activation',
        label: 'Activation Queue',
        module: 'finance.card_activation',
      },
      {
        to: '/admin/finance/commissions',
        label: 'Commissions',
        module: 'network.commissions',
      },
      {
        to: '/admin/commissions/settings',
        label: 'Commission Settings',
        module: 'network.commissions',
      },
      {
        to: '/admin/memberships',
        label: 'Memberships',
        module: 'finance.card_activation',
      },
    ],
  },
  {
    to: '/admin/redemption',
    label: 'Redemption',
    icon: 'wallet',
    module: 'operations.redemption',
    dropdown: [
      { to: '/admin/redemption', label: 'Redeem Points', module: 'operations.redemption' },
      {
        to: '/admin/redemption/history',
        label: 'Redemption History',
        module: 'operations.redemption',
      },
      { to: '/admin/redemption/items', label: 'Redemption Catalog', module: 'operations.catalog' },
      // The member-TRANSACTION lookup, where a Membership Code is legitimately shown
      // because the next action is a redemption. Moved out of the global nav and into
      // Redemption so it is no longer presented as a system-wide general lookup.
      { to: '/admin/member-lookup', label: 'Member Lookup', module: 'operations.redemption' },
      {
        to: '/admin/points/discount',
        label: 'Use Points',
        module: 'operations.redemption',
      },
    ],
  },
  // Operational Services is SELLING, which is a different job from redeeming, so
  // it gets its own group rather than another entry under Redemption. The pages
  // are the ones that already exist and already work; this only groups them and
  // re-keys them to the permission each one actually needs.
  {
    to: '/admin/points',
    label: 'AFhomes Operational Services',
    icon: 'dollar-sign',
    module: 'operations.sales',
    dropdown: [
      // The GSD screen. `operations.sales` view+create is what a seller holds;
      // it grants no catalog, customer or verification authority.
      { to: '/admin/points', label: 'New Service Sale', module: 'operations.sales' },
      // Admin only: products, tier discounts and earning rules.
      { to: '/admin/points/rules', label: 'Products & Services', module: 'operations.catalog' },
      // Finance/Admin only: operational receipt verification AND the sales
      // ledger. Keyed to `operations.payments`, which `employee` does not
      // hold, so the seller cannot reach the screen that verifies their own
      // receipt - and which is deliberately NOT the VIP-card
      // `finance.payment_verification`.
      {
        to: '/admin/points/payments',
        label: 'Sales Records & Verification',
        module: 'operations.payments',
      },
    ],
  },
  {
    to: '/admin/genealogy',
    label: 'Sales Network',
    icon: 'users',
    module: 'network.genealogy',
    dropdown: [
      { to: '/admin/genealogy', label: 'Genealogy', module: 'network.genealogy' },
      {
        to: '/admin/ost/applications',
        label: 'OST Applications',
        module: 'network.ost_registrations',
      },
      { to: '/admin/ost/members', label: 'OST Members', module: 'network.ost_members' },
      { to: '/admin/ost/referral-code', label: 'My Referral Code', module: 'network.referrals' },
    ],
  },
  {
    to: '/admin/staff',
    label: 'Organization',
    icon: 'gear',
    module: 'organization.staff',
    dropdown: [
      { to: '/admin/staff', label: 'Staff', module: 'organization.staff' },
      { to: '/admin/departments', label: 'Departments', module: 'organization.departments' },
      { to: '/admin/roles', label: 'Roles & Permissions', module: 'organization.roles' },
    ],
  },
  // Phase 15 Reports and Audit Center. The group is keyed on `dashboard.view`
  // (every staff role holds it) so each role sees the group; the Reports
  // screen then offers only the reports the session's permissions allow, and
  // the Audit Log child keeps its own `governance.audit` key so sellers,
  // employees and customers never see it. The server re-checks everything.
  {
    to: '/admin/reports',
    label: 'Reports',
    icon: 'list',
    module: 'dashboard.view',
    dropdown: [
      { to: '/admin/reports', label: 'Reports', module: 'dashboard.view' },
      { to: '/admin/audit', label: 'Audit Log', module: 'governance.audit' },
    ],
  },
  {
    to: '/admin/cms',
    label: 'Website CMS',
    icon: 'image',
    module: 'cms.pages',
    dropdown: [
      { to: '/admin/cms/pages', label: 'Pages', module: 'cms.pages' },
      { to: '/admin/cms/media', label: 'Media', module: 'cms.media' },
      { to: '/admin/cms/stories', label: 'Stories', module: 'cms.pages' },
      { to: '/admin/cms/experiences', label: 'Experiences', module: 'cms.pages' },
      { to: '/admin/cms/site-settings', label: 'Site Settings', module: 'cms.settings' },
      { to: '/admin/cms/seo', label: 'SEO', module: 'cms.settings' },
      { to: '/admin/cms/history', label: 'History', module: 'cms.history' },
    ],
  },
];

export const canViewModule = (
  permissions: readonly AfHomesPermission[] | undefined,
  key: AfHomesModuleKey,
) => permissions?.some((permission) => permission.moduleKey === key && permission.canView) === true;

const REPORT_MODULES: readonly AfHomesModuleKey[] = [
  'sales.card_sales',
  'sales.customers',
  'sales.card_plans',
  'finance.payment_verification',
  'finance.card_activation',
  'finance.points',
  'network.commissions',
  'finance.commission_payouts',
  'operations.redemption',
  'network.genealogy',
  'network.ost_registrations',
  'network.ost_members',
];

const canViewReports = (permissions?: readonly AfHomesPermission[]) =>
  REPORT_MODULES.some((key) => canViewModule(permissions, key));

export function navItemsForPermissions(
  permissions?: readonly AfHomesPermission[],
  roleSlug?: string,
): SidebarItem[] {
  return ADMIN_NAV_ITEMS.flatMap((item) => {
    if (item.to === '/admin/customer-lookup' && roleSlug !== 'employee') return [];
    const dropdown = item.dropdown?.filter((child) =>
      child.to === '/admin/reports'
        ? canViewReports(permissions)
        : canViewModule(permissions, child.module),
    );
    const canViewParent =
      item.to === '/admin/reports'
        ? canViewReports(permissions)
        : canViewModule(permissions, item.module);
    if (!canViewParent && !dropdown?.length) return [];
    return [{ to: item.to, label: item.label, icon: item.icon, end: item.end, dropdown }];
  });
}

export function canAccessNavTarget(
  permissions: readonly AfHomesPermission[] | undefined,
  pathname: string,
): boolean {
  if (pathname === '/admin/reports') return canViewReports(permissions);
  if (pathname === '/admin/customer-lookup')
    return canViewModule(permissions, 'operations.redemption');
  // Compatibility-only document routes remain protected after removing navigation.
  if (pathname === '/admin/documents' || pathname.startsWith('/admin/documents/'))
    return canViewModule(permissions, 'sales.id_documents');
  const sub = findNavSubItem(pathname);
  const item = findNavItem(pathname);
  const key = sub?.sub.module ?? item?.module;
  return !key || canViewModule(permissions, key);
}

/**
 * Does `pathname` fall under this nav target?
 *
 * The LONGEST matching target wins. Prefix matching alone is wrong once a
 * dropdown holds both a parent route and a nested child: `/admin/redemption/items`
 * starts with `/admin/redemption/`, so a first-match search resolves the catalog
 * screen to the WORKFLOW's module key and checks the wrong permission. Choosing
 * the most specific match keeps a nested screen gated on its OWN module.
 */
const covers = (target: string, pathname: string): boolean =>
  pathname === target || pathname.startsWith(`${target}/`);

const mostSpecific = <T extends { to: string }>(
  targets: readonly T[],
  pathname: string,
): T | undefined =>
  targets
    .filter((target) => covers(target.to, pathname))
    .sort((a, b) => b.to.length - a.to.length)[0];

export function findNavItem(pathname: string) {
  return ADMIN_NAV_ITEMS.find(
    (item) =>
      covers(item.to, pathname) ||
      (item.dropdown ?? []).some((child) => covers(child.to, pathname)),
  );
}

export function findNavSubItem(pathname: string) {
  let best: { parent: AdminNavItem; sub: NavLink } | undefined;
  for (const parent of ADMIN_NAV_ITEMS) {
    const sub = mostSpecific(parent.dropdown ?? [], pathname);
    if (!sub) continue;
    if (!best || sub.to.length > best.sub.to.length) best = { parent, sub };
  }
  return best;
}
export function breadcrumbItems(pathname: string): BreadcrumbItem[] | null {
  if (pathname === '/admin') return [{ label: 'Dashboard' }];
  if (pathname === '/admin/profile')
    return [{ label: 'Dashboard', to: '/admin' }, { label: 'My Account' }];
  const found = findNavSubItem(pathname);
  if (!found) return null;
  const exact = pathname === found.sub.to;
  return exact
    ? [
        { label: 'Dashboard', to: '/admin' },
        { label: found.parent.label },
        { label: found.sub.label },
      ]
    : [
        { label: 'Dashboard', to: '/admin' },
        { label: found.sub.label, to: found.sub.to },
        { label: 'Details' },
      ];
}
