import type { Db } from 'mongodb';
import {
  afHomesSessionSchema,
  type AfHomesAction,
  type AfHomesModuleKey,
  type AfHomesPermission,
} from '@afhomes/contracts';
import { toErrorEnvelope } from './envelope.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';
import type { createMongoSessionVerifier } from './auth-verify.mongo.js';
import { actionAllowed } from './afhomes-permissions.js';
export { actionAllowed } from './afhomes-permissions.js';

/** Same per-request effective permissions as source, with UUID-string references. */
export function createMongoStaffAccess(
  db: Db,
  sessions: ReturnType<typeof createMongoSessionVerifier>,
  _env: NodeJS.ProcessEnv,
) {
  const denied = (code: string, message: string, status: number) => ({
    error: toErrorEnvelope(code, message, status),
  });
  const col = (name: string) => db.collection<MongoRow>(name);
  async function resolve(req: VercelRequest) {
    try {
      const identity = await sessions.read(req);
      if (!identity) return denied('UNAUTHORIZED', 'Invalid session', 401);
      const userId = identity.user.id;
      const staff = await col('staff_users').findOne({ _id: userId });
      if (!staff || staff.status !== 'active')
        return denied('FORBIDDEN', 'Active staff access required', 403);
      const assignment = await col('staff_role_assignments').findOne({ staff_id: userId });
      if (!assignment || typeof assignment.role_id !== 'string')
        return denied('FORBIDDEN', 'Staff role assignment required', 403);
      const role = await col('roles').findOne({ _id: assignment.role_id, is_active: true });
      if (!role) return denied('FORBIDDEN', 'Assigned role is inactive', 403);
      const [modules, grants, restrictions] = await Promise.all([
        col('modules').find({ is_active: true }).toArray(),
        col('role_permissions').find({ role_id: role._id }).toArray(),
        col('staff_permission_restrictions').find({ staff_id: userId }).toArray(),
      ]);
      const permissions: AfHomesPermission[] = modules.map((module) => {
        const grant = grants.find((row) => row.module_id === module._id),
          deny = restrictions.find((row) => row.module_id === module._id);
        const all = role.slug === 'super_admin';
        return {
          moduleKey: module.key as AfHomesModuleKey,
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
      });
      const view = afHomesSessionSchema.parse({
        id: userId,
        email: staff.email,
        fullName: staff.full_name,
        status: staff.status,
        roleId: role._id,
        roleSlug: role.slug,
        roleName: role.name,
        mustChangePassword: staff.must_change_password === true,
        permissions,
        mfaRequired: false,
        testPurgeEnabled: false,
      });
      return { userId, ...view };
    } catch {
      return denied('INTERNAL', 'Staff verification unavailable', 503);
    }
  }
  return {
    resolve,
    async authorize(req: VercelRequest, module: AfHomesModuleKey, action: AfHomesAction = 'view') {
      const principal = await resolve(req);
      if ('error' in principal) return principal;
      if (principal.mustChangePassword)
        return denied(
          'FORBIDDEN',
          'Set a new password to continue. The rest of the admin panel unlocks once it is changed.',
          403,
        );
      if (
        !actionAllowed(
          principal.permissions.find((permission) => permission.moduleKey === module),
          action,
        )
      )
        return denied('FORBIDDEN', 'Insufficient permission', 403);
      return principal;
    },
  };
}
