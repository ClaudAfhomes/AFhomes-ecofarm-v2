import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { mongoCustomerDirectory } from './customer-directory.mongo.js';
import type { MongoRow } from './customer-activation.mongo.js';
import { hashIdentifier, normalizeIdentifier } from './identifier.js';

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

it('narrows search before enrichment without changing which customers match', async () => {
  const customers = replica.db.collection<MongoRow>('customers');
  const source = await customers.findOne({ _id: customerId });
  const make = (extra: Record<string, unknown>) => ({
    ...source!, _id: randomUUID(), customer_number: `SEARCH-${randomUUID()}`, customer_code: null,
    ra_number: null, email: `${randomUUID()}@example.invalid`, created_at: '2022-01-01T00:00:00.000Z', ...extra,
  });
  const spanning = make({ first_name: 'Ana', middle_name: 'Luz', last_name: 'Dela Cruz', suffix: 'Jr' });
  const carded = make({ first_name: 'Card', middle_name: null, last_name: 'Holder', suffix: null });
  const second = make({ first_name: 'Second', middle_name: null, last_name: 'Card', suffix: null });
  const aliased = make({ first_name: 'Alias', middle_name: null, last_name: 'Owner', suffix: null });
  await customers.insertMany([spanning, carded, second, aliased]);
  const memberships = replica.db.collection<MongoRow>('memberships');
  await memberships.insertMany([
    { _id: randomUUID(), customer_id: carded._id, status: 'active', fallback_code_hash: hashIdentifier(normalizeIdentifier('AFH-1A2B-3C4D')), qr_token_hash: hashIdentifier('QrTokenMixedCase+/=') },
    { _id: randomUUID(), customer_id: second._id, status: 'expired', fallback_code_hash: hashIdentifier(normalizeIdentifier('AFH-9F9F-9F9F')), qr_token_hash: hashIdentifier('second-qr') },
  ]);
  await replica.db.collection<MongoRow>('business_id_aliases').insertMany([
    { _id: randomUUID(), entity_type: 'customer', entity_id: aliased._id, is_active: true, old_identifier: 'OLD-CUS-777' },
    { _id: randomUUID(), entity_type: 'customer', entity_id: spanning._id, is_active: false, old_identifier: 'OLD-CUS-888' },
  ]);
  const ids = async (search: string) =>
    (await mongoCustomerDirectory(replica.db, { search, limit: 50 })).rows.map((row) => row.id);
  expect(await ids('luz dela cruz jr')).toEqual([spanning._id]);
  expect(await ids('ANA LUZ')).toEqual([spanning._id]);
  expect(await ids('afh 1a2b3c4d')).toEqual([carded._id]);
  expect(await ids('QrTokenMixedCase+/=')).toEqual([carded._id]);
  expect(await ids('qrtokenmixedcase+/=')).toEqual([]);
  // Card searches still find non-active memberships, as before the prefilter.
  expect(await ids('afh-9f9f-9f9f')).toEqual([second._id]);
  expect(await ids('second-qr')).toEqual([second._id]);
  expect(await ids('AFH-0000-0000')).toEqual([]);
  expect(await ids('old-cus-777')).toEqual([aliased._id]);
  expect(await ids('OLD-CUS-888')).toEqual([]);
  expect(await ids('.*')).toEqual([]);
  expect(await ids(String(carded.email).toUpperCase())).toEqual([carded._id]);
  const paged = await mongoCustomerDirectory(replica.db, { search: 'Synthetic', limit: 7, offset: 21 });
  expect(paged.total).toBe(26);
  expect(paged.rows).toHaveLength(5);
});

it('treats unsupported sort keys, including inherited object names, as the default order', async () => {
  const reference = await mongoCustomerDirectory(replica.db, { limit: 10, offset: 3 });
  for (const sort of ['toString', 'constructor', '__proto__', 'hasOwnProperty', 'valueOf', 'bogus'])
    expect(await mongoCustomerDirectory(replica.db, { sort, limit: 10, offset: 3 }), sort).toEqual(
      reference,
    );
});

it('serves pages unaffected by malformed off-page data while still failing when it is evaluated', async () => {
  const customers = replica.db.collection<MongoRow>('customers');
  const source = await customers.findOne({ _id: customerId });
  const before = (await mongoCustomerDirectory(replica.db, { limit: 1 })).total;
  const badId = randomUUID(),
    membershipId = randomUUID();
  await customers.insertOne({
    ...source!, _id: badId, customer_number: 'SYNTHETIC-MALFORMED', customer_code: 'AF-CC-MALFORMED',
    email: 'synthetic-malformed@example.invalid', ra_number: '2021-9999',
    first_name: 'Zzz', last_name: 'Malformed', created_at: '2019-01-01T00:00:00.000Z',
  });
  await replica.db.collection<MongoRow>('memberships').insertOne({
    _id: membershipId, customer_id: badId, status: 'active', expires_at: 'not-a-date',
  });
  try {
    // Name order puts the malformed customer last: the requested page is complete and correct.
    const page = await mongoCustomerDirectory(replica.db, { sort: 'name', limit: 5 });
    expect(page.total).toBe(before + 1);
    expect(page.rows.map((row) => row.id)).not.toContain(badId);
    expect(page.rows).toHaveLength(5);
    // Evaluating the malformed value (on the page, or for a filter that needs it) still fails.
    await expect(
      mongoCustomerDirectory(replica.db, { sort: 'name', limit: 5, offset: before - 2 }),
    ).rejects.toThrow();
    await expect(
      mongoCustomerDirectory(replica.db, { category: 'ACTIVE_VIP', limit: 5 }),
    ).rejects.toThrow();
  } finally {
    await customers.deleteOne({ _id: badId });
    await replica.db.collection<MongoRow>('memberships').deleteOne({ _id: membershipId });
  }
});
