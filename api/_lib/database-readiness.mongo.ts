import type { Db } from 'mongodb';
import { isExactDecimal, compareMoney } from '@afhomes/shared';
import { purchaseFingerprint } from './purchase-records.mongo.js';
import { sumMoney } from './report-scope.js';
import type { MongoRow } from './customer-activation.mongo.js';

const relationships = [
  ['staff_role_assignments', 'staff_id', 'staff_users', true],
  ['staff_role_assignments', 'role_id', 'roles', true],
  ['role_permissions', 'role_id', 'roles', true],
  ['role_permissions', 'module_id', 'modules', true],
  ['staff_permission_restrictions', 'staff_id', 'staff_users', true],
  ['staff_permission_restrictions', 'module_id', 'modules', true],
  ['card_sales', 'customer_id', 'customers', true],
  ['card_sales', 'plan_id', 'card_plans', true],
  ['payments', 'sale_id', 'card_sales', false],
  ['payments', 'reservation_id', 'reservation_agreements', false],
  ['memberships', 'sale_id', 'card_sales', true],
  ['memberships', 'customer_id', 'customers', true],
  ['points_accounts', 'membership_id', 'memberships', true],
  ['points_ledger', 'account_id', 'points_accounts', true],
  ['points_periods', 'account_id', 'points_accounts', true],
  ['customer_applications', 'customer_id', 'customers', true],
  ['customer_applications', 'plan_id', 'card_plans', true],
  ['customer_application_holders', 'application_id', 'customer_applications', true],
  ['customer_application_purchase_terms', 'application_id', 'customer_applications', true],
  ['reservation_agreements', 'customer_application_id', 'customer_applications', false],
  ['reservation_agreements', 'sale_id', 'card_sales', false],
  ['reservation_agreement_holders', 'agreement_id', 'reservation_agreements', true],
  ['reservation_agreement_schedule', 'agreement_id', 'reservation_agreements', true],
  ['commissions', 'sale_id', 'card_sales', true],
  ['customer_import_purchase_sources', 'original_row_id', 'customer_import_rows', true],
  ['customer_import_purchase_sources', 'customer_id', 'customers', true],
  ['customer_import_purchase_sources', 'application_id', 'customer_applications', false],
  ['customer_import_source_rows', 'row_id', 'customer_import_rows', true],
  ['customer_import_source_rows', 'source_id', 'customer_import_purchase_sources', true],
  ['customer_external_import_receipts', 'source_id', 'customer_import_purchase_sources', true],
  ['customer_external_import_receipts', 'application_id', 'customer_applications', true],
  ['customer_external_import_receipts', 'reservation_id', 'reservation_agreements', false],
  ['customer_external_import_receipts', 'sale_id', 'card_sales', false],
  ['customer_import_commission_policies', 'source_id', 'customer_import_purchase_sources', true],
  ['customer_import_points_baselines', 'membership_id', 'memberships', true],
  ['customer_import_points_baselines', 'row_id', 'customer_import_rows', true],
] as const;

function indexShape(index: Record<string, unknown>) {
  return purchaseFingerprint({
    key: Object.entries(index.key as object),
    unique: index.unique === true,
    sparse: index.sparse === true,
    partial: index.partialFilterExpression ?? null,
    collation: index.collation ?? null,
    ttl: index.expireAfterSeconds ?? null,
    hidden: index.hidden === true,
  });
}

