import { isAdminPortalRole, isStaffPortalRole, type AuthPortals } from '@jad/contracts';

import { env } from './env';

export type StaffEntryPortal = 'admin' | 'staff';

/**
 * Origin of the staff console. Locally this is the admin dev server
 * (`http://localhost:5174`); in production both SPAs share one origin, so a
 * same-origin `/admin/...` path is produced. Only `VITE_`-prefixed public env
 * is read here — never a server secret.
 */
export function adminOrigin(): string {
  try {
    return new URL(env.VITE_ADMIN_URL).origin;
  } catch {
    return window.location.origin;
  }
}

/** Absolute staff-console URL for an admin-SPA path (`/admin`, `/admin/profile`). */
export function toAdminUrl(path: string): string {
  return `${adminOrigin()}${path}`;
}

export type StaffEntryDecision =
  | { action: 'forward'; to: string }
  | { action: 'refuse'; message: string; linkTo: string; linkLabel: string };

/**
 * Pure entry decision for a resolved identity at the web-hosted staff entry.
 * Mirrors `apps/admin/src/lib/portal.ts#decideForPortal` so the two entries
 * can never disagree about which portal an account belongs to; the only
 * difference is that a `forward` here is an absolute staff-console URL (the
 * session cookie is shared cross-port in dev, so no retype is needed).
 */
export function decideStaffEntry(
  portal: StaffEntryPortal,
  portals: AuthPortals,
): StaffEntryDecision {
  const staffRole = portals.staff?.roleSlug ?? null;
  if (portals.staff && portals.staff.mustChangePassword) {
    return { action: 'forward', to: toAdminUrl('/admin/profile') };
  }
  if (portal === 'admin') {
    if (isAdminPortalRole(staffRole)) {
      return { action: 'forward', to: toAdminUrl('/admin') };
    }
    if (staffRole !== null) {
      return {
        action: 'refuse',
        message: 'This account uses the Staff Portal.',
        linkTo: '/staff/login',
        linkLabel: 'Go to Staff Login',
      };
    }
    if (portals.customer) {
      return {
        action: 'refuse',
        message: 'This is a customer account.',
        linkTo: '/customer/login',
        linkLabel: 'Go to Customer Login',
      };
    }
    if (portals.ost) {
      return {
        action: 'refuse',
        message: 'OST accounts use OST Login.',
        linkTo: '/ost/login',
        linkLabel: 'Go to OST Login',
      };
    }
    return {
      action: 'refuse',
      message: 'This sign-in has no staff identity.',
      linkTo: '/staff/login',
      linkLabel: 'Go to Staff Login',
    };
  }
  if (isStaffPortalRole(staffRole)) {
    return { action: 'forward', to: toAdminUrl('/admin') };
  }
  if (isAdminPortalRole(staffRole)) {
    return {
      action: 'refuse',
      message: 'This account uses the Administration portal.',
      linkTo: '/admin/login',
      linkLabel: 'Go to Administration Login',
    };
  }
  if (staffRole === 'ost' || portals.ost) {
    return {
      action: 'refuse',
      message: 'OST accounts use OST Login.',
      linkTo: '/ost/login',
      linkLabel: 'Go to OST Login',
    };
  }
  if (portals.customer) {
    return {
      action: 'refuse',
      message: 'This is a customer account.',
      linkTo: '/customer/login',
      linkLabel: 'Go to Customer Login',
    };
  }
  return {
    action: 'refuse',
    message: 'This sign-in has no staff identity.',
    linkTo: '/admin/login',
    linkLabel: 'Go to Administration Login',
  };
}
