import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createMongoClient } from '../_lib/mongodb.js';
import {
  installMongoReferenceCatalog,
  REFERENCE_CARD_PLANS,
  REFERENCE_CATALOG_COMMIT,
  REFERENCE_POINTS_TIERS,
} from '../_lib/reference-catalog.mongo.js';
import type { MongoRow } from '../_lib/customer-activation.mongo.js';

try {
  const args = process.argv.slice(2),
    apply = args.includes('--apply'),
    pointsOnly = args.includes('--points-only');
  if (
    args.some(
      (arg) =>
        ![
          '--plan',
          '--apply',
          '--points-only',
          '--approve-reference-catalog=afhomes_dev',
          '--approve-points-config=afhomes_dev',
        ].includes(arg),
    ) ||
    (apply &&
      !args.includes(
        pointsOnly
          ? '--approve-points-config=afhomes_dev'
          : '--approve-reference-catalog=afhomes_dev',
      ))
  )
    throw new Error('Explicit reference catalog approval is required');
  loadEnvFile(fileURLToPath(new URL('../../.env.local', import.meta.url)));
  const { client, database } = createMongoClient();
  try {
    await client.connect();
    const db = client.db(database);
    if (database !== 'afhomes_dev') throw new Error('Development database required');
    if (apply) {
      const owner = await db
        .collection<MongoRow>('admin_bootstrap')
        .findOne({ _id: 'initial-super-admin' });
      if (typeof owner?.user_id !== 'string') throw new Error('Existing owner required');
      console.log(
        JSON.stringify(
          await installMongoReferenceCatalog(db, client, owner.user_id, { pointsOnly }),
        ),
      );
    }
    const existing = await db.collection('card_plans').find({}).toArray();
    const existingPoints = await db.collection('tier_points_config').find({}).toArray();
    console.log(
      JSON.stringify({
        database,
        sourceCommit: REFERENCE_CATALOG_COMMIT,
        pointsOnly,
        pointsTiers: REFERENCE_POINTS_TIERS.map((config) => ({
          tier: config.tier,
          annualPointsCap: config.annual_points_cap,
          existingCount: existingPoints.filter((row) => row.tier === config.tier).length,
          existingCaps: existingPoints
            .filter((row) => row.tier === config.tier)
            .map((row) => row.annual_points_cap),
        })),
        plans: (pointsOnly ? [] : REFERENCE_CARD_PLANS).map((plan) => ({
          code: plan.code,
          cashPrice: plan.cash_price,
          installmentPrice: plan.installment_price,
          validityYears: plan.validity_years,
          commissionRate: plan.commission_rate,
          exists: existing.some((row) => row.code === plan.code),
          matchesReference: existing.some(
            (row) =>
              row.code === plan.code &&
              Object.entries(plan).every(([key, value]) => row[key] === value),
          ),
        })),
        activePlans: existing.filter((row) => row.is_active === true).length,
      }),
    );
  } finally {
    await client.close();
  }
} catch {
  console.error(
    'Reference catalog setup failed. No credentials or raw database errors are printed.',
  );
  process.exitCode = 1;
}
