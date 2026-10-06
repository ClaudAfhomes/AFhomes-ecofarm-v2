import type { AuthPortals } from '@afhomes/contracts';

/** Uses only the server's identity readback, never editable Auth metadata. */
export function portalDashboard(
  portals: AuthPortals,
  preferred?: 'customer' | 'ost',
): string | null {
  if (portals.staff?.mustChangePassword) return '/admin/profile';
  if (preferred === 'customer' && portals.customer) return '/customer';
  if (portals.ost?.status === 'active') return '/ost/dashboard';
  if (portals.staff?.roleSlug && !['customer', 'ost'].includes(portals.staff.roleSlug))
    return '/admin';
  if (portals.customer) return '/customer';
  if (portals.ost) return '/ost/login';
  return null;
}
