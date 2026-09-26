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
      { to: '/admin/products', label: 'Card Products', module: 'sales.card_plans' },
    ],
  },
  {
    to: '/admin/finance',
    label: 'Finance',
    icon: 'grid',
    module: 'finance.payment_verification',
    dropdown: [
      { to: '/admin/finance/payments', label: 'Payment Queue', module: 'finance.payment_verification' },
      { to: '/admin/finance/activation', label: 'Activation Queue', module: 'finance.card_activation' },
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

export function findNavItem(pathname: string) {
  return ADMIN_NAV_ITEMS.find(
    (item) =>
      item.to === pathname ||
      item.dropdown?.some((child) => pathname === child.to || pathname.startsWith(`${child.to}/`)),
  );
}

export function findNavSubItem(pathname: string) {
  for (const parent of ADMIN_NAV_ITEMS) {
    const sub = parent.dropdown?.find(
      (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
    );
    if (sub) return { parent, sub };
  }
  return undefined;
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
