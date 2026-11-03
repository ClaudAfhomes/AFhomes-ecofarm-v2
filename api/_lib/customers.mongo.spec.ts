import { beforeAll, afterAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { customerSchema, isAfId } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoCustomersHandler, setupMongoCustomers, ensureMongoCustomerVipNumber } from './customers.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { authorizeAfHomes } from './afhomes-access.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>;
let handler: ReturnType<typeof createMongoCustomersHandler>;
const actor = randomUUID();
const authorize: typeof authorizeAfHomes = async () => ({
  userId: actor,
  email: 'synthetic@example.invalid',
  fullName: 'Synthetic Staff',
  status: 'active',
  roleId: randomUUID(),
  roleSlug: 'sales_manager',
  roleName: 'SM',
  mustChangePassword: false,
  permissions: [],
});
const input = (suffix: string) => ({
  firstName: 'Ana',
  lastName: 'Reyes',
  dateOfBirth: '1993-04-05',
  email: `${suffix}@example.invalid`,
  phone: '09185550999',
  address: { line1: '77 Katipunan', city: 'Quezon City', province: 'Metro Manila' },
  governmentIdType: 'philippine_id',
  governmentIdNumber: `PRIVATE-ID-${suffix}`,
  tinNumber: 'PRIVATE-TIN',
  supplementaryFullName: 'Maria Reyes',
  supplementaryTinNumber: 'PRIVATE-SUPPLEMENTARY',
  companyStatus: 'Application',
  statedTotalAmount: '999999.00',
});
beforeAll(async () => {
  test = await createTestReplica();
  await setupMongoCustomers(test.db);
  handler = createMongoCustomersHandler(test.db, test.client, authorize);
}, 120_000);
afterAll(async () => {
  await test?.stop();
});
it.each([['spot_cash','C01'],['move_a','C01'],['installment_4_month','T04'],['move_b1_40_12','T12'],['move_b2_25_12','T12']])('issues stable VIP numbers with the actual %s terms',async(scheme,suffix)=>{
  const id=randomUUID(), customers=test.db.collection<MongoRow>('customers');
  await customers.insertOne({_id:id});
  const session=test.client.startSession();
  try {
    const number=await session.withTransaction(()=>ensureMongoCustomerVipNumber(test.db,id,'GOLD',scheme,session));
    expect(number).toMatch(new RegExp(`^\\d{11}G1${suffix}S$`));
    expect(await session.withTransaction(()=>ensureMongoCustomerVipNumber(test.db,id,'GOLD',scheme,session))).toBe(number);
  }finally{await session.endSession();await customers.deleteOne({_id:id});}
});
async function call(
  method: string,
  path = '',
  body?: unknown,
  query: Record<string, unknown> = {},
) {
  const res = makeRes();
  await handler(
    { method, body, headers: {}, query: { familyPath: path, ...query } } as VercelRequest,
    res.res,
  );
  return res.state;
}
it('preserves all company fields, canonical IDs and safe create/list/detail projections', async () => {
  const response = await call('POST', '', input('one'));
  expect(response.status).toBe(201);
  const created = customerSchema.parse(response.body);
  expect(isAfId('AF-CUS', created.customerNumber)).toBe(true);
  expect(isAfId('AF-CC', created.customerCode)).toBe(true);
  expect(created.raNumber).toMatch(/^\d{4}-\d{4,}$/);
  expect(created.fullName).toBe('Ana Reyes');
  expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE-ID|PRIVATE-TIN|PRIVATE-SUPPLEMENTARY/);
  const detail = await call('GET', created.id);
  expect(detail.status).toBe(200);
  expect(detail.body).toMatchObject({
    tinNumber: 'PRIVATE-TIN',
    supplementaryTinNumber: 'PRIVATE-SUPPLEMENTARY',
    statedTotalAmount: '999999.00',
  });
  expect(JSON.stringify(detail.body)).not.toContain('PRIVATE-ID');
  const list = await call('GET', '', undefined, { search: created.raNumber });
  expect(list.body).toMatchObject({
    meta: { total: 1 },
    data: [{ id: created.id, derivedCategory: 'PENDING' }],
  });
  const audits = await test.db.collection('audit_events').find({ entity_id: created.id }).toArray();
  expect(JSON.stringify(audits)).not.toMatch(/PRIVATE-ID|PRIVATE-TIN|PRIVATE-SUPPLEMENTARY/);
  expect(
    (await call('PATCH', created.id, { phone: '09175550123', vipCardNumber: 'forged' })).status,
  ).toBe(409);
  expect(
    (await call('PATCH', created.id, { phone: '09175550123', companyStatus: 'Revised' })).status,
  ).toBe(200);
  expect((await call('GET', created.id)).body).toMatchObject({
    companyStatus: 'Revised',
    phone: '+639175550123',
    vipCardNumber: expect.stringMatching(/^\d{11}B1C01S$/),
  });
});
it('reconciles all purchases/reservations using only verified money; filters and pages before output', async () => {
  const created = customerSchema.parse((await call('POST', '', input('two'))).body);
  const col = (name: string) => test.db.collection<MongoRow>(name);
  const plan = randomUUID(),
    sale = randomUUID(),
    reservation = randomUUID();
  await col('card_plans').insertOne({ _id: plan, code: 'GOLD' });
  await col('card_sales').insertMany([
    {
      _id: sale,
      customer_id: created.id,
      plan_id: plan,
      seller_staff_id: actor,
      status: 'payment_in_progress',
      cash_price_snapshot: '100000.01',
      reservation_fee_snapshot: '10000.00',
      required_initial_snapshot: '30000.00',
      created_at: '2026-10-01T00:00:00.000Z',
    },
    {
      _id: randomUUID(),
      customer_id: created.id,
      status: 'cancelled',
      cash_price_snapshot: '999999.00',
    },
  ]);
  await col('reservation_agreements').insertOne({
    _id: reservation,
    customer_id: created.id,
    plan_id: plan,
    seller_staff_id: actor,
    status: 'submitted',
    sale_id: null,
    total_price_snapshot: '50000.02',
    reservation_fee_snapshot: '10000.00',
    required_initial_snapshot: '10000.00',
    created_at: '2026-10-02T00:00:00.000Z',
  });
  await col('payments').insertMany([
    { _id: randomUUID(), sale_id: sale, status: 'verified', amount: '30000.01' },
    { _id: randomUUID(), reservation_id: reservation, status: 'verified', amount: '10000.02' },
    { _id: randomUUID(), sale_id: sale, status: 'recorded', amount: '999999.00' },
    { _id: randomUUID(), sale_id: sale, status: 'voided', amount: '999999.00' },
  ]);
  const response = await call('GET', '', undefined, {
    payment: 'partially_paid',
    category: 'DOWN_PAYMENT_COMPLETED',
    tier: 'GOLD',
    seller: actor,
  });
  expect(response.status).toBe(200);
  expect(response.body).toMatchObject({
    meta: { total: 1 },
    data: [
      {
        id: created.id,
        frozenTotal: '150000.03',
        verifiedPaid: '40000.03',
        openReservationTotal: '50000.02',
        openReservationPaid: '10000.02',
      },
    ],
  });
  expect((await call('GET', '', undefined, { limit: 1, offset: 1 })).body).toMatchObject({
    meta: { total: 2 },
    data: [expect.anything()],
  });
});
it('rejects duplicate/invalid registration atomically and does not burn company serials or leak IDs to audit', async () => {
  const before = await test.db.collection('customers').countDocuments();
  expect((await call('POST', '', input('one'))).status).toBe(409);
  expect((await call('POST', '', { ...input('bad'), dateOfBirth: '2999-01-01' })).status).toBe(400);
  expect(await test.db.collection('customers').countDocuments()).toBe(before);
  const results = await Promise.all(
    ['parallel-a', 'parallel-b'].map((value) => call('POST', '', input(value))),
  );
  expect(results.map((value) => value.status)).toEqual([201, 201]);
  expect(new Set(results.map((value) => customerSchema.parse(value.body).raNumber)).size).toBe(2);
});
