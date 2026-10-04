import type { AfHomesAction, AfHomesModuleKey, AfHomesPermission } from '@jad/contracts';

import {
  verifiedAuthenticationMethods,
  verifySessionToken,
  verifiedAssuranceLevel,
} from './auth-verify.js';
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
  mustChangePassword: boolean;
  permissions: AfHomesPermission[];
  mfaRequired?: boolean;
};

export type StaffAccountSetupCandidate = {
  userId: string;
  email: string;
  fullName: string;
};

async function pendingInvitation(db: Db, userId: string) {
  const { data, error } = await db
    .from('staff_invitations')
    .select('id,status,expires_at')
    .eq('auth_user_id', userId)
    .eq('status', 'pending')
    .maybeSingle();
  if (error) throw error;
  return data as { id: string; status: string; expires_at?: string | null } | null;
}

function invitationIsExpired(invitation: { expires_at?: string | null } | null): boolean {
  if (!invitation?.expires_at) return false;
  const expiresAt = Date.parse(invitation.expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

async function assignedRole(db: Db, userId: string) {
  const { data: assignment } = await db
    .from('staff_role_assignments')
    .select('role_id')
    .eq('staff_id', userId)
    .maybeSingle();
  if (!assignment?.role_id) return { role: null, reason: 'assignment' as const };
  const { data: role } = await db
    .from('roles')
    .select('id,slug,name,is_active')
    .eq('id', assignment.role_id)
    .maybeSingle();
  return role?.is_active ? { role, reason: null } : { role: null, reason: 'role' as const };
}

/**
 * Validate the invitation landing session without granting staff access. Only
 * a verified `invite` session for its own still-invited staff profile passes.
 */
export async function resolveStaffAccountSetup(
  req: VercelRequest,
): Promise<StaffAccountSetupCandidate | { error: ReturnType<typeof toErrorEnvelope> }> {
  const token = extractBearerToken(req);
  if (!token) return { error: toErrorEnvelope('UNAUTHORIZED', 'Missing authentication', 401) };
  const anon = anonClient();
  const db = serviceClient() as Db;
  if (!anon || !db)
    return {
      error: toErrorEnvelope('INTERNAL', 'Supabase server configuration is incomplete', 500),
    };
  const { data: authData, error: authError } = await verifySessionToken(anon.auth, token);
  const user = authData?.user;
  if (authError || !user?.id || !user.email_confirmed_at)
    return { error: toErrorEnvelope('UNAUTHORIZED', 'Invalid invitation session', 401) };
  const methods = await verifiedAuthenticationMethods(anon.auth, token);
  if (!methods.includes('invite'))
    return { error: toErrorEnvelope('FORBIDDEN', 'Invitation session required', 403) };

  const { data: staff, error: staffError } = await db
    .from('staff_users')
    .select('id,email,full_name,status')
    .eq('id', user.id)
    .maybeSingle();
  if (staffError || !staff || staff.status !== 'invited')
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff invitation is not active', 403) };
  const roleResolution = await assignedRole(db, user.id);
  const role = roleResolution.role;
  if (!role) return { error: toErrorEnvelope('FORBIDDEN', 'Staff role assignment required', 403) };
  const invitation = await pendingInvitation(db, user.id);
  if ((!invitation && role.slug !== 'super_admin') || invitationIsExpired(invitation))
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff invitation is invalid or expired', 403) };
  return { userId: user.id, email: staff.email, fullName: staff.full_name };
}

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
    .select('id,email,full_name,status,must_change_password')
    .eq('id', user.id)
    .maybeSingle();
  if (staffError || !staff)
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff access required', 403) };
  const roleResolution = await assignedRole(svc, user.id);
  const role = roleResolution.role;
  if (!role)
    return {
      error: toErrorEnvelope(
        'FORBIDDEN',
        roleResolution.reason === 'assignment'
          ? 'Staff role assignment required'
          : 'Assigned role is inactive',
        403,
      ),
    };

  let standing = staff.status as string;
  if (standing === 'invited') {
    const methods = await verifiedAuthenticationMethods(anon.auth, token);
    if (!user.email_confirmed_at || !methods.includes('password'))
      return { error: toErrorEnvelope('FORBIDDEN', 'Staff account setup required', 403) };
    const invitation = await pendingInvitation(svc, user.id);
    if ((!invitation && role.slug !== 'super_admin') || invitationIsExpired(invitation))
      return { error: toErrorEnvelope('FORBIDDEN', 'Staff invitation is invalid or expired', 403) };

    const activatedAt = new Date().toISOString();
    const { data: activated, error: activationError } = await svc
      .from('staff_users')
      .update({ status: 'active', activated_at: activatedAt, updated_at: activatedAt })
      .eq('id', user.id)
      .eq('status', 'invited')
      .select('id')
      .maybeSingle();
    if (activationError)
      return { error: toErrorEnvelope('INTERNAL', 'Unable to activate staff account', 500) };

    if (!activated) {
      const { data: current } = await svc
        .from('staff_users')
        .select('status')
        .eq('id', user.id)
        .maybeSingle();
      if (current?.status !== 'active')
        return { error: toErrorEnvelope('INTERNAL', 'Unable to activate staff account', 500) };
    }

    if (activated) {
      if (invitation) {
        const { error: invitationError } = await svc
          .from('staff_invitations')
          .update({ status: 'accepted', accepted_at: activatedAt })
          .eq('id', invitation.id)
          .eq('status', 'pending');
        if (invitationError) {
          await svc
            .from('staff_users')
            .update({ status: 'invited', activated_at: null, updated_at: activatedAt })
            .eq('id', user.id)
            .eq('status', 'active');
          return { error: toErrorEnvelope('INTERNAL', 'Unable to activate staff account', 500) };
        }
      }
      const { error: auditError } = await svc.from('audit_events').insert({
        actor_id: user.id,
        action: 'STAFF_ACCOUNT_ACTIVATED',
        entity_type: 'staff_user',
        entity_id: user.id,
        after_data: { authenticationMethod: 'password' },
      });
      if (auditError) {
        if (invitation) {
          await svc
            .from('staff_invitations')
            .update({ status: 'pending', accepted_at: null })
            .eq('id', invitation.id)
            .eq('status', 'accepted');
        }
        await svc
          .from('staff_users')
          .update({ status: 'invited', activated_at: null, updated_at: activatedAt })
          .eq('id', user.id)
          .eq('status', 'active');
        return { error: toErrorEnvelope('INTERNAL', 'Unable to activate staff account', 500) };
      }
    }
    standing = 'active';
  }
  if (standing !== 'active')
    return { error: toErrorEnvelope('FORBIDDEN', 'Staff account is not active', 403) };

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
    mustChangePassword: staff.must_change_password === true,
    permissions,
    mfaRequired:
      process.env.AFHOMES_REQUIRE_ADMIN_MFA === 'true' &&
      ['admin', 'super_admin'].includes(role.slug) &&
      (await verifiedAssuranceLevel(anon.auth, token, user.id)) !== 'aal2',
  };
}

export async function authorizeAfHomes(
  req: VercelRequest,
  moduleKey: AfHomesModuleKey,
  action: AfHomesAction = 'view',
) {
  const principal = await resolveAfHomesPrincipal(req);
  if ('error' in principal) return principal;
  if (principal.mfaRequired)
    return {
      error: toErrorEnvelope('FORBIDDEN', 'Complete authenticator verification to continue.', 403),
    };
  // JAD parity: an account still running on its administrator-set temporary
  // password may only use the self-service session endpoints (GET/PATCH
  // session, POST session/password), which resolve the principal directly
  // and never pass through here. Every module-guarded endpoint refuses until
  // the forced password change completes.
  if (principal.mustChangePassword) {
    return {
      error: toErrorEnvelope(
        'FORBIDDEN',
        'Set a new password to continue. The rest of the admin panel unlocks once it is changed.',
        403,
      ),
    };
  }
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