/** Read-only health evidence. Reference schema must be built on a NEW disposable replica. */
export async function inspectMongoDatabaseReadiness(db: Db, reference: Db) {
  if (
    db.databaseName !== 'afhomes_dev' ||
    reference.databaseName !== 'afhomes_dev' ||
    db.client === reference.client
  )
    throw new Error('Independent afhomes_dev reference required');
  const expected = await reference.listCollections({}, { nameOnly: true }).toArray();
  const actual = await db.listCollections({}, { nameOnly: false }).toArray();
  const names = new Set(actual.map((collection) => collection.name));
  const missingCollections = expected
    .map((collection) => collection.name)
    .filter((name) => !names.has(name))
    .sort();
  const missingIndexes: { collection: string; key: object; unique: boolean }[] = [];
  for (const collection of expected.filter((collection) => names.has(collection.name))) {
    const indexes = await db.collection(collection.name).listIndexes().toArray();
    for (const index of await reference.collection(collection.name).listIndexes().toArray()) {
      if (index.name === '_id_') continue;
      if (!indexes.some((saved) => indexShape(saved) === indexShape(index)))
        missingIndexes.push({
          collection: collection.name,
          key: index.key,
          unique: index.unique === true,
        });
    }
  }
  const brokenReferences: { relationship: string; count: number }[] = [];
  const session = db.client.startSession({ snapshot: true });
  const col = (name: string) => db.collection<MongoRow>(name);
  const issues = {
    malformedMoney: 0,
    activeMembershipWithoutFullVerifiedPayment: 0,
    membershipPointsMismatch: 0,
    missingPointsAccount: 0,
    invalidPointsBalance: 0,
  };
  let checkedMemberships = 0;
  try {
    for (const [table, field, parent, required] of relationships) {
      if (!names.has(table)) continue;
      const result = await col(table)
        .aggregate<{ count: number }>(
          [
            ...(!required ? [{ $match: { [field]: { $ne: null } } }] : []),
            { $lookup: { from: parent, localField: field, foreignField: '_id', as: '_parent' } },
            { $match: { '_parent.0': { $exists: false } } },
            { $count: 'count' },
          ],
          { session },
        )
        .next();
      if (result?.count)
        brokenReferences.push({
          relationship: `${table}.${field} -> ${parent}`,
          count: result.count,
        });
    }
    if (names.has('payments'))
      for await (const payment of col('payments').find({}, { session, projection: { amount: 1 } }))
        if (typeof payment.amount !== 'string' || !isExactDecimal(payment.amount))
          issues.malformedMoney++;
    if (names.has('memberships'))
      for await (const member of col('memberships').find(
        {},
        { session, projection: { sale_id: 1, points_balance: 1, status: 1 } },
      )) {
        checkedMemberships++;
        const account = await col('points_accounts').findOne(
          { membership_id: member._id },
          { session, projection: { balance: 1 } },
        );
        if (!account) issues.missingPointsAccount++;
        else {
          const balance = Number(account.balance),
            mirrored = Number(member.points_balance);
          if (
            !Number.isSafeInteger(balance) ||
            balance < 0 ||
            !Number.isSafeInteger(mirrored) ||
            mirrored < 0
          )
            issues.invalidPointsBalance++;
          else if (balance !== mirrored) issues.membershipPointsMismatch++;
        }
        if (member.status !== 'active') continue;
        const sale = await col('card_sales').findOne(
          { _id: String(member.sale_id) },
          { session, projection: { cash_price_snapshot: 1 } },
        );
        if (
          !sale ||
          typeof sale.cash_price_snapshot !== 'string' ||
          !isExactDecimal(sale.cash_price_snapshot)
        ) {
          issues.malformedMoney++;
          issues.activeMembershipWithoutFullVerifiedPayment++;
          continue;
        }
        const payments = await col('payments')
          .find({ sale_id: sale._id, status: 'verified' }, { session, projection: { amount: 1 } })
          .toArray();
        if (
          payments.some((p) => typeof p.amount !== 'string' || !isExactDecimal(p.amount)) ||
          compareMoney(sumMoney(payments.map((p) => p.amount)), sale.cash_price_snapshot) < 0
        )
          issues.activeMembershipWithoutFullVerifiedPayment++;
      }
  } finally {
    await session.endSession();
  }
  const schemaComplete = !missingCollections.length && !missingIndexes.length;
  const checkedDataConsistent =
    !brokenReferences.length && Object.values(issues).every((count) => count === 0);
  return {
    database: db.databaseName,
    checkedAt: new Date().toISOString(),
    schemaComplete,
    checkedDataConsistent,
    collectionCount: actual.length,
    referenceCollectionCount: expected.length,
    collectionsWithValidators: actual.filter(
      (collection) => Object.keys(collection.options?.validator ?? {}).length,
    ).length,
    missingCollections,
    missingIndexes,
    brokenReferences,
    checkedMemberships,
    issues,
    limits: [
      'Only declared core relationships and listed financial/points checks were inspected.',
      'Does not certify all collections, authentication usability, migration, file recovery or browser workflows.',
    ],
  };
}
