import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import { createAfHomesAdminAuth } from '../auth.js';
import { setupMongoPhase5 } from '../mongo-runtime.js';
import type { MongoRow } from '../customer-activation.mongo.js';

/** Synthetic fixtures ONLY for a newly created createTestReplica() instance. Never bootstrap an existing database. */
export async function seedPhase5Fixture(
  db: Db,
  client: MongoClient,
  env: NodeJS.ProcessEnv,
  browserFixturePassword?: string,
) {
  await setupMongoPhase5(db);
  const col = (name: string) => db.collection<MongoRow>(name);
  if (await col('staff_users').countDocuments())
    throw new Error('Fixture requires an empty, fresh test database');
  const password = browserFixturePassword ?? `Tmp${randomUUID().slice(0, 12)}9`,
    email = 'phase5-staff@example.invalid';
  const internal = createAfHomesAdminAuth(db, client, env);
  const created = await internal.api.createUser({
    body: { email, password, name: 'Synthetic Sales Manager', data: { emailVerified: true } },
  });
  const role = randomUUID();
  await col('staff_users').insertOne({
    _id: created.user.id,
    email,
    full_name: 'SYNTHETIC SALES MANAGER',
    status: 'active',
    must_change_password: true,
  });
  await col('roles').insertOne({
    _id: role,
    slug: 'sales_manager',
    name: 'Sales Manager',
    is_active: true,
  });
  await col('staff_role_assignments').insertOne({
    _id: randomUUID(),
    staff_id: created.user.id,
    role_id: role,
  });
  for (const key of ['sales.customers', 'sales.card_plans', 'dashboard.view']) {
    const moduleId = randomUUID();
    await col('modules').insertOne({ _id: moduleId, key, is_active: true });
    await col('role_permissions').insertOne({
      _id: randomUUID(),
      role_id: role,
      module_id: moduleId,
      can_view: true,
      can_create: true,
      can_update: true,
      can_delete: false,
    });
  }
  await col('mfa_policy').insertOne({ _id: randomUUID(), key: 'admin_mfa_required', value: true });
  const category = randomUUID(),
    plan = randomUUID();
  await col('card_categories').insertOne({
    _id: category,
    name: 'Membership',
    slug: 'membership',
    is_active: true,
    sort_order: 0,
  });
  await col('card_plans').insertOne({
    _id: plan,
    category_id: category,
    code: 'BRONZE',
    name: 'Bronze',
    cash_price: '100000.00',
    minimum_down_payment: '10000.00',
    yearly_points: 25000,
    commission_rate: '0.04',
    is_active: true,
    sort_order: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  await col('tier_points_config').insertOne({
    _id: randomUUID(),
    tier: 'BRONZE',
    annual_points_cap: 25000,
  });
  const customer = randomUUID(),
    membership = randomUUID(),
    sale = randomUUID(),
    account = randomUUID();
  const activationDate = new Date(),
    expiry = new Date();
  expiry.setUTCFullYear(expiry.getUTCFullYear() + 1);
  await col('customers').insertOne({
    _id: customer,
    customer_number: 'AF-CUS-QAABC',
    customer_code: 'AF-CC-QAABCDEF',
    first_name: 'SYNTHETIC',
    last_name: 'VIP CUSTOMER',
    email: 'phase5-vip@example.invalid',
    phone: '+639171234567',
    birth_date: '1993-04-05',
    address: { line1: '77 Synthetic Street', city: 'Quezon City', province: 'Metro Manila' },
    status: 'active',
    auth_user_id: null,
    ra_number: '2026-0001',
    created_at: activationDate.toISOString(),
    updated_at: activationDate.toISOString(),
    created_by: created.user.id,
  });
  await db.collection<{ _id: string; seq: number }>('counters').updateOne(
    { _id: 'company-customer:2026' }, { $max: { seq: 1 } }, { upsert: true },
  );
  await col('memberships').insertOne({
    _id: membership,
    customer_id: customer,
    sale_id: sale,
    product_id: plan,
    membership_number: 'SYNTHETIC-STABLE-CARD',
    status: 'active',
    activated_at: activationDate.toISOString(),
    expires_at: expiry.toISOString(),
    yearly_points_allocated: 25000,
    points_balance: 0,
  });
  await col('points_accounts').insertOne({
    _id: account,
    membership_id: membership,
    balance: 0,
    lifetime_allocated: 0,
    lifetime_redeemed: 0,
    reversal_debt: 0,
    weekday_balance: 0,
    weekend_balance: 0,
    updated_at: activationDate.toISOString(),
  });
  await col('card_sales').insertOne({
    _id: sale,
    sale_number: 'AF-CSALE-QAABC',
    origin: 'normal',
    customer_id: customer,
    plan_id: plan,
    seller_staff_id: created.user.id,
    status: 'active',
    cash_price_snapshot: '100000.00',
    reservation_fee_snapshot: '10000.00',
    required_initial_snapshot: '10000.00',
    payment_scheme: 'spot_cash',
    validity_months_snapshot: 12,
    created_at: activationDate.toISOString(),
  });
  await col('payments').insertOne({
    _id: randomUUID(),
    customer_id: customer,
    sale_id: sale,
    amount: '100000.00',
    payment_number: 'SYNTHETIC-PAYMENT',
    method: 'cash',
    status: 'verified',
    recorded_at: activationDate.toISOString(),
  });
  return {
    staff: { id: created.user.id, email, password },
    customer: { id: customer, email: 'phase5-vip@example.invalid', membership, sale },
    plan,
    category,
  };
}
