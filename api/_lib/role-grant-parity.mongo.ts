import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import { DEFAULT_ROLE_BASELINE } from '@afhomes/contracts';
import type { MongoRow } from './customer-activation.mongo.js';
import { mongoRoleReferenceGrants, MONGO_ROLE_GRANT_SOURCES } from './role-reference.mongo.js';

export async function inspectMongoRoleGrantParity(db: Db, session?: ClientSession) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const [roles, modules, grants] = await Promise.all([
    col('roles').find({}, { session }).toArray(),
    col('modules').find({}, { session }).toArray(),
    col('role_permissions').find({}, { session }).toArray(),
  ]);
  const missing: {
    role: string;
    roleId: string;
    moduleKey: string;
    moduleId: string;
    can_view: boolean;
    can_create: boolean;
    can_update: boolean;
    can_delete: boolean;
    source: string;
  }[] = [];
  const preserved: {
    role: string;
    moduleKey: string;
    reason: string;
    current?: Record<string, boolean>;
    expected?: Record<string, boolean>;
  }[] = [];
  for (const slug of Object.keys(DEFAULT_ROLE_BASELINE)) {
    const matches = roles.filter((role) => role.slug === slug);
    if (matches.length !== 1) throw new Error('Canonical roles must be unique and present');
    const role = matches[0];
    if (role.is_active !== true) {
      preserved.push({ role: slug, moduleKey: '*', reason: 'inactive-role' });
      continue;
    }
    for (const expected of mongoRoleReferenceGrants(slug)) {
      const modulesForKey = modules.filter((module) => module.key === expected.moduleKey);
      if (modulesForKey.length !== 1)
        throw new Error('Canonical modules must be unique and present');
      const module = modulesForKey[0];
      if (module.is_active !== true) {
        preserved.push({ role: slug, moduleKey: expected.moduleKey, reason: 'inactive-module' });
        continue;
      }
      const existing = grants.filter(
        (grant) => grant.role_id === role._id && grant.module_id === module._id,
      );
      if (existing.length > 1) throw new Error('Duplicate role grants require review');
      const values = {
        can_view: expected.canView,
        can_create: expected.canCreate,
        can_update: expected.canUpdate,
        can_delete: expected.canDelete,
      };
      if (existing.length) {
        if (Object.entries(values).some(([key, value]) => existing[0][key] !== value))
          preserved.push({
            role: slug,
            moduleKey: expected.moduleKey,
            reason: 'saved-grant-differs',
            current: Object.fromEntries(
              Object.keys(values).map((key) => [key, existing[0][key] === true]),
            ),
            expected: values,
          });
        continue;
      }
      missing.push({
        role: slug,
        roleId: role._id,
        moduleKey: expected.moduleKey,
        moduleId: module._id,
        ...values,
        source:
          MONGO_ROLE_GRANT_SOURCES[expected.moduleKey] ??
          '20260930000001_afhomes_role_permission_baseline.sql',
      });
    }
  }
  missing.sort((a, b) => `${a.role}/${a.moduleKey}`.localeCompare(`${b.role}/${b.moduleKey}`));
  preserved.sort((a, b) => `${a.role}/${a.moduleKey}`.localeCompare(`${b.role}/${b.moduleKey}`));
  return {
    database: db.databaseName,
    missing,
    preserved,
    digest: createHash('sha256').update(JSON.stringify({ missing, preserved })).digest('hex'),
  };
}

/** Digest-bound operator action: insert absent source grants, preserve every saved row and denial. */
export async function installMongoRoleGrantParity(
  db: Db,
  client: MongoClient,
  actorId: string,
  digest: string,
) {
  if (db.databaseName !== 'afhomes_dev' || db.client !== client)
    throw new Error('Matching afhomes_dev client required');
  const col = (name: string) => db.collection<MongoRow>(name),
    session = client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        await db
          .collection<{ _id: string; seq: number }>('counters')
          .updateOne(
            { _id: 'organization-write' },
            { $inc: { seq: 1 } },
            { upsert: true, session },
          );
        const owner = await col('admin_bootstrap').findOne(
          { _id: 'initial-super-admin', user_id: actorId },
          { session },
        );
        const staff = await col('staff_users').findOne(
          { _id: actorId, status: 'active' },
          { session },
        );
        const assignment = await col('staff_role_assignments').findOne(
          { staff_id: actorId },
          { session },
        );
        const role =
          assignment &&
          (await col('roles').findOne(
            { _id: String(assignment.role_id), slug: 'super_admin', is_active: true },
            { session },
          ));
        if (!owner || !staff || !role)
          throw new Error('Existing active bootstrap Super Admin required');
        const plan = await inspectMongoRoleGrantParity(db, session);
        if (plan.digest !== digest) throw new Error('Role grant plan changed; review a fresh plan');
        for (const row of plan.missing) {
          await col('role_permissions').insertOne(
            {
              _id: randomUUID(),
              role_id: row.roleId,
              module_id: row.moduleId,
              can_view: row.can_view,
              can_create: row.can_create,
              can_update: row.can_update,
              can_delete: row.can_delete,
            },
            { session },
          );
        }
        if (plan.missing.length)
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: actorId,
              action: 'ROLE_REFERENCE_GRANTS_ADDED',
              entity_type: 'mongo_conversion_setup',
              entity_id: 'role-grant-parity',
              after_data: {
                planDigest: digest,
                grants: plan.missing.map(
                  ({ role, moduleKey, source, can_view, can_create, can_update, can_delete }) => ({
                    role,
                    moduleKey,
                    source,
                    can_view,
                    can_create,
                    can_update,
                    can_delete,
                  }),
                ),
              },
              created_at: new Date().toISOString(),
            },
            { session },
          );
        return { added: plan.missing.length, preserved: plan.preserved.length };
      },
      { timeoutMS: 45000 },
    );
  } finally {
    await session.endSession();
  }
}
