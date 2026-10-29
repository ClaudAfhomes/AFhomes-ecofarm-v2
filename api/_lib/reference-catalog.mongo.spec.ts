import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoCatalog } from './catalog.mongo.js';
import { MONGO_CORE_SETUP_VERSION } from './mongo-core-setup.js';
import { installMongoReferenceCatalog, REFERENCE_CARD_PLANS } from './reference-catalog.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';

it('inserts develop reference terms once, preserves customized plans and identities, and rolls back on audit failure', async () => {
  const test = await createTestReplica({ timeoutMS: 15000 });
  const col = (name: string) => test.db.collection<MongoRow>(name);
  try {
    await setupMongoCatalog(test.db);
    await expect(installMongoReferenceCatalog(test.db, test.client, 'unknown')).rejects.toThrow(
      'Existing owner',
    );
    expect(await col('card_plans').countDocuments()).toBe(0);
    const id = randomUUID(),
      role = randomUUID();
    await col('admin_bootstrap').insertOne({ _id: 'initial-super-admin', user_id: id });
    const owner = {
      _id: id,
      email: 'catalog-owner@example.invalid',
      status: 'active',
      must_change_password: false,
    };
    await col('staff_users').insertOne(owner);
    await col('roles').insertOne({ _id: role, slug: 'super_admin', is_active: true });
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: id,
      role_id: role,
    });
    await col('mongo_conversion_setup').insertOne({
      _id: 'core',
      version: MONGO_CORE_SETUP_VERSION,
      database: 'afhomes_dev',
    });
    await test.db.createCollection('audit_events', {
      validator: { rejectAudit: { $exists: true } },
    });
    await expect(installMongoReferenceCatalog(test.db, test.client, id)).rejects.toThrow();
    expect(await col('card_plans').countDocuments()).toBe(0);
    expect(await col('card_categories').countDocuments()).toBe(0);
    expect(await col('tier_points_config').countDocuments()).toBe(0);
    await test.db.command({ collMod: 'audit_events', validator: {} });
    expect(
      (await installMongoReferenceCatalog(test.db, test.client, id, { pointsOnly: true }))!.added,
    ).toEqual(['points:BRONZE', 'points:SILVER', 'points:GOLD']);
    expect(await col('card_plans').countDocuments()).toBe(0);
    expect(await col('card_categories').countDocuments()).toBe(0);
    expect(
      (await col('tier_points_config').find().sort({ tier: 1 }).toArray()).map((row) => [
        row.tier,
        row.annual_points_cap,
      ]),
    ).toEqual([
      ['BRONZE', 25000],
      ['GOLD', 60000],
      ['SILVER', 40000],
    ]);
    expect((await installMongoReferenceCatalog(test.db, test.client, id))!.added).toEqual([
      'membership',
      'GOLD',
      'SILVER',
      'BRONZE',
    ]);
    for (const expected of REFERENCE_CARD_PLANS)
      expect(await col('card_plans').findOne({ code: expected.code })).toMatchObject(expected);
    expect(
      REFERENCE_CARD_PLANS.map((row) => [
        row.code,
        row.cash_price,
        row.validity_years,
        row.cardholder_limit,
        row.commission_rate,
      ]),
    ).toEqual([
      ['GOLD', '312000.00', 22, 2, '0'],
      ['SILVER', '192000.00', 12, 1, '0'],
      ['BRONZE', '54000.00', 7, 1, '0'],
    ]);
    await col('card_plans').updateOne(
      { code: 'BRONZE' },
      { $set: { cash_price: '55000.00', is_active: false } },
    );
    await col('tier_points_config').updateOne(
      { tier: 'BRONZE' },
      { $set: { annual_points_cap: 27500 } },
    );
    const pointsBefore = await col('tier_points_config').find().toArray();
    const before = await col('card_plans').find().toArray();
    expect((await installMongoReferenceCatalog(test.db, test.client, id))!.added).toEqual([]);
    expect(await col('card_plans').find().toArray()).toEqual(before);
    expect(await col('tier_points_config').find().toArray()).toEqual(pointsBefore);
    expect(await col('staff_users').findOne({ _id: id })).toEqual(owner);
    expect(await col('audit_events').countDocuments()).toBe(2);
    await col('tier_points_config').insertOne({
      _id: randomUUID(),
      tier: 'GOLD',
      annual_points_cap: 60000,
    });
    await expect(
      installMongoReferenceCatalog(test.db, test.client, id, { pointsOnly: true }),
    ).rejects.toThrow('points configuration');
    for (const name of ['card_sales', 'payments', 'customers', 'memberships', 'commission_rules'])
      expect(await col(name).countDocuments()).toBe(0);
  } finally {
    await test.stop();
  }
}, 30000);
