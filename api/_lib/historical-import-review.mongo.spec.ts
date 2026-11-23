import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import type { CustomerImportContinuation } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { reviewMongoHistoricalImport } from './historical-import-review.mongo.js';
import { externalImportSummary } from './external-customer-import.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { createMongoImportClaimRecords } from './import-claim-records.mongo.js';

let replica: Awaited<ReturnType<typeof createTestReplica>>;
beforeAll(async () => {
  replica = await createTestReplica();
}, 30000);
afterAll(async () => {
  await replica?.stop();
});
const col = (name: string) => replica.db.collection<MongoRow>(name);
const customerId = randomUUID();
function fixture(fields: Record<string, string> = {}) {
  const raw: Record<string, string> = {
    contract_date: '2025-01-01',
    stated_total: '312000',
    stated_rf: '10000',
    stated_status: 'Active VIP',
    existing_stay_points_total: '101',
    existing_card_activation_date: '2025-01-02',
    existing_card_valid_until: '2047-01-02',
    vip_tier: 'GOLD',
    stated_payment_scheme_code: 'spot_cash',
    purchase_reference: 'AUTO-VIP-synthetic',
    referrer_staff_id: randomUUID(),
    ...fields,
  };
  const row: MongoRow = {
    _id: randomUUID(),
    raw_data: raw,
    normalized_data: {
      externalVerified: true,
      externalReason: 'Certified synthetic company history',
      externalSummary: externalImportSummary(raw, []),
      paymentClaims: [],
    },
  };
  const base: CustomerImportContinuation = {
    rowId: row._id,
    sourceId: null,
    customerId,
    applicationId: null,
    reservationId: null,
    saleId: null,
    stage: 'application',
    missingRequirements: ['Complete the application'],
    conflicts: [],
    proposedFields: [],
    nextAction: null,
    expectedSourceHash: 'a'.repeat(64),
    expectedTargetVersion: 'b'.repeat(64),
    expectedTeamVersion: 'c'.repeat(64),
    claimCount: 0,
    purchaseReference: 'AUTO-VIP-synthetic',
  };
  return { row, raw, base };
}
async function review(f: ReturnType<typeof fixture>) {
  const session = replica.client.startSession();
  try {
    return await session.withTransaction(() =>
      reviewMongoHistoricalImport(replica.db, f.row, f.base, session),
    );
  } finally {
    await session.endSession();
  }
}

it('previews certified history with the source 70/30 split without creating business records', async () => {
  const f = fixture();
  const before = await replica.db.listCollections().toArray();
  const result = await review(f);
  expect(result).toMatchObject({
    stage: 'active',
    externallyVerified: true,
    externalSummary: {
      paid: '312000.00',
      balance: '0.00',
      existingPoints: 101,
      weekdayPoints: 71,
      weekendPoints: 30,
      settlement: 'certified',
    },
    historicalPointsPreview: { eligible: true, stayPointsTotal: '101' },
    vipControlNumberPreview: { existing: null, generated: null, source: 'generated' },
    purchaseReference: null,
    missingRequirements: [],
  });
  expect(await replica.db.listCollections().toArray()).toEqual(before);
});

it('keeps inactive balances non-spendable and requires actual membership dates', async () => {
  const f = fixture({
    stated_status: 'Expired',
    existing_card_activation_date: '',
    existing_card_valid_until: '',
  });
  expect(await review(f)).toMatchObject({
    stage: 'review',
    historicalPointsPreview: { eligible: false, stayPointsTotal: '101' },
    missingRequirements: [expect.stringContaining('activation and valid-until dates')],
  });
});

it('detects another customer’s VIP number without exposing their identity', async () => {
  const number = '12345678901G1C01S';
  await col('customers').insertOne({
    _id: randomUUID(),
    vip_card_number: number,
    email: 'private@example.invalid',
  });
  const result = await review(fixture({ existing_vip_control_number: number }));
  expect(result).toMatchObject({
    stage: 'review',
    conflicts: [
      { field: 'purchase_reference', message: expect.stringContaining('another customer') },
    ],
  });
  expect(JSON.stringify(result)).not.toContain('private@example.invalid');
});

it('preserves conflicts already found by ordinary identity review', async () => {
  const f = fixture();
  f.base.stage = 'review';
  f.base.conflicts = [{ field: 'first_name', message: 'Identity mismatch' }];
  expect(await review(f)).toMatchObject({ stage: 'review', conflicts: f.base.conflicts });
});

it('requires explicit reconciliation of existing applications and refuses backwards reservation history', async () => {
  const f = fixture({ stated_status: 'Fully Paid' });
  f.base.applicationId = randomUUID();
  expect(await review(f)).toMatchObject({
    stage: 'review',
    conflicts: [expect.objectContaining({ field: 'external_history' })],
  });
  const reservationId = randomUUID();
  f.base.reservationId = reservationId;
  await col('reservation_agreements').insertOne({
    _id: reservationId,
    customer_id: customerId,
    customer_application_id: f.base.applicationId,
    status: 'executed',
    reservation_date: f.raw.contract_date,
    total_price_snapshot: '312000.00',
    reservation_fee_snapshot: '10000.00',
    tier_snapshot: 'SILVER',
    payment_scheme_snapshot: 'spot_cash',
    seller_staff_id: f.raw.referrer_staff_id,
  });
  expect(await review(f)).toMatchObject({
    stage: 'review',
    conflicts: [expect.objectContaining({ field: 'vip_tier' })],
  });
});

