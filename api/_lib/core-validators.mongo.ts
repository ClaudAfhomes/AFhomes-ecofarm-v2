import type { Db, Document } from 'mongodb';
import {
  EXACT_DECIMAL_STRING_RE,
  EXACT_DECIMAL_RATE_RE,
  saleStatusSchema,
  paymentStatusSchema,
  membershipStatusSchema,
  commissionStatusSchema,
} from '@afhomes/contracts';
import { purchaseFingerprint } from './purchase-fingerprint.js';

const VERSION = 'afhomes-core-validators-v1';

/** Proposed rules only; never installed by runtime startup or a request. */
export function mongoCoreValidators(): Record<string, Document> {
  const id = { bsonType: 'string', minLength: 1 };
  const money = { bsonType: 'string', pattern: EXACT_DECIMAL_STRING_RE.source };
  const rate = { bsonType: 'string', pattern: EXACT_DECIMAL_RATE_RE.source };
  const integer = {
    bsonType: ['int', 'long', 'double'],
    multipleOf: 1,
    minimum: Number.MIN_SAFE_INTEGER,
    maximum: Number.MAX_SAFE_INTEGER,
  };
  const balance = { ...integer, minimum: 0 };
  const row = (required: string[], properties: Document) => ({
    $jsonSchema: {
      bsonType: 'object',
      required: ['_id', ...required],
      properties: { _id: id, ...properties },
    },
  });
  return {
    card_sales: row(['customer_id', 'plan_id', 'status', 'cash_price_snapshot'], {
      customer_id: id,
      plan_id: id,
      status: { enum: saleStatusSchema.options },
      cash_price_snapshot: money,
      minimum_down_payment_snapshot: money,
      reservation_fee_snapshot: money,
      required_initial_snapshot: money,
      expected_commission_snapshot: money,
      commission_rate_snapshot: rate,
      yearly_points_snapshot: balance,
    }),
    payments: row(['amount', 'status'], {
      amount: money,
      status: { enum: paymentStatusSchema.options },
      sale_id: { bsonType: ['string', 'null'] },
      reservation_id: { bsonType: ['string', 'null'] },
    }),
    memberships: row(['customer_id', 'sale_id', 'status', 'points_balance'], {
      customer_id: id,
      sale_id: id,
      status: { enum: membershipStatusSchema.options },
      points_balance: balance,
      yearly_points_allocated: balance,
    }),
    points_accounts: row(['membership_id', 'balance'], {
      membership_id: id,
      balance,
      reversal_debt: balance,
      lifetime_allocated: balance,
      lifetime_redeemed: balance,
      weekday_balance: integer,
      weekend_balance: integer,
    }),
    points_ledger: row(['account_id', 'amount', 'balance_after'], {
      account_id: id,
      amount: integer,
      balance_before: balance,
      balance_after: balance,
      weekday_delta: integer,
      weekend_delta: integer,
      counts_toward_cap: { bsonType: 'bool' },
    }),
    commissions: row(['sale_id', 'status', 'amount'], {
      sale_id: id,
      status: { enum: commissionStatusSchema.options },
      amount: money,
      rate_snapshot: rate,
      basis_amount_snapshot: money,
    }),
  };
}

/** Counts only, read-only. This is a review preflight, not approval or an apply. */
export async function inspectMongoCoreValidators(db: Db) {
  if (db.databaseName !== 'afhomes_dev') throw new Error('Validator review requires afhomes_dev');
  const proposed = mongoCoreValidators();
  // Atlas shared tiers reject some complex listCollections filters.
  const metadata = await db.listCollections({}, { nameOnly: false }).toArray();
  const collections: {
    collection: string;
    state: 'absent' | 'missing' | 'matching' | 'conflict';
    checkedDocuments: number;
    invalidDocuments: number;
    proposedDigest: string;
  }[] = [];
  const session = db.client.startSession({ snapshot: true });
  try {
    for (const [collection, validator] of Object.entries(proposed)) {
      const saved = metadata.find((item) => item.name === collection);
      const existing = saved?.options?.validator ?? {};
      const matching =
        purchaseFingerprint(existing) === purchaseFingerprint(validator) &&
        (saved?.options?.validationLevel ?? 'strict') === 'strict' &&
        (saved?.options?.validationAction ?? 'error') === 'error';
      const state = !saved
        ? 'absent'
        : saved.type !== 'collection'
          ? 'conflict'
          : matching
            ? 'matching'
            : Object.keys(existing).length
              ? 'conflict'
              : 'missing';
      const query = { session, maxTimeMS: 15000 };
      const checkedDocuments =
        saved?.type === 'collection'
          ? await db.collection(collection).countDocuments({}, query)
          : 0;
      const invalidDocuments = checkedDocuments
        ? await db.collection(collection).countDocuments({ $nor: [validator] }, query)
        : 0;
      collections.push({
        collection,
        state,
        checkedDocuments,
        invalidDocuments,
        proposedDigest: purchaseFingerprint(validator),
      });
    }
  } finally {
    await session.endSession();
  }
  return {
    database: db.databaseName,
    version: VERSION,
    readyForReview: collections.every(
      (item) => !['absent', 'conflict'].includes(item.state) && item.invalidDocuments === 0,
    ),
    collections,
    digest: purchaseFingerprint({ version: VERSION, collections }),
  };
}
