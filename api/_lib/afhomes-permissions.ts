import type { AfHomesAction, AfHomesPermission } from '@afhomes/contracts';

/**
 * Pure permission predicates shared by the Supabase and MongoDB authorization
 * adapters. This module deliberately has no database, auth, or network import,
 * so the standalone MongoDB runtime does not pull the Supabase client into its
 * production bundle.
 */
export function actionAllowed(permission: AfHomesPermission | undefined, action: AfHomesAction) {
  if (!permission) return false;
  return action === 'view'
    ? permission.canView
    : action === 'create'
      ? permission.canCreate
      : action === 'update'
        ? permission.canUpdate
        : permission.canDelete;
}

export function permissionsAreSubset(requested: AfHomesPermission[], held: AfHomesPermission[]) {
  const byKey = new Map(held.map((permission) => [permission.moduleKey, permission]));
  return requested.every((permission) => {
    const own = byKey.get(permission.moduleKey);
    return (
      (!permission.canView || own?.canView) &&
      (!permission.canCreate || own?.canCreate) &&
      (!permission.canUpdate || own?.canUpdate) &&
      (!permission.canDelete || own?.canDelete)
    );
  });
}