it('never replaces an existing historical points baseline', async () => {
  const id = randomUUID(),
    member = randomUUID();
  await col('memberships').insertOne({ _id: member, customer_id: id });
  await col('customer_import_points_baselines').insertOne({
    _id: randomUUID(),
    membership_id: member,
    confirmed_points: 100,
  });
  const f = fixture();
  f.base.customerId = id;
  expect(await review(f)).toMatchObject({
    stage: 'review',
    conflicts: [expect.objectContaining({ field: 'existing_stay_points_total' })],
  });
});

it('rejects tampered cached totals and missing certification reasons', async () => {
  const f = fixture();
  (f.row.normalized_data as { externalReason: string }).externalReason = '';
  await expect(review(f)).rejects.toThrow('certification');
  const altered = fixture();
  (altered.row.normalized_data as { externalSummary: { paid: string } }).externalSummary.paid =
    '1.00';
  await expect(review(altered)).rejects.toThrow('summary');
});

it.each([
  ['Pending', '0.00', 'application'],
  ['Reservation Paid', '10000.00', 'reservation'],
  ['Partially Paid', '15000.00', 'finance'],
  ['Fully Paid', '312000.00', 'activation'],
])(
  'derives %s from exact claimed receipts without marking them verified',
  async (status, amount, stage) => {
    const f = fixture();
    f.raw.stated_status = status;
    const claims =
      amount === '0.00'
        ? []
        : [
            {
              paymentKey: 'synthetic',
              customerKey: 'synthetic',
              purpose: 'full' as const,
              amount,
              date: '2025-01-01',
              method: 'cash' as const,
              reference: 'synthetic',
              notes: '',
            },
          ];
    f.row.normalized_data = {
      externalVerified: true,
      externalReason: 'Certified synthetic original receipts',
      externalSummary: externalImportSummary(f.raw, claims),
      paymentClaims: claims,
    };
    expect(await review(f)).toMatchObject({
      stage,
      externalSummary: { paid: amount, settlement: 'receipts' },
    });
    expect(await col('payments').countDocuments()).toBe(0);
  },
);

it('uses only verified money after certification, preserving the original accepted statement', async () => {
  const f = fixture(),
    reservation = randomUUID(),
    source = randomUUID();
  f.raw.stated_status = 'Partially Paid';
  const claims = [
    {
      paymentKey: 'prior',
      customerKey: 'synthetic',
      purpose: 'full' as const,
      amount: '10000.00',
      date: '2025-01-01',
      method: 'cash' as const,
      reference: 'synthetic',
      notes: '',
    },
  ];
  f.row.normalized_data = {
    externalVerified: true,
    externalReason: 'Certified synthetic original receipts',
    externalSummary: externalImportSummary(f.raw, claims),
    paymentClaims: claims,
  };
  f.base.sourceId = source;
  f.base.applicationId = randomUUID();
  f.base.reservationId = reservation;
  f.base.stage = 'finance';
  f.base.missingRequirements = [];
  await col('reservation_agreements').insertOne({
    _id: reservation,
    customer_id: customerId,
    total_price_snapshot: '312000.00',
    minimum_down_payment_snapshot: '10000.00',
  });
  await col('customer_external_import_receipts').insertOne({
    _id: randomUUID(),
    source_id: source,
    application_id: f.base.applicationId,
    reservation_id: reservation,
    paid_total: '10000.00',
  });
  await col('payments').insertMany(
    ['verified', 'recorded', 'rejected'].map((status) => ({
      _id: randomUUID(),
      reservation_id: reservation,
      amount: '20000.00',
      status,
    })),
  );
  const before = await col('customer_external_import_receipts').findOne({ source_id: source });
  expect(await review(f)).toMatchObject({
    stage: 'finance',
    externalSummary: { paid: '20000.00', balance: '292000.00' },
  });
  expect(await col('customer_external_import_receipts').findOne({ source_id: source })).toEqual(
    before,
  );
  await col('payments').deleteMany({ reservation_id: reservation });
});

it('invalidates review tokens when historical baselines or receipts change', async () => {
  const f = fixture(),
    id = randomUUID(),
    member = randomUUID(),
    sourceId = randomUUID();
  f.raw.email = 'baseline-review@example.invalid';
  f.row.customer_id = id;
  await col('customers').insertOne({ _id: id, email: f.raw.email });
  await col('memberships').insertOne({ _id: member, customer_id: id });
  const source: MongoRow = { _id: sourceId, customer_id: id, original_row_id: f.row._id };
  const records = createMongoImportClaimRecords(replica.db);
  const before = await records.targetForRow(f.row, source);
  await col('customer_import_points_baselines').insertOne({
    _id: randomUUID(),
    membership_id: member,
    confirmed_points: 101,
  });
  const baseline = await records.targetForRow(f.row, source);
  expect(baseline).not.toBe(before);
  await col('customer_external_import_receipts').insertOne({
    _id: randomUUID(),
    source_id: sourceId,
  });
  expect(await records.targetForRow(f.row, source)).not.toBe(baseline);
});
