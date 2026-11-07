import { createAfHomesAdminAuth } from './auth.js';
import type { Db, MongoClient } from 'mongodb';
import { createAfHomesStaffSchema } from '@afhomes/contracts';
import { randomUUID } from 'node:crypto';
import { ObjectId } from 'mongodb';

const createStaffInput = createAfHomesStaffSchema.pick({
  email: true,
  fullName: true,
  departmentId: true,
  roleId: true,
  temporaryPassword: true,
}).strict();

/**
 * Server capability only. The issuer must be authorized before calling; no HTTP handler is exposed.
 * Creates a staff user with an administrator-set temporary password and forces password change on first login.
 * Uses Better Auth's admin plugin for identity creation.
 */
export function createAdminStaffProvisioner(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv = process.env,
) {
  const internal = createAfHomesAdminAuth(db, client, env);

  return async (input: unknown) => {
    const { email, fullName, departmentId, roleId, temporaryPassword } = createStaffInput.parse(input);

    // Create user via Better Auth admin API with temporary password
    // emailVerified: true skips email verification (admin-created)
    // The user must change password on first login (enforced by must_change_password flag in staff_users)
    const { user } = await internal.api.createUser({
      body: {
        email: email.toLowerCase(),
        name: fullName,
        password: temporaryPassword,
        data: { emailVerified: true },
      },
    });

    // Return the created user identity
    return {
      id: user.id,
      email: user.email,
      name: user.name,
    };
  };
}

/**
 * Create a staff user in the AFHomes business tables after Better Auth identity is created.
 * This separates identity creation (Better Auth) from business data creation (MongoDB).
 */
export async function createStaffBusinessRecord(
  db: Db,
  userId: string,
  data: {
    email: string;
    fullName: string;
    departmentId: string | null;
    roleId: string;
    assignedBy: string;
  },
) {
  const now = new Date().toISOString();

  // Insert into staff_users
  const staffResult = await db.collection('staff_users').insertOne({
    _id: new ObjectId(userId),
    email: data.email,
    full_name: data.fullName,
    department_id: data.departmentId ? new ObjectId(data.departmentId) : null,
    status: 'active',
    must_change_password: true,
    activated_at: now,
    invited_at: null,
    created_at: now,
    updated_at: now,
  });
  if (!staffResult.acknowledged) throw new Error('staff_users insert failed');

  // Insert into staff_role_assignments
  const assignmentResult = await db.collection('staff_role_assignments').insertOne({
    _id: new ObjectId(),
    staff_id: new ObjectId(userId),
    role_id: new ObjectId(data.roleId),
    assigned_by: new ObjectId(data.assignedBy),
    created_at: now,
  });
  if (!assignmentResult.acknowledged) throw new Error('staff_role_assignments insert failed');

  // Audit log
  await db.collection('audit_events').insertOne({
    _id: new ObjectId(),
    actor_id: new ObjectId(data.assignedBy),
    action: 'STAFF_CREATED',
    entity_type: 'staff_user',
    entity_id: new ObjectId(userId),
    before_data: null,
    after_data: {
      email: data.email,
      fullName: data.fullName,
      departmentId: data.departmentId,
      roleId: data.roleId,
    },
    created_at: new Date(),
  });
}

// Export the old function name for backward compatibility with tests
export function createInvitedIdentityProvisioner(
  options: ReturnType<typeof import('./auth.js').getAuthOptions> & { database: ReturnType<typeof import('@better-auth/mongo-adapter').mongodbAdapter> },
) {
  const internal = betterAuth({ ...options, plugins: [...options.plugins, admin()] });
  return async (input: unknown) => {
    const { email, fullName } = inviteAfHomesStaffSchema.pick({ email: true, fullName: true }).strict().parse(input);
    const { user } = await internal.api.createUser({ body: { email, name: fullName } });
    return { id: user.id, email: user.email };
  };
}

import { betterAuth } from 'better-auth';
import { admin } from 'better-auth/plugins';
import { inviteAfHomesStaffSchema } from '@afhomes/contracts';