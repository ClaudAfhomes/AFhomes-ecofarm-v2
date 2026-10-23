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
    // General Customer Lookup, for the GSD/Employee desk. Keyed on its OWN
    // module (`operations.customer_lookup`), seeded by 20261131000003 with
    // view grants for `employee` and `admin`, so the permission list shows the
    // screen by name instead of borrowing `operations.redemption`. The nav is
    // permission-driven: any role granted that view sees this entry, and no
    // role can reach the screen without it.
    //
    // It REPLACES the old top-level "VIP Member Lookup", which presented a member
    // TRANSACTION screen as a system-wide general lookup and displayed Membership
    // Codes to anyone who could see the nav. That screen still exists at
    // `/admin/member-lookup` and is reachable from Redemption, where a till belongs.
    to: '/admin/customer-lookup',
    label: 'Customer Lookup',
    icon: 'search',
    module: 'operations.customer_lookup',
  },
  {
    to: '/admin/sales',
    label: 'Sales',
    icon: 'file-text',
    module: 'sales.card_sales',
    dropdown: [
      { to: '/admin/customers', label: 'Customers', module: 'sales.customers' },
      // Applications is the second view of the customers screen, but it keeps
      // its OWN address: `findNavSubItem` and `breadcrumbItems` are given
      // `pathname` only, so a search-parameter target could never be marked
      // active and the breadcrumb would name the wrong page.
      { to: '/admin/customers/applications', label: 'Applications', module: 'sales.customers' },
      { to: '/admin/sales/reservations', label: 'Reservation', module: 'sales.card_sales' },
      { to: '/admin/products', label: 'Card Plans', module: 'sales.card_plans' },
      {
        to: '/admin/sales/payment-scheme-guide',
        label: 'Scheme Guide',
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
        label: 'Payment List',
        module: 'finance.payment_verification',
      },
      {
        to: '/admin/finance/activation',
        label: 'Activation List',
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
      { to: '/admin/redemption', label: 'Points Claims', module: 'operations.redemption' },
      {
        to: '/admin/redemption/history',
        label: 'Claim History',
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
    label: 'Services',
    // Selling-desk group: must not share Finance's 'dollar-sign' icon.
    icon: 'grid',
    module: 'operations.sales',
    dropdown: [
      // The GSD screen. `operations.sales` view+create is what a seller holds;
      // it grants no catalog, customer or verification authority.
      { to: '/admin/points', label: 'New Sale', module: 'operations.sales' },
      // Points spending is a POS act, not a redemption-desk one: it lives with
      // the sale, keyed to the same `operations.sales` the seller holds, and
      // nowhere near the earning-claim queue.
      { to: '/admin/points/use', label: 'Use Points', module: 'operations.sales' },
      // Admin only: products, tier discounts and earning rules.
      { to: '/admin/points/rules', label: 'Catalog', module: 'operations.catalog' },
      { to: '/admin/points/records', label: 'Sales Records', module: 'sales.customers' },
      // Finance/Admin only: operational receipt verification AND the sales
      // ledger. Keyed to `operations.payments`, which `employee` does not
      // hold, so the seller cannot reach the screen that verifies their own
      // receipt - and which is deliberately NOT the VIP-card
      // `finance.payment_verification`.
      {
        to: '/admin/points/payments',
        label: 'Verify Receipts',
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
      { to: '/admin/network/members', label: 'Members', module: 'network.members' },
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
      { to: '/admin/roles', label: 'Roles', module: 'organization.roles' },
      { to: '/admin/settings/public-verification', label: 'Public Verification Settings', module: 'governance.config' },
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
  items = ADMIN_NAV_ITEMS,
): SidebarItem[] {
  return items.flatMap((item) => {
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

export function istNavItemsForPermissions(permissions?: readonly AfHomesPermission[]): SidebarItem[] {
  return navItemsForPermissions(permissions, [
    ADMIN_NAV_ITEMS[0]!,
    {
      to: '/admin/ist/my-sales', label: 'Sales', icon: 'file-text', module: 'sales.card_sales',
      dropdown: [
        { to: '/admin/ist/my-sales', label: 'My Sales', module: 'sales.card_sales' },
        { to: '/admin/ist/team-sales', label: 'Team Sales', module: 'sales.card_sales' },
      ],
    },
    {
      to: '/admin/ist/my-commissions', label: 'Commissions', icon: 'wallet', module: 'network.commissions',
      dropdown: [
        { to: '/admin/ist/my-commissions', label: 'My Commissions', module: 'network.commissions' },
        { to: '/admin/ist/team-commissions', label: 'Team Commissions', module: 'network.commissions' },
      ],
    },
    ADMIN_NAV_ITEMS.find((item) => item.to === '/admin/genealogy')!,
    {
      to: '/admin/ist/accreditation', label: 'Accreditation', icon: 'file-text', module: 'dashboard.view',
    },
    { to: '/admin/profile', label: 'Profile', icon: 'user', module: 'dashboard.view' },
  ]);
}

/**
 * Explicit path -> module gate for console screens that are NOT (or not only)
 * nav entries: `/admin/member-lookup` is reached from Redemption, the documents
 * screens are compatibility-only after leaving the sidebar, and the customer
 * import/export workspace is reached from the Applications list action.
 *
 * ONE table, so the guard below and the coverage spec cannot drift: every
 * module referenced here is asserted to exist in the module catalog, which is
 * what keeps every page in the Roles listing.
 */
export const EXTRA_GATED_ROUTES: readonly {
  pathPrefix: string;
  module: AfHomesModuleKey;
}[] = [
  { pathPrefix: '/admin/ist/my-sales', module: 'sales.card_sales' },
  { pathPrefix: '/admin/ist/team-sales', module: 'sales.card_sales' },
  { pathPrefix: '/admin/ist/my-commissions', module: 'network.commissions' },
  { pathPrefix: '/admin/ist/team-commissions', module: 'network.commissions' },
  { pathPrefix: '/admin/ist/accreditation', module: 'dashboard.view' },
  { pathPrefix: '/admin/member-lookup', module: 'operations.redemption' },
  { pathPrefix: '/admin/customer-lookup', module: 'operations.customer_lookup' },
  // `/admin/documents` list/review route removed; the scan travels with the
  // application. The `sales.id_documents` module still gates the image on the
  // customer record.
  {
    pathPrefix: '/admin/customers/applications/import-export',
    module: 'governance.customer_import',
  },
];

export function canAccessNavTarget(
  permissions: readonly AfHomesPermission[] | undefined,
  pathname: string,
): boolean {
  // `/admin/reports` is visible on ANY report permission, not one key: the
  // screen then offers only the reports the session allows.
  if (pathname === '/admin/reports') return canViewReports(permissions);
  const extra = EXTRA_GATED_ROUTES.find(
    (entry) => pathname === entry.pathPrefix || pathname.startsWith(`${entry.pathPrefix}/`),
  );
  if (extra) return canViewModule(permissions, extra.module);
  const sub = findNavSubItem(pathname);
  const item = findNavItem(pathname);
  const key = sub?.sub.module ?? item?.module;
  return !key || canViewModule(permissions, key);
}

/**
 * Does `pathname` fall under this nav target?
 *
 * The LONGEST matching target wins. Prefix matching alone is wrong once a
 * group holds both a parent route and a nested child: `/admin/points/rules`
 * starts with `/admin/points/`, so a first-match search resolves the catalog
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
  // The dashboard is the console home: a self-referencing "Dashboard" crumb
  // adds a redundant label above Operations Overview, so no trail renders here.
  // Deeper pages keep their `Dashboard -> …` home link untouched.
  if (pathname === '/admin') return null;
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
