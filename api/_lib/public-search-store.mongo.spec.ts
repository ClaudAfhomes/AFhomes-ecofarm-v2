import { randomUUID } from 'node:crypto';
import { MongoClient, type CommandStartedEvent, type Db } from 'mongodb';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { saleTeamLookupSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import type { MongoRow } from './customer-activation.mongo.js';
import {
  manilaToday,
  readMongoAccreditedSaleTeamByNumber,
  readMongoSaleTeam,
  setupMongoSaleTeam,
} from './sale-team.mongo.js';
import { createMongoPublicSearchStore, setupMongoPublicSearch } from './sale-team-search.mongo.js';
import { setupMongoOstAccreditation } from './ost-accreditation.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
let monitored: MongoClient;
let db: Db;
const commands: string[] = [];
const counted = new Set([
  'find',
  'aggregate',
  'update',
  'insert',
  'findAndModify',
  'delete',
  'commitTransaction',
  'abortTransaction',
]);
const col = (name: string) => test.db.collection<MongoRow>(name);

beforeAll(async () => {
  test = await createTestReplica();
  await setupMongoSaleTeam(test.db);
  await setupMongoPublicSearch(test.db);
  await setupMongoOstAccreditation(test.db);
  // Same disposable server; this client only watches how many commands the code under test sends.
  monitored = new MongoClient(test.uri, { monitorCommands: true });
  monitored.on('commandStarted', (event: CommandStartedEvent) => {
    if (counted.has(event.commandName)) commands.push(event.commandName);
  });
  await monitored.connect();
  db = monitored.db('afhomes_dev');
}, 60000);
afterAll(async () => {
  await monitored.close();
  await test.stop();
});
beforeEach(async () => {
  commands.length = 0;
  for (const name of [
    'sale_team_search_attempts',
    'sale_team_search_contacts',
    'sale_team_search_disclosures',
    'public_verification_settings',
    'counters',
  ])
    await col(name).deleteMany({});
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const day = (offset: number) => {
  const date = new Date(`${manilaToday()}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
};
type Term = { status: string; approved_at: string; starts_on: string; expires_on: string; _id?: string };
type Scenario = Partial<{
  kind: 'IST' | 'OST';
  staff: boolean;
  staffStatus: string;
  assign: boolean;
  roleDoc: boolean;
  roleSlug: string;
  roleActive: boolean;
  accStatus: string;
  member: string | null;
  terms: Term[];
}>;
let sequence = 0;
async function seed(o: Scenario = {}) {
  const kind = o.kind ?? 'IST';
  const staffId = randomUUID(),
    roleId = randomUUID();
  const aa = `${kind === 'IST' ? 'AAI' : 'AAO'}2611${String(++sequence).padStart(4, '0')}`;
  await col('sale_team_accreditations').insertOne({
    _id: randomUUID(),
    staff_id: staffId,
    aa_number: aa,
    public_name: 'Synthetic Seller',
    kind,
    status: o.accStatus ?? 'active',
    // An OST row keeps its approved dates as the fallback when no term is found.
    starts_on: kind === 'OST' ? day(-30) : null,
    expires_on: kind === 'OST' ? day(300) : null,
  });
  if (o.staff !== false)
    await col('staff_users').insertOne({
      _id: staffId,
      status: o.staffStatus ?? 'active',
      full_name: 'Synthetic Seller',
    });
  if (o.assign !== false)
    await col('staff_role_assignments').insertOne({
      _id: randomUUID(),
      staff_id: staffId,
      role_id: roleId,
    });
  if (o.roleDoc !== false)
    await col('roles').insertOne({
      _id: roleId,
      slug: o.roleSlug ?? (kind === 'IST' ? 'sales_manager' : 'ost'),
      is_active: o.roleActive ?? true,
    });
  if (o.member !== null && kind === 'OST')
    await col('ost_members').insertOne({
      _id: staffId,
      status: o.member ?? 'active',
      ost_number: `OST-${sequence}`,
    });
  for (const term of o.terms ?? [])
    await col('ost_accreditation_terms').insertOne({
      ...term,
      _id: term._id ?? randomUUID(),
      ost_id: staffId,
    });
  return { staffId, aa };
}

/** The original sequential implementation, kept as an oracle for the single-aggregation read. */
async function legacyRead(staffId: string) {
  const row = await col('sale_team_accreditations').findOne({ staff_id: staffId });
  if (!row) return null;
  const staff = await col('staff_users').findOne({ _id: staffId });
  const assignment = await col('staff_role_assignments').findOne({ staff_id: staffId });
  const role = assignment && (await col('roles').findOne({ _id: String(assignment.role_id) }));
  if (!role || !staff) return null;
  const ost = row.kind === 'OST' ? await col('ost_members').findOne({ _id: staffId }) : null;
  const term =
    row.kind === 'OST'
      ? await col('ost_accreditation_terms').findOne(
          { ost_id: staffId, status: { $in: ['active', 'revoked'] } },
          { sort: { approved_at: -1, _id: -1 } },
        )
      : null;
  const today = manilaToday();
  const inactive =
    staff.status !== 'active' ||
    role.is_active !== true ||
    (row.kind === 'IST' &&
      !['vice_director', 'senior_sales_manager', 'sales_manager'].includes(String(role.slug))) ||
    (row.kind === 'OST' && (role.slug !== 'ost' || ost?.status !== 'active' || !term));
  const status =
    row.status === 'revoked' || term?.status === 'revoked'
      ? 'revoked'
      : inactive
        ? 'inactive'
        : row.kind === 'OST' && String(term?.starts_on) > today
          ? 'not_started'
          : row.kind === 'OST' && String(term?.expires_on) < today
            ? 'expired'
            : 'accredited';
  return saleTeamLookupSchema.parse({
    aaNumber: row.aa_number,
    kind: row.kind,
    fullName: row.public_name,
    status,
    startsOn: (row.kind === 'OST' ? (term?.starts_on ?? row.starts_on) : row.starts_on) ?? null,
    expiresOn: (row.kind === 'OST' ? (term?.expires_on ?? row.expires_on) : row.expires_on) ?? null,
    photoUrl: null,
  });
}

const current: Term = {
  status: 'active',
  approved_at: day(-30),
  starts_on: day(-30),
  expires_on: day(300),
};
const revoked = (approved_at: string): Term => ({
  status: 'revoked',
  approved_at,
  starts_on: day(-100),
  expires_on: day(-10),
});
const scenarios: [string, Scenario, string | null][] = [
  ['IST sales manager', {}, 'accredited'],
  ['IST in a non-sales role', { roleSlug: 'cashier' }, 'inactive'],
  ['IST with suspended staff', { staffStatus: 'suspended' }, 'inactive'],
  ['IST with inactive role', { roleActive: false }, 'inactive'],
  ['IST with revoked accreditation', { accStatus: 'revoked' }, 'revoked'],
  ['no role assignment', { assign: false }, null],
  ['missing staff', { staff: false }, null],
  ['assignment to a missing role', { roleDoc: false }, null],
  [
    'IST converted from OST ignores its old revoked term',
    { terms: [revoked(day(-90))] },
    'accredited',
  ],
  ['OST with a current term', { kind: 'OST', terms: [current] }, 'accredited'],
  [
    'OST term not started',
    { kind: 'OST', terms: [{ ...current, starts_on: day(5), expires_on: day(400) }] },
    'not_started',
  ],
  [
    'OST term expired',
    { kind: 'OST', terms: [{ ...current, starts_on: day(-400), expires_on: day(-1) }] },
    'expired',
  ],
  [
    'OST newest term revoked',
    { kind: 'OST', terms: [{ ...current, approved_at: day(-60) }, revoked(day(-5))] },
    'revoked',
  ],
  [
    'OST newest term active over an older revoked one',
    { kind: 'OST', terms: [revoked(day(-90)), current] },
    'accredited',
  ],
  [
    'OST equal approval time resolved by id (active wins)',
    {
      kind: 'OST',
      terms: [
        { ...current, approved_at: day(-30), _id: 'zzz-active' },
        { ...revoked(day(-30)), _id: 'aaa-revoked' },
      ],
    },
    'accredited',
  ],
  [
    'OST equal approval time resolved by id (revoked wins)',
    {
      kind: 'OST',
      terms: [
        { ...current, approved_at: day(-30), _id: 'aaa-active' },
        { ...revoked(day(-30)), _id: 'zzz-revoked' },
      ],
    },
    'revoked',
  ],
  ['OST without a term', { kind: 'OST', terms: [] }, 'inactive'],
  ['OST without a member', { kind: 'OST', member: null, terms: [current] }, 'inactive'],
  [
    'OST without a member but with a revoked term',
    { kind: 'OST', member: null, terms: [revoked(day(-5))] },
    'revoked',
  ],
  ['OST with a suspended member', { kind: 'OST', member: 'suspended', terms: [current] }, 'inactive'],
  ['OST in the wrong role', { kind: 'OST', roleSlug: 'sales_manager', terms: [current] }, 'inactive'],
];

// ---------------------------------------------------------------------------
// Accreditation read: one aggregation, identical answers
// ---------------------------------------------------------------------------
it.each(scenarios)('reads %s exactly like the sequential original', async (_name, scenario, status) => {
  const { staffId, aa } = await seed(scenario);
  const expected = await legacyRead(staffId);
  expect(expected?.status ?? null).toBe(status);
  expect(await readMongoSaleTeam(test.db, staffId)).toEqual(expected);
  expect(await readMongoAccreditedSaleTeamByNumber(test.db, aa)).toEqual(
    status === 'accredited' ? { ...expected, staffId } : null,
  );
});
it('returns nothing for an unknown AA number or staff id', async () => {
  expect(await readMongoAccreditedSaleTeamByNumber(test.db, 'AAI26119999')).toBeNull();
  expect(await readMongoSaleTeam(test.db, randomUUID())).toBeNull();
});
it('reads in one round trip, also inside a transaction', async () => {
  const { aa } = await seed({ kind: 'OST', terms: [current] });
  commands.length = 0;
  expect(await readMongoAccreditedSaleTeamByNumber(db, aa)).toMatchObject({ aaNumber: aa });
  expect(commands).toEqual(['aggregate']);
  const session = monitored.startSession();
  try {
    expect(
      await session.withTransaction(() => readMongoAccreditedSaleTeamByNumber(db, aa, session)),
    ).toMatchObject({ aaNumber: aa, status: 'accredited' });
  } finally {
    await session.endSession();
  }
});
it('builds the latest-term index that also serves revoked terms', async () => {
  const keys = (await col('ost_accreditation_terms').listIndexes().toArray()).map((i) =>
    JSON.stringify(i.key),
  );
  expect(keys).toContain(JSON.stringify({ ost_id: 1, approved_at: -1, _id: -1 }));
});

// ---------------------------------------------------------------------------
// Public search store
// ---------------------------------------------------------------------------
const store = () =>
  createMongoPublicSearchStore(db, monitored, (aaNumber, session) =>
    readMongoAccreditedSaleTeamByNumber(db, aaNumber, session),
  );
const hash = () => randomUUID().replaceAll('-', '') + randomUUID().replaceAll('-', '');
const contactFor = (key = randomUUID()) => ({
  key,
  name: 'Synthetic Viewer',
  email: 'viewer@example.invalid',
  mobile: '+639170000001',
});
const reveal = (
  ipHash: string,
  aaNumber: string,
  extra: Partial<Parameters<ReturnType<typeof store>['revealWithThrottle']>[0]> = {},
) =>
  store().revealWithThrottle({
    ipHash,
    aaNumber,
    requestId: randomUUID(),
    noticeVersion: 'notice-1',
    contact: contactFor(),
    ...extra,
  }) as Promise<Record<string, unknown>>;
const settingsDoc = {
  _id: 'public',
  enabled: true,
  dailyLimitEnabled: true,
  privacyApproved: true,
  cleanupReady: false,
  verificationPhone: '+639604316867',
  retentionDays: 30,
  noticeVersion: 'approved-v1',
  revision: 1,
  updatedAt: '2026-10-22T00:00:00.000Z',
  privacyNotice: 'Synthetic approved notice for a configuration test. '.repeat(5),
};

it('reads settings in at most two commands: none saved is null, saved is reported', async () => {
  commands.length = 0;
  expect(await store().settings()).toBeNull();
  expect(commands.length).toBeLessThanOrEqual(2);
  await col('public_verification_settings').insertOne(settingsDoc);
  commands.length = 0;
  expect(await store().settings()).toMatchObject({
    enabled: true,
    noticeVersion: 'approved-v1',
    cleanupReady: false,
  });
  expect(commands.length).toBeLessThanOrEqual(2);
});

it('counts a valid and an unknown AA number differently and cools an IP down after 20 misses', async () => {
  const { aa } = await seed();
  const ip = hash();
  expect(await store().begin(ip, aa)).toEqual({ allowed: true, retryAfter: 0 });
  expect(await col('sale_team_search_attempts').findOne({ _id: ip })).toMatchObject({
    attempts: 1,
    invalid_attempts: 0,
  });
  const other = hash();
  for (let i = 1; i < 20; i++)
    expect(await store().begin(other, 'AAI26119999')).toEqual({ allowed: true, retryAfter: 0 });
  expect(await store().begin(other, 'AAI26119999')).toEqual({ allowed: false, retryAfter: 300 });
  const cooled = (await store().begin(other, aa)) as { allowed: boolean; retryAfter: number };
  expect(cooled.allowed).toBe(false);
  expect(cooled.retryAfter).toBeGreaterThan(0);
});
it('limits an IP to 30 attempts per minute', async () => {
  const { aa } = await seed();
  const ip = hash();
  for (let i = 0; i < 30; i++) expect(await store().begin(ip, aa)).toMatchObject({ allowed: true });
  expect(await store().begin(ip, aa)).toMatchObject({ allowed: false });
});

it('begin takes five commands and a first reveal takes nine', async () => {
  const { aa } = await seed();
  commands.length = 0;
  await store().begin(hash(), aa);
  expect(commands.length).toBeLessThanOrEqual(5);
  commands.length = 0;
  const first = await reveal(hash(), aa);
  expect(first).toMatchObject({ limited: false });
  // The sequential original needed about 30 for the same work.
  expect(commands.length).toBeLessThanOrEqual(9);
  commands.length = 0;
  await reveal(hash(), aa, { contact: undefined, contactId: first.contactId as string });
  expect(commands.length).toBeLessThanOrEqual(9);
});

it('reveals once, records one disclosure and stores the contact once', async () => {
  const { aa, staffId } = await seed();
  const ip = hash(),
    contact = contactFor(),
    requestId = randomUUID();
  const first = await reveal(ip, aa, { contact, requestId });
  expect(first).toMatchObject({ limited: false, retryAfter: 0 });
  expect(first.result).toMatchObject({ aaNumber: aa, status: 'accredited', staffId });
  expect(typeof first.contactId).toBe('string');
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(1);
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(1);
  // A delivery retry of the same signed flow answers again without a second disclosure.
  const retry = await reveal(ip, aa, { contact, requestId });
  expect(retry).toMatchObject({ limited: false, contactId: first.contactId });
  expect(retry.result).toMatchObject({ aaNumber: aa });
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(1);
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(1);
  expect(await col('sale_team_search_contacts').findOne({ _id: first.contactId as string })).toMatchObject({
    dedupe_key: contact.key,
  });
});
it('reuses a validated contact by id', async () => {
  const { aa } = await seed();
  const first = await reveal(hash(), aa);
  const again = await reveal(hash(), aa, { contact: undefined, contactId: first.contactId as string });
  expect(again).toMatchObject({ limited: false, contactId: first.contactId });
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(1);
});
it('answers null without a disclosure for an unknown or non-accredited number, and counts it as a miss', async () => {
  const revokedOne = await seed({ accStatus: 'revoked' });
  for (const aa of ['AAI26119999', revokedOne.aa]) {
    const ip = hash();
    expect(await reveal(ip, aa)).toMatchObject({ limited: false, result: null });
    expect(await col('sale_team_search_attempts').findOne({ _id: ip })).toMatchObject({
      invalid_attempts: 1,
    });
  }
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(0);
});
it('refuses a stale receipt before it uses any allowance', async () => {
  const { aa } = await seed();
  const ip = hash();
  expect(await reveal(ip, aa, { contact: undefined, contactId: randomUUID() })).toEqual({
    contactMissing: true,
  });
  expect(await col('sale_team_search_attempts').findOne({ _id: ip })).toBeNull();
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(0);
});

it('stops at the third successful disclosure in 24 hours, but still answers a retry', async () => {
  const { aa } = await seed();
  const ip = hash(),
    contact = contactFor();
  const requests = [randomUUID(), randomUUID(), randomUUID()];
  for (const requestId of requests)
    expect(await reveal(ip, aa, { contact, requestId })).toMatchObject({ limited: false });
  const blocked = await reveal(ip, aa, { contact });
  expect(blocked).toMatchObject({ limited: true, result: null });
  expect(blocked.retryAfter as number).toBeGreaterThan(0);
  expect(blocked.retryAfter as number).toBeLessThanOrEqual(86400);
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(3);
  expect(await reveal(ip, aa, { contact, requestId: requests[0]! })).toMatchObject({
    limited: false,
    result: { aaNumber: aa },
  });
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(3);
});
it('lifts the daily limit when an administrator disables it', async () => {
  const { aa } = await seed();
  await col('public_verification_settings').insertOne({ _id: 'public', dailyLimitEnabled: false });
  const ip = hash(),
    contact = contactFor();
  for (let i = 0; i < 4; i++)
    expect(await reveal(ip, aa, { contact })).toMatchObject({ limited: false });
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(4);
});
it('does not count disclosures from other IPs or older than a day', async () => {
  const { aa } = await seed();
  const ip = hash(),
    contact = contactFor();
  const old = new Date(Date.now() - 86400000 - 60000);
  await col('sale_team_search_disclosures').insertMany(
    [1, 2, 3].map(() => ({
      _id: randomUUID(),
      ip_hash: ip,
      request_id: randomUUID(),
      notice_version: 'notice-1',
      disclosed_at: old,
    })),
  );
  await col('sale_team_search_disclosures').insertMany(
    [1, 2, 3].map(() => ({
      _id: randomUUID(),
      ip_hash: hash(),
      request_id: randomUUID(),
      notice_version: 'notice-1',
      disclosed_at: new Date(),
    })),
  );
  expect(await reveal(ip, aa, { contact })).toMatchObject({ limited: false, result: { aaNumber: aa } });
});

it('refuses during a cooldown without saving a new contact or disclosing', async () => {
  const { aa } = await seed();
  const ip = hash();
  await col('sale_team_search_attempts').insertOne({
    _id: ip,
    cooldown_until: Date.now() + 120000,
  });
  const out = await reveal(ip, aa);
  expect(out).toMatchObject({ throttled: true });
  expect(out.retryAfter as number).toBeGreaterThan(0);
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(0);
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(0);
});
it('saves no contact on the miss that trips the cooldown', async () => {
  const ip = hash();
  await col('sale_team_search_attempts').insertOne({
    _id: ip,
    window_started: Date.now(),
    attempts: 19,
    invalid_started: Date.now(),
    invalid_attempts: 19,
    cooldown_until: 0,
  });
  expect(await reveal(ip, 'AAI26119999')).toEqual({ throttled: true, retryAfter: 300 });
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(0);
});
it('refuses the 31st attempt in a minute', async () => {
  const { aa } = await seed();
  const ip = hash();
  await col('sale_team_search_attempts').insertOne({
    _id: ip,
    window_started: Date.now(),
    attempts: 30,
    invalid_started: Date.now(),
    invalid_attempts: 0,
    cooldown_until: 0,
  });
  expect(await reveal(ip, aa)).toMatchObject({ throttled: true });
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(0);
});

it('serializes concurrent reveals of one new contact from different IPs into one record', async () => {
  const { aa } = await seed();
  const contact = contactFor();
  const outcomes = await Promise.all(
    Array.from({ length: 8 }, () => reveal(hash(), aa, { contact })),
  );
  for (const outcome of outcomes) expect(outcome).toMatchObject({ limited: false });
  expect(new Set(outcomes.map((o) => o.contactId)).size).toBe(1);
  expect(await col('sale_team_search_contacts').countDocuments()).toBe(1);
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(8);
});
it('never discloses more than three times for one IP under concurrency', async () => {
  const { aa } = await seed();
  const ip = hash(),
    contact = contactFor();
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, () => reveal(ip, aa, { contact })),
  );
  expect(outcomes.filter((o) => o.limited === false)).toHaveLength(3);
  expect(outcomes.filter((o) => o.limited === true)).toHaveLength(3);
  expect(await col('sale_team_search_disclosures').countDocuments()).toBe(3);
  expect(await col('sale_team_search_attempts').findOne({ _id: ip })).toMatchObject({ attempts: 6 });
});
