/**
 * Portal entry model for the staff console SPA.
 *
 * One SPA serves two entries: `/admin/login` (Super Admin + Admin) and
 * `/staff/login` (every other staff role). Authenticated pages stay shared
 * under `/admin/*` and permission-gated - the distinction is identity entry
 * plus authorization, never duplicated screens.
 */
import { isAdminPortalRole, isStaffPortalRole, type AuthPortals } from '@jad/contracts';

import { env } from './env';

export type EntryPortal = 'admin' | 'staff';

const ENTRY_KEY = 'afh-entry-portal';

/** Remember which login the user came through (survives the auth round-trip). */
export function rememberEntryPortal(portal: EntryPortal): void {
  try {
    sessionStorage.setItem(ENTRY_KEY, portal);
  } catch {
    // Private browsing without storage: entry tracking is a UX hint only.
  }
}

export function entryPortal(): EntryPortal {
  try {
    return sessionStorage.getItem(ENTRY_KEY) === 'staff' ? 'staff' : 'admin';
  } catch {
    return 'admin';
  }
}

export const loginPathFor = (portal: EntryPortal): string =>
  portal === 'staff' ? '/staff/login' : '/admin/login';

/** Same-origin web (customer/OST) base. Falls back to this origin in production. */
export const webBase = (): string => env.VITE_WEB_URL || window.location.origin;

/** Auth pages must never become a post-login landing: the forced-change
 *  screen (`/admin/profile`) renders identically to the account screen, so
 *  restoring it after login looks exactly like the password loop. */
const AUTH_PATHS = new Set([
  '/admin/login',
  '/staff/login',
  '/admin/forgot-password',
  '/staff/forgot-password',
  '/admin/reset-password',
  '/staff/reset-password',
  '/admin/activate-account',
]);

export function resolvePostLoginDestination(
  requested: string | undefined,
  fallback: string,
): string {
  if (
    typeof requested === 'string' &&
    requested === fallback &&
    !AUTH_PATHS.has(requested) &&
    requested !== '/admin/profile'
  ) {
    return requested;
  }
  return fallback;
}

/** Where logout lands: each portal returns to its own entry. */
export function logoutPathForRole(roleSlug: string | undefined): string {
  return roleSlug === 'admin' || roleSlug === 'super_admin' ? '/admin/login' : '/staff/login';
}

export type PortalDecision =
  | { action: 'forward'; to: string }
  | { action: 'refuse'; message: string; linkTo: string; linkLabel: string };

/**
 * Pure entry decision for a resolved identity at one portal. Unit-tested;
 * the pages only render it. A temporary password always forwards to the
 * shared change screen; anything refused names the right portal and links
 * straight there. The session is deliberately NOT cleared on refusal, so the
 * correct login forwards without retyping a password.
 */
export function decideForPortal(
  portal: EntryPortal,
  portals: AuthPortals,
  requested: string | undefined,
): PortalDecision {
  const staffRole = portals.staff?.roleSlug ?? null;
  if (portals.staff && portals.staff.mustChangePassword) {
    return { action: 'forward', to: '/admin/profile' };
  }
  if (portal === 'admin') {
    if (isAdminPortalRole(staffRole)) {
      return { action: 'forward', to: resolvePostLoginDestination(requested, '/admin') };
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
        linkTo: `${webBase()}/customer/login`,
        linkLabel: 'Go to Customer Login',
      };
    }
    if (portals.ost) {
      return {
        action: 'refuse',
        message: 'OST accounts use OST Login.',
        linkTo: `${webBase()}/ost/login`,
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
    const fallback = '/admin';
    return { action: 'forward', to: resolvePostLoginDestination(requested, fallback) };
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
      linkTo: `${webBase()}/ost/login`,
      linkLabel: 'Go to OST Login',
    };
  }
  if (portals.customer) {
    return {
      action: 'refuse',
      message: 'This is a customer account.',
      linkTo: `${webBase()}/customer/login`,
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
