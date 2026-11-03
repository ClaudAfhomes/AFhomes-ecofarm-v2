import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, it, expect } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';
import { createMongoDevelopmentHandler } from './mongo-development-access.js';
import type { MongoRow } from './customer-activation.mongo.js';
let test: Awaited<ReturnType<typeof createTestReplica>>,
  fixture: Awaited<ReturnType<typeof seedPhase7Fixture>>,
  server: http.Server,
  base = '',
  cookie = '';
const col = (name: string) => test.db.collection<MongoRow>(name);
const request = (body: unknown, auth = cookie, path = '/earning/adjust') =>
  fetch(base + '/api/v1' + path, {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(auth ? { Cookie: auth } : {}),
    },
    body: JSON.stringify(body),
  });
const adjustment = (amount: number) => ({
  membershipId: fixture.customer.membership,
  amount,
  reason: 'Synthetic reviewed correction',
});
beforeAll(async () => {
  test = await createTestReplica();
  server = http.createServer();
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://localhost:${(server.address() as { port: number }).port}`;
  const env = {
    NODE_ENV: 'test',
    BETTER_AUTH_SECRET: 'synthetic-points-adjustment-only-'.repeat(3),
    BETTER_AUTH_URL: base,
    AFHOMES_AUTH_TRUSTED_ORIGINS: base,
  };
  fixture = await seedPhase7Fixture(test.db, test.client, env, 'SyntheticPoints123!');
  server.on(
    'request',
    createMongoDevelopmentHandler(createMongoPhase5Runtime(test.db, test.client, env), {
      coreWritesEnabled: true,
    }),
  );
  const login = await request(
    { email: fixture.admin.email, password: 'SyntheticPoints123!' },
    '',
    '/auth/identity/sign-in/email',
  );
  expect(login.status).toBe(200);
  cookie = login.headers
    .getSetCookie()
    .map((v) => v.split(';')[0])
    .join('; ');
  expect(
    (
      await request(
        {
          currentPassword: 'SyntheticPoints123!',
          newPassword: 'SyntheticPointsReady123!',
          confirmPassword: 'SyntheticPointsReady123!',
        },
        cookie,
        '/admin/afhomes/session/password',
      )
    ).status,
  ).toBe(200);
}, 30000);
afterAll(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((r) => server.close(() => r()));
  await test?.stop();
});
it('records concurrent corrections in ledger/account/membership without creating cap credit or accounting records', async () => {
  const payments = await col('payments').find().toArray();
  const replies = await Promise.all([request(adjustment(100)), request(adjustment(200))]);
  expect(replies.map((r) => r.status)).toEqual([200, 200]);
  expect(
    await col('points_accounts').findOne({ membership_id: fixture.customer.membership }),
  ).toMatchObject({ balance: 300, reversal_debt: 0, weekday_balance: 210, weekend_balance: 90 });
  expect(await col('memberships').findOne({ _id: fixture.customer.membership })).toMatchObject({
    points_balance: 300,
  });
  const ledger = await col('points_ledger').find({ entry_type: 'adjustment' }).toArray();
  expect(ledger).toHaveLength(2);
  expect(ledger.every((r) => r.counts_toward_cap === false)).toBe(true);
  expect(
    ledger
      .map((r) => [r.amount, r.weekday_delta, r.weekend_delta])
      .sort((a, b) => Number(a[0]) - Number(b[0])),
  ).toEqual([
    [100, 70, 30],
    [200, 140, 60],
  ]);
  expect(await col('payments').find().toArray()).toEqual(payments);
  const correction = await request(adjustment(-50));
  expect(correction.status).toBe(200);
  expect(await correction.json()).toMatchObject({
    amount: -50,
    balanceAfter: 250,
    reversalDebt: 0,
  });
  const lookup = await fetch(base + '/api/v1/memberships/customer-lookup?search=SYNTHETIC', {
    headers: { Cookie: cookie },
  });
  expect(lookup.status).toBe(200);
  expect((await lookup.json()).data).toContainEqual(
    expect.objectContaining({
      totalAvailablePoints: 250,
      weekdayAvailablePoints: 175,
      weekendAvailablePoints: 75,
    }),
  );
});
it('enforces authentication, permission, input, active membership, balance floor and audit rollback', async () => {
  expect((await request(adjustment(10), '')).status).toBe(401);
  expect((await request(adjustment(0))).status).toBe(400);
  expect((await request(adjustment(-301))).status).toBe(409);
  const before = await col('points_accounts').findOne({
    membership_id: fixture.customer.membership,
  });
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'POINTS_ADJUSTED' } },
    validationLevel: 'strict',
  });
  try {
    expect((await request(adjustment(10))).status).toBe(503);
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
  expect(
    await col('points_accounts').findOne({ membership_id: fixture.customer.membership }),
  ).toEqual(before);
  await col('memberships').updateOne(
    { _id: fixture.customer.membership },
    { $set: { status: 'suspended' } },
  );
  expect((await request(adjustment(10))).status).toBe(409);
  await col('memberships').updateOne(
    { _id: fixture.customer.membership },
    { $set: { status: 'active' } },
  );
  const module = await col('modules').findOne({ key: 'operations.redemption' });
  await col('staff_permission_restrictions').insertOne({
    _id: randomUUID(),
    staff_id: fixture.admin.id,
    module_id: module!._id,
    deny_update: true,
  });
  expect((await request(adjustment(10))).status).toBe(403);
});
