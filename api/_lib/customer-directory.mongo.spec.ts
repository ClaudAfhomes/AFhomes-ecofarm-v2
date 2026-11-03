import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { mongoCustomerDirectory } from './customer-directory.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';

let replica: Awaited<ReturnType<typeof createTestReplica>>;
let customerId: string;
beforeAll(async () => {
  replica = await createTestReplica();
  const fixture = await seedPhase5Fixture(replica.db, replica.client, {
    BETTER_AUTH_SECRET: 'synthetic-directory-pagination'.repeat(3),
    BETTER_AUTH_URL: 'http://localhost:3000',
  });
  customerId = fixture.customer.id;
  const customers = replica.db.collection<MongoRow>('customers');
  await customers.updateOne({ _id: customerId }, { $set: { created_at: '2020-01-01T00:00:00.000Z' } });
  const source = await customers.findOne({ _id: customerId });
  await customers.insertMany(Array.from({ length: 25 }, (_, i) => ({
    ...source!, _id: randomUUID(), customer_number: `SYNTHETIC-DIRECTORY-${i}`,
    customer_code: `AF-CC-${String(i).padStart(8, '0')}`,
    email: `synthetic-directory-${i}@example.invalid`, ra_number: `2021-${1000 + i}`,
    first_name: 'Synthetic', last_name: `Directory ${i}`, created_at: '2021-01-01T00:00:00.000Z',
  })));
}, 30_000);
afterAll(async () => replica?.stop());

it('matches late pagination with exact totals, stable ties, offsets and empty pages', async () => {
  for (const offset of [0, 7, 24, 26]) {
    const page = { limit: 7, offset, sort: 'created' };
    const actual = await mongoCustomerDirectory(replica.db, page);
    // Every fixture name matches: search retains the full pre-pagination enrichment path.
    const reference = await mongoCustomerDirectory(replica.db, { ...page, search: 'Synthetic' });
    expect(actual).toEqual(reference);
    expect(actual.total).toBe(26);
  }
  expect(await mongoCustomerDirectory(replica.db, { status: 'cancelled' })).toEqual({ total: 0, rows: [] });
});

it('enriches a paged detail and applies financial/member filters and sorts before pagination', async () => {
  const detail = await mongoCustomerDirectory(replica.db, { id: customerId });
  expect(detail.total).toBe(1);
  expect(detail.rows[0]).toMatchObject({ id: customerId, verified_paid: '100000.00', payment_status: 'fully_paid', derivedCategory: 'ACTIVE_VIP' });
  for (const filter of [{ payment: 'fully_paid' }, { activeVipOnly: true }, { sort: 'verified_paid' }]) {
    const result = await mongoCustomerDirectory(replica.db, { ...filter, limit: 1 });
    expect(result.rows[0]?.id).toBe(customerId);
    expect(result.rows[0]?.verified_paid).toBe('100000.00');
    expect(result.total).toBe('sort' in filter ? 26 : 1);
  }
});
