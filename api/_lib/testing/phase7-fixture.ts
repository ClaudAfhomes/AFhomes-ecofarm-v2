import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { MODULE_CATALOG, DEFAULT_ROLE_BASELINE } from '@afhomes/contracts';
import { createAfHomesAdminAuth } from '../auth.js';
import { seedPhase6Fixture } from './phase6-fixture.js';
import type { MongoRow } from '../customer-activation.mongo.js';

/** Account-creation browser fixture: new disposable replica only; never an existing administrator. */
export async function seedPhase7Fixture(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv,
  password: string,
) {
  const base = await seedPhase6Fixture(db, client, env, password),
    col = (name: string) => db.collection<MongoRow>(name);
  // A complete synthetic scheme prevents the browser guide from subtracting a reservation from a missing installment total.
  await col('card_plans').updateOne({ _id: base.plan }, { $set: {
    installment_price: '125000.00', reservation_fee: '10000.00', spot_cash_days: 7,
    standard_installment_months: 4, validity_years: 7, move_a_enabled: true,
    move_b1_enabled: false, move_b2_enabled: false,
  } });
  for (const module of MODULE_CATALOG)
    if (!(await col('modules').findOne({ key: module.key })))
      await col('modules').insertOne({ _id: randomUUID(), key: module.key, is_active: true });
  if (!(await col('departments').findOne({ code: 'SALES' })))
    await col('departments').insertOne({
      _id: randomUUID(),
      code: 'SALES',
      name: 'Sales',
      is_active: true,
      created_at: new Date().toISOString(),
    });
  const assignment = await col('staff_role_assignments').findOne({ staff_id: base.staff.id });
  await col('role_permissions').deleteMany({ role_id: assignment!.role_id });
  for (const grant of DEFAULT_ROLE_BASELINE.sales_manager) {
    const module = await col('modules').findOne({ key: grant.moduleKey });
    await col('role_permissions').insertOne({
      _id: randomUUID(),
      role_id: assignment!.role_id,
      module_id: module!._id,
      can_view: grant.canView,
      can_create: grant.canCreate,
      can_update: grant.canUpdate,
      can_delete: grant.canDelete,
    });
  }
  const identity = await createAfHomesAdminAuth(db, client, env).api.createUser({
    body: {
      email: 'phase7-admin@example.invalid',
      name: 'Synthetic Account Admin',
      password,
      data: { emailVerified: true },
    },
  });
  const roleId = randomUUID();
  await col('roles').insertOne({
    _id: roleId,
    slug: 'super_admin',
    name: 'Super Admin',
    is_active: true,
    is_system: true,
  });
  await col('staff_users').insertOne({
    _id: identity.user.id,
    email: identity.user.email,
    full_name: 'SYNTHETIC ACCOUNT ADMIN',
    status: 'active',
    must_change_password: true,
    created_at: new Date().toISOString(),
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: identity.user.id,
    role_id: roleId,
  });
  await col('mfa_policy').updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  return { ...base, admin: { id: identity.user.id, email: identity.user.email, password } };
}
