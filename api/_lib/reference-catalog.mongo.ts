import { randomUUID } from 'node:crypto';
import type { Db, MongoClient } from 'mongodb';
import type { MongoRow } from './customer-activation.mongo.js';
import { MONGO_CORE_SETUP_VERSION } from './mongo-core-setup.js';

export const REFERENCE_CATALOG_COMMIT = 'f512c1416550feaf0c79a6bb204c51d08fa990f6';
// Annual caps are distinct from yearly loyalty allocations: 20261104000001_afhomes_points_rebuild.sql.
export const REFERENCE_POINTS_TIERS = [
  { tier: 'BRONZE', annual_points_cap: 25000 },
  { tier: 'SILVER', annual_points_cap: 40000 },
  { tier: 'GOLD', annual_points_cap: 60000 },
];
// develop seed + VIP payment schemes + official benefits + flexible commission migrations.
export const REFERENCE_CARD_PLANS = [
  {
    code: 'GOLD',
    name: 'Gold',
    cash_price: '312000.00',
    installment_price: '390000.00',
    minimum_down_payment: '20000.00',
    yearly_points: 25000,
    base_validity_years: 20,
    cardholder_limit: 2,
    discount_percent: 25,
    total_loyalty_value: '500000.00',
    sort_order: 10,
  },
  {
    code: 'SILVER',
    name: 'Silver',
    cash_price: '192000.00',
    installment_price: '240000.00',
    minimum_down_payment: '15000.00',
    yearly_points: 20000,
    base_validity_years: 10,
    cardholder_limit: 1,
    discount_percent: 20,
    total_loyalty_value: '200000.00',
    sort_order: 20,
  },
  {
    code: 'BRONZE',
    name: 'Bronze',
    cash_price: '54000.00',
    installment_price: '72000.00',
    minimum_down_payment: '10000.00',
    yearly_points: 10000,
    base_validity_years: 5,
    cardholder_limit: 1,
    discount_percent: 15,
    total_loyalty_value: '50000.00',
    sort_order: 30,
  },
].map((plan) => ({
  ...plan,
  reservation_fee: '10000.00',
  spot_cash_days: 7,
  standard_installment_months: 4,
  validity_years: plan.base_validity_years + 2,
  validity_extension_years: 2,
  annual_points_tranches: plan.base_validity_years,
  priority_reservation: true,
  no_monthly_annual_dues: true,
  move_a_enabled: true,
  move_b1_enabled: plan.code !== 'BRONZE',
  move_b2_enabled: plan.code !== 'BRONZE',
  commission_rate: '0',
  description: null,
  is_active: true,
}));

/** Explicit approved reference setup only. Existing catalog and commercial history are never rewritten. */
export async function installMongoReferenceCatalog(
  db: Db,
  client: MongoClient,
  actorId: string,
  options: { pointsOnly?: boolean } = {},
) {
  if (db.databaseName !== 'afhomes_dev' || db.client !== client)
    throw new Error('Reference catalog requires its matching development database');
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
        const core = await col('mongo_conversion_setup').findOne(
          { _id: 'core', version: MONGO_CORE_SETUP_VERSION, database: db.databaseName },
          { session },
        );
        if (!owner || !staff || !role || !core)
          throw new Error('Existing owner and approved core setup are required');
        const now = new Date().toISOString();
        let category: MongoRow | null = null;
        const added: string[] = [];
        if (!options.pointsOnly) {
          category = await col('card_categories').findOne({ slug: 'membership' }, { session });
          if (!category) {
            category = {
              _id: randomUUID(),
              slug: 'membership',
              name: 'Membership Cards',
              sort_order: 10,
              is_active: true,
              description: null,
              created_at: now,
              updated_at: now,
            };
            await col('card_categories').insertOne(category, { session });
            added.push('membership');
          }
          if (!category.is_active)
            throw new Error('Existing inactive category requires an administrator decision');
          for (const plan of REFERENCE_CARD_PLANS) {
            if (await col('card_plans').findOne({ code: plan.code }, { session })) continue;
            await col('card_plans').insertOne(
              {
                _id: randomUUID(),
                category_id: category._id,
                ...plan,
                created_at: now,
                updated_at: now,
              },
              { session },
            );
            added.push(plan.code);
          }
        }
        for (const config of REFERENCE_POINTS_TIERS) {
          const matches = await col('tier_points_config')
            .find({ tier: config.tier }, { session })
            .toArray();
          if (
            matches.length > 1 ||
            (matches.length === 1 &&
              (!Number.isSafeInteger(Number(matches[0]!.annual_points_cap)) ||
                Number(matches[0]!.annual_points_cap) <= 0))
          )
            throw new Error('Existing points configuration requires review');
          if (matches.length) continue;
          await col('tier_points_config').insertOne(
            { _id: randomUUID(), ...config, updated_at: now, updated_by: actorId },
            { session },
          );
          added.push(`points:${config.tier}`);
        }
        if (added.length)
          await col('audit_events').insertOne(
            {
              _id: randomUUID(),
              actor_id: actorId,
              action: options.pointsOnly
                ? 'REFERENCE_POINTS_CONFIG_INITIALIZED'
                : 'REFERENCE_CATALOG_INITIALIZED',
              entity_type: options.pointsOnly ? 'tier_points_config' : 'card_catalog',
              entity_id: category?._id ?? 'reference-points-tiers',
              created_at: now,
              after_data: { source_commit: REFERENCE_CATALOG_COMMIT, added },
            },
            { session },
          );
        return { sourceCommit: REFERENCE_CATALOG_COMMIT, added };
      },
      { timeoutMS: 60_000 },
    );
  } finally {
    await session.endSession();
  }
}
