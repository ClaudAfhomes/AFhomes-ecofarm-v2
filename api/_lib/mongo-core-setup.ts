import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { MODULE_CATALOG } from '@afhomes/contracts';
import { setupMongoPhase5 } from './mongo-runtime.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { mongoRoleReferenceGrants } from './role-reference.mongo.js';

export const MONGO_CORE_SETUP_VERSION = 'mongodb-core-2026-10-26-v1';
// Existing AFHomes foundation vocabulary; no people, pricing or business history are seeded.
const departments = {
  EXECUTIVE: 'Executive',
  SALES: 'Sales',
  FINANCE: 'Finance',
  HR: 'Human Resources',
  OPERATIONS: 'Operations',
};
const roles = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  vice_director: 'Vice Director',
  senior_sales_manager: 'Senior Sales Manager',
  sales_manager: 'Sales Manager',
  finance: 'Finance',
  hr: 'HR',
  employee: 'Employee',
  ost: 'OST',
  customer: 'Customer',
};

export async function inspectMongoCoreSetup(db: Db) {
  if (db.databaseName !== 'afhomes_dev') throw new Error('Core setup requires afhomes_dev');
  const col = (name: string) => db.collection<MongoRow>(name);
  const [saved, existingRoles, existingDepartments, existingModules, plans] = await Promise.all([
    col('mongo_conversion_setup').findOne({ _id: 'core' }),
    col('roles')
      .find({ slug: { $in: Object.keys(roles) } })
      .toArray(),
    col('departments')
      .find({ code: { $in: Object.keys(departments) } })
      .toArray(),
    col('modules')
      .find({ key: { $in: MODULE_CATALOG.map((m) => m.key) } })
      .toArray(),
    col('card_plans').countDocuments({ is_active: true }),
  ]);
  return {
    database: db.databaseName,
    version: MONGO_CORE_SETUP_VERSION,
    initialized: saved?.version === MONGO_CORE_SETUP_VERSION && saved?.database === db.databaseName,
    missingRoles: Object.keys(roles).filter(
      (slug) => !existingRoles.some((row) => row.slug === slug),
    ),
    missingDepartments: Object.keys(departments).filter(
      (code) => !existingDepartments.some((row) => row.code === code),
    ),
    missingModules: MODULE_CATALOG.filter(
      (m) => !existingModules.some((row) => row.key === m.key),
    ).map((m) => m.key),
    inactiveRoles: existingRoles
      .filter((row) => row.is_active !== true)
      .map((row) => String(row.slug)),
    inactiveDepartments: existingDepartments
      .filter((row) => row.is_active !== true)
      .map((row) => String(row.code)),
    activePlans: plans,
  };
}

/** Explicit operator action only; never called by normal startup or an application request. */
export async function installMongoCoreSetup(db: Db, client: MongoClient, actorId: string) {
  if (db.databaseName !== 'afhomes_dev' || db.client !== client)
    throw new Error('Core setup requires its matching afhomes_dev client');
  const col = (name: string) => db.collection<MongoRow>(name);
  async function requireOwner() {
    const staff = await col('staff_users').findOne({ _id: actorId, status: 'active' }),
      assignment = await col('staff_role_assignments').findOne({ staff_id: actorId });
    const role =
      assignment &&
      (await col('roles').findOne({
        _id: String(assignment.role_id),
        slug: 'super_admin',
        is_active: true,
      }));
    if (!staff || !role)
      throw new Error(
        'An existing active Super Admin is required. No administrator is created or repaired',
      );
  }
  await requireOwner();
  await setupMongoPhase5(db);
  const session = client.startSession();
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
        await requireOwner();
        const now = new Date().toISOString(),
          added = { roles: [] as string[], departments: [] as string[], modules: [] as string[] };
        for (const [code, name] of Object.entries(departments))
          if (!(await col('departments').findOne({ code }, { session }))) {
            await col('departments').insertOne(
              { _id: randomUUID(), code, name, is_active: true, created_at: now, updated_at: now },
              { session },
            );
            added.departments.push(code);
          }
        for (const descriptor of MODULE_CATALOG)
          if (!(await col('modules').findOne({ key: descriptor.key }, { session }))) {
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
            added.modules.push(descriptor.key);
          }
        for (const [slug, name] of Object.entries(roles))
          if (!(await col('roles').findOne({ slug }, { session }))) {
            const roleId = randomUUID();
            await col('roles').insertOne(
              {
                _id: roleId,
                slug,
                name,
                is_system: true,
                is_active: true,
                department_id: null,
                created_at: now,
                updated_at: now,
              },
              { session },
            );
            for (const grant of mongoRoleReferenceGrants(slug)) {
              const module = await col('modules').findOne({ key: grant.moduleKey }, { session });
              await col('role_permissions').insertOne(
                {
                  _id: randomUUID(),
                  role_id: roleId,
                  module_id: module!._id,
                  can_view: grant.canView,
                  can_create: grant.canCreate,
                  can_update: grant.canUpdate,
                  can_delete: grant.canDelete,
                },
                { session },
              );
            }
            added.roles.push(slug);
          }
        const marker = await col('mongo_conversion_setup').findOne({ _id: 'core' }, { session });
        if (
          marker?.version !== MONGO_CORE_SETUP_VERSION ||
          Object.values(added).some((items) => items.length)
        ) {
          await col('mongo_conversion_setup').updateOne(
            { _id: 'core' },
            {
              $set: {
                version: MONGO_CORE_SETUP_VERSION,
                database: db.databaseName,
                initialized_at: now,
              },
            },
            { upsert: true, session },
          );
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: actorId,
              action: 'MONGODB_CORE_INITIALIZED',
              entity_type: 'mongo_conversion_setup',
              entity_id: 'core',
              after_data: { version: MONGO_CORE_SETUP_VERSION, added },
              created_at: now,
            },
            { session },
          );
        }
        return { version: MONGO_CORE_SETUP_VERSION, added };
      },
      { timeoutMS: 60_000 },
    );
  } finally {
    await session.endSession();
  }
}
