import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { bulkCommissionRuleResultSchema, commissionRosterSchema } from '@afhomes/contracts';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';

let test: Awaited<ReturnType<typeof createTestReplica>>,
  server: http.Server,
  base = '',
  cookie = '';
type Doc = { _id: string } & Record<string, unknown>;
const today = new Date().toISOString().slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const ids = { ostRole: randomUUID(), seller: randomUUID(), idle: randomUUID(), clerk: randomUUID() };

async function request(path: string, body?: unknown, method?: string, session = cookie) {
  return fetch(`${base}/api/v1${path}`, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
      ...(session ? { Cookie: session } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const roster = async (query = '') =>
  commissionRosterSchema.parse(await (await request(`/commissions/rules/roster${query}`)).json());
const member = async (id: string) => (await roster('?limit=100')).members.find((m) => m.id === id)!;

beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    BETTER_AUTH_SECRET: 'roster-fixture-only-random-secret-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_WEB_URL: base,
  };
  const fixture = await seedPhase5Fixture(test.db, test.client, env);
  const assignment = await test.db
    .collection('staff_role_assignments')
    .findOne({ staff_id: fixture.staff.id });
  await test.db
    .collection('roles')
    .updateOne({ _id: assignment!.role_id }, { $set: { slug: 'super_admin', is_system: true } });
  await test.db
    .collection('staff_users')
    .updateOne({ email: fixture.staff.email }, { $set: { must_change_password: false } });
  await test.db.collection('mfa_policy').updateOne({ key: 'admin_mfa_required' }, { $set: { value: false } });
  await test.db
    .collection<{ _id: string; key: string; is_active: boolean }>('modules')
    .insertOne({ _id: randomUUID(), key: 'network.commissions', is_active: true });

  const clerkRole = randomUUID();
  await test.db.collection<Doc>('roles').insertMany([
    { _id: ids.ostRole, slug: 'ost', name: 'OST' },
    { _id: clerkRole, slug: 'finance_clerk', name: 'Finance Clerk' },
  ]);
  const person = (_id: string, full_name: string) => ({
    _id,
    full_name,
    email: `${_id}@example.invalid`,
    status: 'active',
    created_at: '2026-01-01T00:00:00.000Z',
  });
  await test.db
    .collection<Doc>('staff_users')
    .insertMany([person(ids.seller, 'Ana Seller'), person(ids.idle, 'Ben Idle'), person(ids.clerk, 'Cy Clerk')]);
  await test.db.collection<Doc>('staff_role_assignments').insertMany([
    { _id: randomUUID(), staff_id: ids.seller, role_id: ids.ostRole },
    { _id: randomUUID(), staff_id: ids.idle, role_id: ids.ostRole },
    { _id: randomUUID(), staff_id: ids.clerk, role_id: clerkRole },
  ]);
  await test.db.collection<Doc>('card_sales').insertMany(
    [
      ['submitted', '2026-05-01T00:00:00.000Z'],
      ['payment_verified', '2026-05-09T00:00:00.000Z'],
      ['cancelled', '2026-05-20T00:00:00.000Z'],
    ].map(([status, created_at], index) => ({
      _id: randomUUID(),
      sale_number: `AF-ROSTER-${index}`,
      customer_id: randomUUID(),
      plan_id: randomUUID(),
      seller_staff_id: ids.seller,
      status,
      created_at,
    })),
  );

  server.on('request', createMongoPhase5Runtime(test.db, test.client, env));
  const login = await request(
    '/auth/identity/sign-in/email',
    { email: fixture.staff.email, password: fixture.staff.password },
    undefined,
    '',
  );
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
}, 120_000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  await test?.stop();
});

it('lists sellers with sales activity, skipping cancelled sales and non-selling roles', async () => {
  const result = await roster('?limit=100');
  const seller = result.members.find((m) => m.id === ids.seller)!;
  expect(seller).toMatchObject({
    name: 'Ana Seller',
    positionSlug: 'ost',
    salesCount: 2,
    source: 'none',
    rate: '0',
    ruleId: null,
  });
  expect(seller.lastSaleAt).toContain('2026-05-09');
  expect(result.members.some((m) => m.id === ids.clerk)).toBe(false);
  // The seeded super admin also sells, so count from the full list.
  expect(result.needsRateCount).toBe(
    result.members.filter((m) => m.salesCount > 0 && m.source === 'none').length,
  );
  expect(result.positions.find((p) => p.slug === 'ost')).toMatchObject({
    memberCount: 2,
    defaultRate: null,
  });
  // Most sales first.
  const counts = result.members.map((m) => m.salesCount);
  expect(counts).toEqual([...counts].sort((a, b) => b - a));
});

