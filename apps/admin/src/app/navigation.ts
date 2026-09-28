import type { AfHomesModuleKey, AfHomesPermission } from '@jad/contracts';
import type { BreadcrumbItem, SidebarItem } from '@jad/ui';

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
  { to: '/admin', label: 'Dashboard', icon: 'grid', end: true, module: 'dashboard.view' },
  {
    to: '/admin/sales',
    label: 'Sales & Customers',
    icon: 'grid',
    module: 'sales.card_sales',
    dropdown: [
      { to: '/admin/sales', label: 'Card Sales', module: 'sales.card_sales' },
      { to: '/admin/customers', label: 'Customers', module: 'sales.customers' },
      { to: '/admin/products', label: 'Card Plans', module: 'sales.card_plans' },
      { to: '/admin/documents', label: 'ID Documents', module: 'sales.id_documents' },
    ],
  },
  {
    to: '/admin/finance',
    label: 'Finance',
    icon: 'grid',
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
        to: '/admin/memberships',
        label: 'Memberships',
        module: 'finance.card_activation',
      },
    ],
  },
  {
    to: '/admin/redemption',
    label: 'Redemption',
    icon: 'grid',
    module: 'operations.redemption',
    dropdown: [
      { to: '/admin/redemption', label: 'Redeem Points', module: 'operations.redemption' },
      {
        to: '/admin/redemption/history',
        label: 'Redemption History',
        module: 'operations.redemption',
      },
      { to: '/admin/redemption/items', label: 'Redemption Catalog', module: 'operations.catalog' },
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
    icon: 'users',
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
    icon: 'grid',
    module: 'dashboard.view',
    dropdown: [
      { to: '/admin/reports', label: 'Reports', module: 'dashboard.view' },
      { to: '/admin/audit', label: 'Audit Log', module: 'governance.audit' },
    ],
  },
  {
    to: '/admin/cms',
    label: 'Website CMS',
    icon: 'grid',
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

export function navItemsForPermissions(permissions?: readonly AfHomesPermission[]): SidebarItem[] {
  return ADMIN_NAV_ITEMS.flatMap((item) => {
    const dropdown = item.dropdown?.filter((child) => canViewModule(permissions, child.module));
    if (!canViewModule(permissions, item.module) && !dropdown?.length) return [];
    return [{ to: item.to, label: item.label, icon: item.icon, end: item.end, dropdown }];
  });
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
