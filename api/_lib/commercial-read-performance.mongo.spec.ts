import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { createMongoSalesHandler } from './sales.mongo.js';
import { createMongoQueuesHandler } from './queues.mongo.js';
import { makeRes } from './testing/supabase-fake.js';
import type { AfHomesPrincipal, authorizeAfHomes } from './afhomes-access.js';
import type { MongoRow } from './handler-kit.mongo.js';

let replica: Awaited<ReturnType<typeof createTestReplica>>;
const actor = randomUUID(), plan = randomUUID(), anchor = randomUUID();
const principal = { userId: actor, roleSlug: 'super_admin', permissions: [] } as unknown as AfHomesPrincipal;
const authorize: typeof authorizeAfHomes = async () => principal;
const commands: Record<string, number> = {};
const col = (name: string) => replica.db.collection<MongoRow>(name);
async function call(kind: 'sales' | 'queue', path = '', query: Record<string, string> = {}) {
  const response = makeRes();
  for (const key of Object.keys(commands)) delete commands[key];
  const handler = kind === 'sales'
    ? createMongoSalesHandler(replica.db, replica.client, authorize, {})
    : createMongoQueuesHandler(replica.db, authorize);
  await handler({ method: 'GET', headers: {}, query: { familyPath: path, ...query } } as never, response.res);
  return { ...response.state, counts: { ...commands } };
}
beforeAll(async () => {
  const options = { timeoutMS: 15_000, monitorCommands: true };
  replica = await createTestReplica(options);
  replica.client.on('commandStarted', event => {
    if (['find', 'aggregate', 'getMore', 'count'].includes(event.commandName)) {
      const key = `${event.commandName}:${event.command[event.commandName]}`;
      commands[key] = (commands[key] ?? 0) + 1;
    }
  });
  await col('staff_users').insertOne({ _id: actor, full_name: 'SYNTHETIC SELLER', email: 'private@example.invalid' });
  await col('card_plans').insertOne({ _id: plan, name: 'Synthetic Plan', code: 'SYNTHETIC' });
  for (let i = 0; i < 50; i++) {
    const customer = randomUUID(), sale = i === 0 ? anchor : randomUUID();
    await col('customers').insertOne({ _id: customer, first_name: 'Synthetic', last_name: `Customer ${i}`, government_id_number: 'PRIVATE-IDENTITY-MARKER' });
    await col('card_sales').insertOne({ _id: sale, sale_number: `SYNTHETIC-SALE-${i}`, origin: 'normal', customer_id: customer, plan_id: plan, seller_staff_id: actor, status: 'payment_pending', cash_price_snapshot: '100000.00', minimum_down_payment_snapshot: '10000.00', created_at: '2026-11-01T00:00:00.000Z' });
    await col('payments').insertMany(Array.from({ length: i === 0 ? 200 : 3 }, (_, n) => ({
      _id: randomUUID(), sale_id: sale, customer_id: customer, amount: n % 3 === 0 ? '1.01' : '999.99',
      status: n % 3 === 0 ? 'verified' : n % 3 === 1 ? 'recorded' : 'rejected',
      recorded_by: actor, verified_by: n % 3 === 0 ? actor : null, recorded_at: `2026-11-01T00:00:${String(n % 60).padStart(2, '0')}.000Z`,
      method: 'cash', payment_type: 'partial',
    })));
  }
  for (let i = 0; i < 20; i++) {
    const customer = (await col('customers').findOne({}))!._id, application = randomUUID(), reservation = randomUUID();
    await col('customer_applications').insertOne({ _id: application, application_number: `SYNTHETIC-APP-${i}`, status: 'approved' });
    await col('reservation_agreements').insertOne({ _id: reservation, origin: 'application', status: 'executed', sale_id: null, customer_id: customer, customer_application_id: application, reservation_number: `SYNTHETIC-RES-${i}`, seller_staff_id: actor, tier_snapshot: 'GOLD', total_price_snapshot: '100000.00', required_initial_snapshot: '10000.00' });
    await col('payments').insertOne({ _id: randomUUID(), reservation_id: reservation, amount: '2.01', status: 'verified' });
  }
}, 30_000);
afterAll(async () => replica?.stop());

