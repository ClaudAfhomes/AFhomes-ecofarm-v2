import { randomUUID } from 'node:crypto';
import type { ClientSession, Db, MongoClient } from 'mongodb';
import type { MongoRow } from './customer-activation.mongo.js';
import { CUSTOMER_LOOKUP_GRANT } from './role-reference.mongo.js';
export { CUSTOMER_LOOKUP_GRANT } from './role-reference.mongo.js';


export async function inspectMongoGsdLookupGrant(db: Db, session?: ClientSession) {
  const col = (name: string) => db.collection<MongoRow>(name);
  const roles = await col('roles').find({ slug: 'employee' }, { session }).toArray();
  const modules = await col('modules')
    .find({ key: CUSTOMER_LOOKUP_GRANT.moduleKey }, { session })
    .toArray();
  if (
    roles.length !== 1 ||
    modules.length !== 1 ||
    roles[0].is_active !== true ||
    modules[0].is_active !== true
  )
    throw new Error('One active GSD role and Customer Lookup module are required');
  const role = roles[0],
    module = modules[0];
  const grants = await col('role_permissions')
    .find({ role_id: role._id, module_id: module._id }, { session })
    .toArray();
  if (grants.length > 1) throw new Error('Duplicate lookup grants require review');
  return { role, module, grant: grants[0] ?? null };
}

/** Explicit operator action; add a missing GSD grant only, never override a saved denial. */
export async function installMongoGsdLookupGrant(db: Db, client: MongoClient, actorId: string) {
  const col = (name: string) => db.collection<MongoRow>(name),
    session = client.startSession();
  try {
    return await session.withTransaction(
      async () => {
        await db.collection<{_id:string;seq:number}>('counters').updateOne(
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
        const ownerRole =
          assignment &&
          (await col('roles').findOne(
            { _id: String(assignment.role_id), slug: 'super_admin', is_active: true },
            { session },
          ));
        if (!owner || !staff || !ownerRole)
          throw new Error('Existing active bootstrap Super Admin required');
        const plan = await inspectMongoGsdLookupGrant(db, session);
        if (plan.grant) return { added: false, preservedExistingGrant: true };
        const grant = {
          _id: randomUUID(),
          role_id: plan.role._id,
          module_id: plan.module._id,
          can_view: true,
          can_create: false,
          can_update: false,
          can_delete: false,
        };
        await col('role_permissions').insertOne(grant, { session });
        await col('audit_events').insertOne(
          {
            _id: randomUUID(),
            actor_id: actorId,
            action: 'GSD_CUSTOMER_LOOKUP_GRANTED',
            entity_type: 'role',
            entity_id: plan.role._id,
            after_data: {
              moduleKey: CUSTOMER_LOOKUP_GRANT.moduleKey,
              canView: true,
              canCreate: false,
              canUpdate: false,
              canDelete: false,
            },
            reason:
              'Restore source migration 20261131000003 read-only GSD Customer Lookup grant omitted from MongoDB core setup',
            created_at: new Date().toISOString(),
          },
          { session },
        );
        return { added: true, preservedExistingGrant: false };
      },
      { timeoutMS: 45000 },
    );
  } finally {
    await session.endSession();
  }
}
