/**
 * AF Homes portal routing resolver (single source).
 *
 * Four portals share one Supabase Auth identity. Given what the server knows
 * about that identity - a staff row (with role + temporary-password flag), a
 * customer row, an OST row - this pure resolver produces the ONE legal
 * destination. Both SPAs and the API tests consume it, so the portals can
 * never disagree about where an account belongs.
 *
 * This resolves UX routing only. It authorizes nothing: every portal guard
 * and every endpoint re-validates server-side.
 */
import { z } from 'zod';

/** Roles that may enter through `/admin/login`. Nothing else. */
export const ADMIN_PORTAL_ROLES = ['super_admin', 'admin'] as const;

/**
 * Roles that may enter through `/staff/login`. OST has its own portal and its
 * own login; `admin`/`super_admin` use the administration entry; customers are
 * not staff at all.
 */
export const STAFF_PORTAL_ROLES = [
  'finance',
  'hr',
  'employee',
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
] as const;

export const isAdminPortalRole = (roleSlug: string | null | undefined): boolean =>
  typeof roleSlug === 'string' &&
  (ADMIN_PORTAL_ROLES as readonly string[]).includes(roleSlug);

export const isStaffPortalRole = (roleSlug: string | null | undefined): boolean =>
  typeof roleSlug === 'string' &&
  (STAFF_PORTAL_ROLES as readonly string[]).includes(roleSlug);

export const staffPortalRoleSchema = z.enum(STAFF_PORTAL_ROLES);

export type PortalIdentity = {
  /** Staff role slug, or null when the Auth user holds no staff row. */
  staffRole: string | null;
  /** True while the staff account still runs on a temporary password. */
  mustChangePassword: boolean;
  /** True when the Auth user owns an active customer record. */
  hasActiveCustomer: boolean;
  /** True when the Auth user owns any customer record at all. */
  hasCustomer: boolean;
  /** OST membership status, or null when the Auth user holds no OST row. */
  ostStatus: 'active' | 'inactive' | 'suspended' | null;
};

export const portalDestinationSchema = z.enum([
  'admin',
  'staff',
  'customer',
  'ost',
  'password-change',
  'chooser-customer-staff',
  'chooser-customer-admin',
  'pending-ost',
  'no-portal',
]);
export type PortalDestination = z.infer<typeof portalDestinationSchema>;

/**
 * The one legal destination for an identity. Precedence is deliberate:
 *
 * 1. A temporary password always wins: the account cannot use any portal
 *    until the forced change completes (the server 403s everything else).
 * 2. An approved OST identity routes to the OST portal. OST staff rows exist
 *    for genealogy, but OST never enters through the staff portal.
 * 3. Admin roles route to the administration portal, even when the same Auth
 *    user also owns a customer record (chooser, never an automatic downgrade
 *    to staff).
 * 4. Other staff roles route to the staff portal, with a chooser when they
 *    also own a customer record.
 * 5. A customer-only identity routes to the customer portal.
 * 6. A pending (non-approved) OST applicant has no portal yet.
 * 7. Anything else is `no-portal`: valid Auth, no AF Homes identity.
 */
export function resolvePortalDestination(identity: PortalIdentity): PortalDestination {
  if (identity.mustChangePassword && identity.staffRole !== null) return 'password-change';
  if (identity.ostStatus === 'active') return 'ost';
  const admin = isAdminPortalRole(identity.staffRole);
  const staff = isStaffPortalRole(identity.staffRole);
  if (admin && identity.hasCustomer) return 'chooser-customer-admin';
  if (admin) return 'admin';
  if (staff && identity.hasCustomer) return 'chooser-customer-staff';
  if (staff) return 'staff';
  if (identity.hasActiveCustomer) return 'customer';
  // A suspended/cancelled customer record is still an identity: the portal
  // shell explains the restriction instead of stranding them.
  if (identity.hasCustomer) return 'customer';
  if (identity.ostStatus !== null) return 'pending-ost';
  return 'no-portal';
}
