import { randomBytes, randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Db, MongoClient } from 'mongodb';
import { AF_ID_ALPHABET, MODULE_CATALOG, createAfHomesStaffSchema } from '@afhomes/contracts';
import type { MongoRow } from './customer-activation.mongo.js';

export const mongoAdminBootstrapInput = createAfHomesStaffSchema
  .pick({ email: true, fullName: true, temporaryPassword: true })
  .strict();
export class AdminBootstrapError extends Error {}
const markerId = 'initial-super-admin';

/** Operator-only, first MongoDB owner. Never imports Supabase or mounts an auth admin handler. */
export async function inspectMongoAdminBootstrap(db: Db, email: string) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const normalized = mongoAdminBootstrapInput.shape.email.parse(email).toLowerCase();
  const marker = await col('admin_bootstrap').findOne({ _id: markerId });
  if (marker) {
    const user = await col('auth_users').findOne({
      _id: String(marker.user_id),
      email: normalized,
    });
    const staff = await col('staff_users').findOne({
      _id: String(marker.user_id),
      email: normalized,
      status: 'active',
    });
    const assignment = await col('staff_role_assignments').findOne({
      staff_id: String(marker.user_id),
    });
    const role =
      assignment &&
      (await col('roles').findOne({
        _id: String(assignment.role_id),
        slug: 'super_admin',
        is_active: true,
      }));
    const account = await col('auth_accounts').findOne({
      userId: String(marker.user_id),
      providerId: 'credential',
    });
    if (marker.email !== normalized || !user || !staff || !role || !account?.password)
      throw new AdminBootstrapError(
        'Existing bootstrap differs or is incomplete. Refusing to reset or repair an account.',
      );
    return { status: 'already_exists' as const, userId: user._id };
  }
  if (
    (await col('staff_users').findOne({})) ||
    (await col('auth_users').findOne({
      email: { $regex: `^${normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
    }))
  )
    throw new AdminBootstrapError(
      'Existing staff or identity found. Use authorized staff management; bootstrap never adopts or resets accounts.',
    );
  return { status: 'ready' as const };
}

/** These are only bootstrap namespace indexes, not commercial schema initialization. */
async function setupBootstrapIndexes(db: Db) {
  for (const [table, key] of [
    ['auth_users', 'email'],
    ['staff_users', 'email'],
    ['roles', 'slug'],
    ['modules', 'key'],
    ['staff_role_assignments', 'staff_id'],
  ])
    await db.collection(table!).createIndex({ [key!]: 1 }, { unique: true });
  await db
    .collection('auth_accounts')
    .createIndex({ providerId: 1, accountId: 1 }, { unique: true });
  await db.collection('mfa_policy').createIndex({ key: 1 }, { unique: true });
  // Create namespaces before the transaction; collections contain no seed business data.
  for (const name of ['admin_bootstrap', 'audit_events', 'mfa_policy', 'counters']) {
    if (!(await db.listCollections({ name }, { nameOnly: true }).hasNext())) {
      try {
        await db.createCollection(name);
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 48))
          throw error;
      }
    }
  }
}

export async function bootstrapMongoAdmin(db: Db, client: MongoClient, input: unknown) {
  const parsed = mongoAdminBootstrapInput.parse(input),
    email = parsed.email.toLowerCase();
  const prior = await inspectMongoAdminBootstrap(db, email);
  if (prior.status === 'already_exists') return prior;
  await setupBootstrapIndexes(db);
  const password = await hashPassword(parsed.temporaryPassword);
  const col = (name: string) => db.collection<MongoRow>(name);
  const session = client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { session, upsert: true },
          );
        const marker = await col('admin_bootstrap').findOne({ _id: markerId }, { session });
        if (marker) {
          if (marker.email !== email)
            throw new AdminBootstrapError(
              'Another bootstrap already completed. No account was changed.',
            );
          return { status: 'already_exists' as const, userId: String(marker.user_id) };
        }
        if (
          (await col('staff_users').findOne({}, { session })) ||
          (await col('auth_users').findOne(
            {
              email: { $regex: `^${email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' },
            },
            { session },
          ))
        )
          throw new AdminBootstrapError(
            'Existing staff or identity found. No account was changed.',
          );
        const now = new Date(),
          timestamp = now.toISOString(),
          userId = randomUUID();
        const modules = await col('modules')
          .find({ key: { $in: MODULE_CATALOG.map((row) => row.key) } }, { session })
          .toArray();
        if (modules.some((row) => typeof row._id !== 'string'))
          throw new AdminBootstrapError(
            'Existing module IDs are incompatible. No account was changed.',
          );
        const missing = MODULE_CATALOG.filter(
          (descriptor) => !modules.some((row) => row.key === descriptor.key),
        );
        // Driver 7.7 insertMany inherits timeoutMS twice inside CSOT transactions.
        for (const descriptor of missing)
          await col('modules').insertOne(
            {
              _id: randomUUID(),
              key: descriptor.key,
              label: descriptor.label,
              group: descriptor.group,
              sort_order: descriptor.sortOrder,
              is_active: true,
            },
            { session },
          );
        let role = await col('roles').findOne({ slug: 'super_admin' }, { session });
        if (role && (typeof role._id !== 'string' || role.is_active !== true))
          throw new AdminBootstrapError(
            'Existing Super Admin role requires review. No account was changed.',
          );
        if (!role) {
          role = {
            _id: randomUUID(),
            slug: 'super_admin',
            name: 'Super Admin',
            is_active: true,
            is_system: true,
            department_id: null,
            created_at: timestamp,
            updated_at: timestamp,
          };
          await col('roles').insertOne(role, { session });
        }
        await col('mfa_policy').updateOne(
          { key: 'admin_mfa_required' },
          { $setOnInsert: { _id: randomUUID(), key: 'admin_mfa_required', value: true } },
          { session, upsert: true },
        );
        if (
          (await col('mfa_policy').findOne({ key: 'admin_mfa_required' }, { session }))?.value !==
          true
        )
          throw new AdminBootstrapError(
            'Existing privileged MFA policy requires review. No account was created.',
          );
        const employeeNumber = `AF-EMP-${Array.from(randomBytes(5), (byte) => AF_ID_ALPHABET[byte & 31]).join('')}`;
        await col('auth_users').insertOne(
          {
            _id: userId,
            email,
            emailVerified: true,
            name: parsed.fullName,
            createdAt: now,
            updatedAt: now,
          },
          { session },
        );
        await col('auth_accounts').insertOne(
          {
            _id: randomUUID(),
            accountId: userId,
            providerId: 'credential',
            userId,
            password,
            createdAt: now,
            updatedAt: now,
          },
          { session },
        );
        await col('staff_users').insertOne(
          {
            _id: userId,
            email,
            full_name: parsed.fullName,
            employee_number: employeeNumber,
            department_id: null,
            status: 'active',
            must_change_password: true,
            activated_at: timestamp,
            invited_at: null,
            created_at: timestamp,
            updated_at: timestamp,
          },
          { session },
        );
        await col('staff_role_assignments').insertOne(
          {
            _id: randomUUID(),
            staff_id: userId,
            role_id: role._id,
            assigned_by: userId,
            assigned_at: timestamp,
          },
          { session },
        );
        await col('admin_bootstrap').insertOne(
          { _id: markerId, user_id: userId, email, role_id: role._id, created_at: timestamp },
          { session },
        );
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: userId,
            action: 'SUPER_ADMIN_BOOTSTRAPPED',
            entity_type: 'staff_user',
            entity_id: userId,
            before_data: null,
            after_data: {
              roleSlug: 'super_admin',
              mustChangePassword: true,
              onboarding: 'temporary_password',
            },
            created_at: timestamp,
          },
          { session },
        );
        return { status: 'created' as const, userId };
      },
      { timeoutMS: 60_000 },
    );
  } finally {
    await session.endSession();
  }
}