it('enriches a 50-sale page with bounded queries while preserving verified totals and privacy', async () => {
  const response = await call('sales', '', { limit: '50' });
  expect(response.status).toBe(200);
  const body = response.body as { data: { id: string; paidAmount: string; balance: string; sellerName: string }[]; meta: { total: number } };
  expect(body.data).toHaveLength(50);
  expect(body.meta.total).toBe(50);
  for (const sale of body.data) {
    expect(sale.paidAmount).toBe(sale.id === anchor ? '67.67' : '1.01');
    expect(sale.balance).toBe(sale.id === anchor ? '99932.33' : '99998.99');
    expect(sale.sellerName).toBe('SYNTHETIC SELLER');
  }
  expect(JSON.stringify(body)).not.toMatch(/PRIVATE-IDENTITY-MARKER|private@example/);
  const count = Object.values(response.counts).reduce((a, n) => a + n, 0);
  console.log(`Sales page command count: ${count}`);
  expect(count).toBeLessThanOrEqual(8);
});
it('loads a 200-payment history without a staff lookup for each payment', async () => {
  const response = await call('sales', `${anchor}/payments`);
  expect(response.status).toBe(200);
  const body = response.body as { data: { status: string; recordedByName: string; verifiedByName: string | null }[] };
  expect(body.data).toHaveLength(200);
  for (const payment of body.data) {
    expect(payment.recordedByName).toBe('SYNTHETIC SELLER');
    expect(payment.verifiedByName).toBe(payment.status === 'verified' ? 'SYNTHETIC SELLER' : null);
  }
  console.log(`Payment history staff queries: ${response.counts['find:staff_users']}`);
  expect(response.counts['find:staff_users']).toBeLessThanOrEqual(1);
});
it('counts and pages the Finance queue without repeating joined pipelines or seller reads', async () => {
  const response = await call('queue', 'finance', { limit: '100' });
  expect(response.status).toBe(200);
  const body = response.body as { data: Record<string, unknown>[]; meta: { total: number } };
  expect(body.meta.total).toBe(70);
  expect(body.data).toHaveLength(70);
  expect(body.data.filter(x => x.origin === 'reservation')).toHaveLength(20);
  expect(body.data.filter(x => x.origin === 'reservation').every(x => x.verifiedTotal === '2.01' && x.sellerName === 'SYNTHETIC SELLER')).toBe(true);
  console.log(`Finance queue commands: ${JSON.stringify(response.counts)}`);
  expect((response.counts['aggregate:card_sales'] ?? 0) + (response.counts['aggregate:reservation_agreements'] ?? 0)).toBeLessThanOrEqual(2);
  expect(response.counts['find:staff_users']).toBeLessThanOrEqual(1);
  const page = await call('queue', 'finance', { limit: '5', offset: '3' });
  expect((page.body as typeof body).data).toEqual(body.data.slice(3, 8));
  expect((page.body as typeof body).meta.total).toBe(70);
});

it('preserves search, orphan exclusion, deep pages and activation filtering', async () => {
  const customer = (await col('customers').findOne({}))!._id;
  const orphanIds: string[] = [randomUUID(), randomUUID()];
  await col('card_sales').insertMany([
    { _id: orphanIds[0], customer_id: randomUUID(), plan_id: plan, status: 'payment_pending' },
    { _id: orphanIds[1], customer_id: customer, plan_id: randomUUID(), status: 'payment_pending' },
  ]);
  try {
    const all = await call('queue', 'finance', { limit: '100' });
    const body = all.body as { data: Record<string, unknown>[]; meta: { total: number } };
    expect(body.meta.total).toBe(70);
    expect(body.data.some(row => orphanIds.includes(String(row.saleId)))).toBe(false);
    const searched = await call('queue', 'finance', { search: 'SYNTHETIC-APP-1', limit: '100' });
    const matches = body.data.filter(row => String(row.applicationNumber).includes('SYNTHETIC-APP-1'));
    expect((searched.body as typeof body).data).toEqual(matches);
    expect((searched.body as typeof body).meta.total).toBe(matches.length);
    const deep = await call('queue', 'finance', { offset: '1001' });
    expect((deep.body as typeof body).data).toEqual([]);
    expect((deep.body as typeof body).meta.total).toBe(70);
    expect((await call('queue', 'activation')).body).toMatchObject({ data: [], meta: { total: 0 } });
    await col('card_sales').updateOne({ _id: anchor }, { $set: { status: 'payment_verified', cash_price_snapshot: '67.67' } });
    const activation = await call('queue', 'activation');
    expect(activation.status).toBe(200);
    expect(activation.body).toMatchObject({ data: [{ saleId: anchor, activatable: true }], meta: { total: 1 } });
  } finally {
    await col('card_sales').deleteMany({ _id: { $in: orphanIds } });
    await col('card_sales').updateOne({ _id: anchor }, { $set: { status: 'payment_pending', cash_price_snapshot: '100000.00' } });
  }
});
