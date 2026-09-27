import type { AfHomesAction, AfHomesModuleKey, AfHomesPermission } from '@jad/contracts';

import { verifySessionToken } from './auth-verify.js';
import { toErrorEnvelope } from './envelope.js';
import type { VercelRequest } from './http.js';
import { anonClient, serviceClient } from './rest.js';
import { extractBearerToken } from './token.js';

// Supabase's fluent query type is intentionally kept behind this server-only adapter.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export type AfHomesPrincipal = {
  userId: string;
  email: string;
  fullName: string;
  status: string;
  roleId: string;
  roleSlug: string;
  roleName: string;
  permissions: AfHomesPermission[];
};

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

export async function resolveAfHomesPrincipal(
  req: VercelRequest,
): Promise<AfHomesPrincipal | { error: ReturnType<typeof toErrorEnvelope> }> {
  const token = extractBearerToken(req);
  if (!token) return { error: toErrorEnvelope('UNAUTHORIZED', 'Missing authentication', 401) };
  const anon = anonClient();
  const svc = serviceClient() as Db;
  if (!anon || !svc)
    return {
      error: toErrorEnvelope('INTERNAL', 'Supabase server configuration is incomplete', 500),
    };
  const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
  const user = authData?.user;
  if (authError || !user?.id)
    return { error: toErrorEnvelope('UNAUTHORIZED', 'Invalid session', 401) };

  const { data: staff, error: staffError } = await svc
    .from('staff_users')
    .select('id,email,full_name,status')
    .eq('id', user.id)
    .maybeSingle();
  if (staffError || !staff)
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff access required', 403) };
  let standing = staff.status as string;
  if (standing === 'invited' && user.email_confirmed_at) {
    const activatedAt = new Date().toISOString();
    const { error: activationError } = await svc
      .from('staff_users')
      .update({ status: 'active', activated_at: activatedAt, updated_at: activatedAt })
      .eq('id', user.id)
      .eq('status', 'invited');
    if (!activationError) {
      await svc
        .from('staff_invitations')
        .update({ status: 'accepted', accepted_at: activatedAt })
        .eq('auth_user_id', user.id)
        .eq('status', 'pending');
      standing = 'active';
    }
  }
  if (standing !== 'active')
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff account is not active', 403) };
  const { data: assignment } = await svc
    .from('staff_role_assignments')
    .select('role_id')
    .eq('staff_id', user.id)
    .maybeSingle();
  if (!assignment?.role_id)
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff role assignment required', 403) };
  const { data: role } = await svc
    .from('roles')
    .select('id,slug,name,is_active')
    .eq('id', assignment.role_id)
    .maybeSingle();
  if (!role?.is_active)
    return { error: toErrorEnvelope('FORBIDDEN', 'Assigned role is inactive', 403) };

  const [{ data: modules }, { data: roleRows }, { data: restrictions }] = await Promise.all([
    svc.from('modules').select('id,key').eq('is_active', true),
    svc
      .from('role_permissions')
      .select('module_id,can_view,can_create,can_update,can_delete')
      .eq('role_id', role.id),
    svc
      .from('staff_permission_restrictions')
      .select('module_id,deny_view,deny_create,deny_update,deny_delete')
      .eq('staff_id', user.id),
  ]);
  const moduleById = new Map(
    (modules ?? []).map((module: { id: string; key: AfHomesModuleKey }) => [module.id, module.key]),
  );
  const roleByModule = new Map(
    (roleRows ?? []).map((row: { module_id: string }) => [row.module_id, row]),
  );
  const denyByModule = new Map(
    (restrictions ?? []).map((row: { module_id: string }) => [row.module_id, row]),
  );
  const permissions: AfHomesPermission[] = (modules ?? []).map(
    (module: { id: string; key: AfHomesModuleKey }) => {
      const grant = roleByModule.get(module.id) as Record<string, boolean> | undefined;
      const deny = denyByModule.get(module.id) as Record<string, boolean> | undefined;
      const all = role.slug === 'super_admin';
      return {
        moduleKey: moduleById.get(module.id)!,
        canView: (all || grant?.can_view === true) && deny?.deny_view !== true,
        canCreate:
          (all || grant?.can_create === true) &&
          deny?.deny_view !== true &&
          deny?.deny_create !== true,
        canUpdate:
          (all || grant?.can_update === true) &&
          deny?.deny_view !== true &&
          deny?.deny_update !== true,
        canDelete:
          (all || grant?.can_delete === true) &&
          deny?.deny_view !== true &&
          deny?.deny_delete !== true,
      };
    },
  );
  return {
    userId: user.id,
    email: staff.email,
    fullName: staff.full_name,
    status: standing,
    roleId: role.id,
    roleSlug: role.slug,
    roleName: role.name,
    permissions,
  };
}

export async function authorizeAfHomes(
  req: VercelRequest,
  moduleKey: AfHomesModuleKey,
  action: AfHomesAction = 'view',
) {
  const principal = await resolveAfHomesPrincipal(req);
  if ('error' in principal) return principal;
  if (
    !actionAllowed(
      principal.permissions.find((permission) => permission.moduleKey === moduleKey),
      action,
    )
  ) {
    return { error: toErrorEnvelope('FORBIDDEN', 'Insufficient permission', 403) };
  }
  return principal;
}
