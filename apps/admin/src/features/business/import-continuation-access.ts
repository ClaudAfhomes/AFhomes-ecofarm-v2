import type { SessionUser } from '../../lib/session';

/** UX-only gate; every imported-purchase endpoint re-checks authorization. */
export function canViewImportContinuations(user: SessionUser | null | undefined): boolean {
  return (
    user?.roleSlug === 'super_admin' ||
    ['governance.customer_import', 'sales.customers'].every((moduleKey) =>
      user?.afHomesPermissions.some((p) => p.moduleKey === moduleKey && p.canView),
    )
  );
}
