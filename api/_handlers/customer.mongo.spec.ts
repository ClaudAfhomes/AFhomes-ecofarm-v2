import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import {
  customerProfileSchema,
  customerMembershipSchema,
  customerPaymentSchema,
} from '@afhomes/contracts';
import { createTestReplica } from '../_lib/testing/mongo-replica.js';
import {
  createCustomerActivation,
  setupCustomerActivation,
  type MongoRow,
} from '../_lib/customer-activation.mongo.js';
import { createAfHomesAuth } from '../_lib/auth.js';
import { createMongoCustomerHandlers } from '../_lib/customer-handlers.mongo.js';
import { makeRes } from '../_lib/testing/supabase-fake.js';
import { toErrorEnvelope } from '../_lib/envelope.js';
import type { VercelRequest } from '../_lib/http.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
let handlers: ReturnType<typeof createMongoCustomerHandlers>;
let cookie = '';
let permit = false;
let server: http.Server;
let portalUrl = '';
const customerId = randomUUID(),
  otherId = randomUUID(),
  saleId = randomUUID(),
  membershipId = randomUUID();
const env = {
  BETTER_AUTH_SECRET: 'phase5-loopback-fixture-only-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
  AFHOMES_WEB_URL: 'http://localhost:5173',
};
beforeAll(async () => {
  test = await createTestReplica();
  await setupCustomerActivation(test.db);
  const col = (name: string) => test.db.collection<MongoRow>(name);
  await col('customers').insertMany([
    {
      _id: customerId,
      customer_number: 'AF-CUS-LOCAL',
      first_name: 'SYNTHETIC',
      last_name: 'OWNER',
      email: 'phase5-owner@example.invalid',
      status: 'active',
      auth_user_id: null,
      phone: '+639171234567',
      government_id_number: 'PRIVATE-ID',
      tin_number: 'PRIVATE-TIN',
      notes: 'PRIVATE-NOTES',
    },
    {
      _id: otherId,
      customer_number: 'AF-CUS-OTHER',
      first_name: 'OTHER',
      last_name: 'OWNER',
      email: 'other@example.invalid',
      status: 'active',
    },
  ]);
  const productId = randomUUID();
  await col('card_plans').insertOne({ _id: productId, name: 'Bronze', code: 'BRONZE' });
  await col('memberships').insertOne({
    _id: membershipId,
    customer_id: customerId,
    sale_id: saleId,
    product_id: productId,
    status: 'active',
    membership_number: 'SYNTHETIC-CARD',
    points_balance: 42,
    yearly_points_allocated: 1000,
    activated_at: '2026-01-01T00:00:00.000Z',
    expires_at: '2027-01-01T00:00:00.000Z',
    qr_token_hash: 'PRIVATE-HASH',
  });
  await col('card_sales').insertOne({
    _id: saleId,
    customer_id: customerId,
    payment_scheme: 'spot_cash',
    validity_months_snapshot: 12,
  });
  await col('points_accounts').insertOne({
    _id: randomUUID(),
    membership_id: membershipId,
    balance: 42,
    lifetime_allocated: 1000,
    lifetime_redeemed: 958,
    updated_at: '2026-10-25T00:00:00.000Z',
  });
  await col('payments').insertMany([
    {
      _id: randomUUID(),
      sale_id: saleId,
      payment_number: 'LOCAL-PAY',
      amount: '100000.00',
      payment_type: 'spot_cash',
      method: 'cash',
      status: 'verified',
      recorded_at: '2026-10-25T00:00:00.000Z',
      notes: 'PRIVATE-NOTES',
      receipt_path: 'PRIVATE-PATH',
      verified_by: 'PRIVATE-ACTOR',
    },
    {
      _id: randomUUID(),
      sale_id: randomUUID(),
      amount: '99999.00',
      method: 'cash',
      status: 'verified',
      payment_number: 'OTHER-PAYMENT',
    },
  ]);
  const activation = createCustomerActivation(test.db, test.client, env);
  const issued = await activation.issue(customerId, randomUUID());
  await activation.redeem({
    onboardingToken: new URL(issued.activationUrl).hash.slice(7),
    password: 'SyntheticCustomerPassword123',
    passwordConfirmation: 'SyntheticCustomerPassword123',
  });
  const auth = createAfHomesAuth(test.db, test.client, env);
  const response = await auth.api.signInEmail({
    body: { email: 'phase5-owner@example.invalid', password: 'SyntheticCustomerPassword123' },
    asResponse: true,
  });
  expect(response.status).toBe(200);
  cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  handlers = createMongoCustomerHandlers(test.db, test.client, {
    env,
    getIdentity: async (headers) => (await auth.api.getSession({ headers }))?.user ?? null,
    authorizeStaff: async () =>
      permit
        ? { userId: randomUUID() }
        : { error: toErrorEnvelope('FORBIDDEN', 'Insufficient permission', 403) },
  });
  server = http.createServer(async (req, res) => {
    const response = makeRes();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const query = Object.fromEntries(url.searchParams);
    await handlers.portal(
      {
        method: req.method,
        headers: req.headers,
        query: { ...query, familyPath: url.pathname.slice(1) },
      } as VercelRequest,
      response.res,
    );
    res.writeHead(response.state.status, response.state.headers);
    res.end(JSON.stringify(response.state.body));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  portalUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 120_000);
afterAll(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  await test?.stop();
});
async function portal(path = '', query: Record<string, string> = {}, sessionCookie = cookie) {
  const res = makeRes();
  await handlers.portal(
    {
      method: 'GET',
      headers: { cookie: sessionCookie },
      query: { familyPath: path, ...query },
    } as VercelRequest,
    res.res,
  );
  return res.state;
}

it('reads the persisted owner profile after login and refresh without exposing sensitive fields', async () => {
  const profile = await portal('', { customerId: otherId });
  expect(profile.status).toBe(200);
  expect(customerProfileSchema.parse(profile.body).id).toBe(customerId);
  expect(JSON.stringify(profile.body)).not.toContain('PRIVATE');
  expect((await portal()).body).toEqual(profile.body);
  expect((await portal('', {}, '')).status).toBe(401);
});
it('uses the real cookie session over loopback HTTP and preserves the same profile on reload', async () => {
  const first = await fetch(`${portalUrl}/?customerId=${otherId}`, { headers: { Cookie: cookie } });
  expect(first.status).toBe(200);
  expect(first.headers.get('Cache-Control')).toBe('no-store');
  expect(customerProfileSchema.parse(await first.json()).id).toBe(customerId);
  const reloaded = await fetch(`${portalUrl}/`, { headers: { Cookie: cookie } });
  expect(customerProfileSchema.parse(await reloaded.json()).id).toBe(customerId);
  expect((await fetch(`${portalUrl}/`)).status).toBe(401);
});
it('returns only safe membership/points/payment fields for the current owner', async () => {
  const membership = await portal('membership');
  expect(membership.status).toBe(200);
  expect(customerMembershipSchema.parse(membership.body).id).toBe(membershipId);
  expect(JSON.stringify(membership.body)).not.toContain('PRIVATE');
  const points = await portal('points');
  expect(points.body).toMatchObject({
    membershipId,
    balance: 42,
    lifetimeAllocated: 1000,
    lifetimeRedeemed: 958,
  });
  const payments = await portal('payments');
  const body = payments.body as { data: unknown[] };
  expect(body.data).toHaveLength(1);
  expect(customerPaymentSchema.parse(body.data[0]).paymentNumber).toBe('LOCAL-PAY');
  expect(JSON.stringify(payments.body)).not.toMatch(/PRIVATE|OTHER-PAYMENT/);
  expect((await portal('refunds')).status).toBe(404);
  expect((await portal('redemptions')).status).toBe(404);
});
it('rechecks suspension and ownership on each request', async () => {
  await test.db
    .collection('customers')
    .updateOne({ customer_number: 'AF-CUS-LOCAL' }, { $set: { status: 'suspended' } });
  expect((await portal()).status).toBe(200);
  expect((await portal('membership')).status).toBe(403);
  expect((await portal('points')).status).toBe(403);
  expect((await portal('payments')).status).toBe(403);
  await test.db
    .collection('customers')
    .updateOne(
      { customer_number: 'AF-CUS-LOCAL' },
      { $set: { status: 'active' }, $unset: { auth_user_id: '' } },
    );
  expect((await portal()).status).toBe(403);
});
it('denies unauthorised token issuance and hostile-origin mutation without changing tokens', async () => {
  const before = await test.db.collection('customer_onboarding_tokens').countDocuments();
  const call = async (origin: string) => {
    const res = makeRes();
    await handlers.staffToken(
      {
        method: 'POST',
        headers: { origin },
        query: { familyPath: `${otherId}/onboarding-token` },
      } as VercelRequest,
      res.res,
    );
    return res.state;
  };
  expect((await call('http://localhost:3000')).status).toBe(403);
  permit = true;
  expect((await call('https://hostile.example.invalid')).status).toBe(403);
  expect(await test.db.collection('customer_onboarding_tokens').countDocuments()).toBe(before);
});