it('filters by sales activity, position, search and needs-a-rate', async () => {
  expect((await roster('?sales=with&position=ost')).members.map((m) => m.id)).toEqual([ids.seller]);
  expect((await roster('?sales=without&position=ost')).members.map((m) => m.id)).toEqual([ids.idle]);
  expect((await roster('?search=ben')).members.map((m) => m.id)).toEqual([ids.idle]);
  expect((await roster('?needsRate=true&position=ost')).members.map((m) => m.id)).toEqual([ids.seller]);
  expect((await request('/commissions/rules/roster?limit=500')).status).toBe(400);
});

it('shows the position default as the applied rate, and clears the needs-a-rate flag', async () => {
  const created = await request('/commissions/rules', {
    targetType: 'role',
    targetId: ids.ostRole,
    rate: '0.0400',
    effectiveFrom: yesterday,
  });
  expect(created.status).toBe(201);
  expect(await member(ids.seller)).toMatchObject({ source: 'position', rate: '0.0400' });
  const after = await roster('?needsRate=true&position=ost');
  expect(after.members).toEqual([]);
  expect(after.positions.find((p) => p.slug === 'ost')).toMatchObject({ defaultRate: '0.0400' });
  const rules = await (await request('/commissions/rules')).json();
  expect(rules.data[0].targetName).toBe('OST');
});

it('sets personal rates in bulk, end-dating or replacing existing personal rules', async () => {
  const old = randomUUID();
  await test.db.collection<Doc>('commission_rules').insertOne({
    _id: old,
    target_type: 'staff',
    target_id: ids.seller,
    rate: '0.0500',
    effective_from: '2026-01-01',
    effective_until: null,
    accredited_on_or_after: null,
    is_active: true,
  });
  const first = await request('/commissions/rules/bulk', {
    memberIds: [ids.seller, ids.idle],
    rate: '0.0700',
    effectiveFrom: today,
  });
  expect(first.status).toBe(200);
  expect(bulkCommissionRuleResultSchema.parse(await first.json())).toEqual({ created: 2, replaced: 1 });
  expect(await test.db.collection('commission_rules').findOne({ _id: old as never })).toMatchObject({
    is_active: true,
    effective_until: yesterday,
  });
  expect(await member(ids.seller)).toMatchObject({ source: 'custom', rate: '0.0700' });
  expect(await member(ids.idle)).toMatchObject({ source: 'custom', rate: '0.0700' });

  // Same start date again: the earlier same-day rule is disabled, not stacked.
  const second = await request('/commissions/rules/bulk', {
    memberIds: [ids.seller],
    rate: '0.0800',
    effectiveFrom: today,
  });
  expect(bulkCommissionRuleResultSchema.parse(await second.json())).toEqual({ created: 1, replaced: 1 });
  expect(await member(ids.seller)).toMatchObject({ rate: '0.0800' });
  expect(
    await test.db
      .collection('commission_rules')
      .countDocuments({ target_type: 'staff', target_id: ids.seller as never, is_active: true, effective_until: null }),
  ).toBe(1);
  expect(
    await test.db.collection('audit_events').countDocuments({
      entity_type: 'commission_rule',
      action: 'COMMISSION_RULE_CREATED',
      reason: 'Bulk rate',
    }),
  ).toBe(3);
});

it('rejects a bulk request atomically when any member cannot take a rate', async () => {
  const before = await test.db.collection('commission_rules').countDocuments();
  for (const memberIds of [[ids.idle, randomUUID()], [ids.idle, ids.clerk]]) {
    const response = await request('/commissions/rules/bulk', {
      memberIds,
      rate: '0.0900',
      effectiveFrom: today,
    });
    expect(response.status).toBe(409);
  }
  expect(
    (await request('/commissions/rules/bulk', { memberIds: [ids.idle, ids.idle], rate: '0.09', effectiveFrom: today }))
      .status,
  ).toBe(400);
  expect(
    (await request('/commissions/rules/bulk', { memberIds: [ids.idle], rate: '0.09', effectiveFrom: '2026-02-31' }))
      .status,
  ).toBe(400);
  expect(await test.db.collection('commission_rules').countDocuments()).toBe(before);
});

it('requires an authenticated commissions manager', async () => {
  expect((await request('/commissions/rules/roster', undefined, undefined, '')).status).toBe(401);
  expect(
    (await request('/commissions/rules/bulk', { memberIds: [ids.idle], rate: '0.09', effectiveFrom: today }, 'POST', ''))
      .status,
  ).toBe(401);
});
