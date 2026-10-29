import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  createCustomerActivation,
  setupCustomerActivation,
  type MongoRow,
} from './customer-activation.mongo.js';
import { createAfHomesAuth, createAfHomesAdminAuth } from './auth.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
let activation: ReturnType<typeof createCustomerActivation>;
const password = 'CustomerOwnPassword123';
const actorId = randomUUID();
const env = {
  BETTER_AUTH_SECRET: 'phase5-synthetic-local-only-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
  AFHOMES_WEB_URL: 'http://localhost:5173',
};
beforeAll(async () => {
  test = await createTestReplica();
  await setupCustomerActivation(test.db);
  activation = createCustomerActivation(test.db, test.client, env);
}, 120_000);
afterAll(async () => {
  await test?.stop();
});

async function customer() {
  const id = randomUUID();
  await test.db.collection<Record<string, unknown> & { _id: string }>('customers').insertOne({
    _id: id,
    customer_number: `AF-CUS-${id.slice(0, 5).toUpperCase()}`,
    email: `${id}@example.invalid`,
    first_name: 'SYNTHETIC',
    last_name: 'CUSTOMER',
    phone: '+639171234567',
    status: 'active',
    auth_user_id: null,
  });
  await test.db.collection<Record<string, unknown> & { _id: string }>('memberships').insertOne({
    _id: randomUUID(),
    customer_id: id,
    status: 'active',
    membership_number: 'SYNTHETIC-CARD',
  });
  return id;
}

it('issues a fragment link, stores only a hash, and activates with actual Better Auth login', async () => {
  const id = await customer();
  const issued = await activation.issue(id, actorId);
  const token = new URL(issued.activationUrl).hash.slice('#token='.length);
  expect(new URL(issued.activationUrl).search).toBe('');
  const stored = await test.db
    .collection('customer_onboarding_tokens')
    .findOne({ customer_id: id });
  expect(stored?.token_hash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(stored)).not.toContain(token);
  const result = await activation.redeem({
    onboardingToken: token,
    password,
    passwordConfirmation: password,
  });
  expect(result).toMatchObject({ customerId: id, linkedExistingAuth: false, nextStep: 'sign_in' });
  expect(
    await test.db
      .collection('audit_events')
      .findOne({ action: 'CUSTOMER_ONBOARDING_TOKEN_CONSUMED', entity_id: stored!._id }),
  ).toMatchObject({
    entity_type: 'customer_onboarding_token',
    after_data: { customerId: id, purpose: 'account_activation' },
  });
  const auth = createAfHomesAuth(test.db, test.client, env);
  const login = await auth.api.signInEmail({
    body: { email: result.email, password },
    asResponse: true,
  });
  expect(login.status).toBe(200);
  expect(login.headers.getSetCookie().length).toBeGreaterThan(0);
  expect(await test.db.collection('auth_sessions').countDocuments()).toBeGreaterThan(0);
  await expect(
    activation.redeem({ onboardingToken: token, password, passwordConfirmation: password }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await test.db
      .collection('audit_events')
      .countDocuments({ entity_id: id, action: 'CUSTOMER_ACCOUNT_LINKED' }),
  ).toBe(1);
});

it('rotates old tokens; rejects expiry, wrong purpose and inactive membership without creating identities', async () => {
  const id = await customer();
  const first = await activation.issue(id, actorId);
  const second = await activation.issue(id, actorId);
  const redeem = (url: string) =>
    activation.redeem({
      onboardingToken: new URL(url).hash.slice(7),
      password,
      passwordConfirmation: password,
    });
  await expect(redeem(first.activationUrl)).rejects.toMatchObject({ status: 409 });
  await test.db
    .collection('customer_onboarding_tokens')
    .updateOne({ customer_id: id, consumed_at: null }, { $set: { expires_at: new Date(0) } });
  await expect(redeem(second.activationUrl)).rejects.toMatchObject({ status: 409 });
  const third = await activation.issue(id, actorId);
  await test.db
    .collection('customer_onboarding_tokens')
    .updateOne({ customer_id: id, consumed_at: null }, { $set: { purpose: 'different' } });
  await expect(redeem(third.activationUrl)).rejects.toMatchObject({ status: 400 });
  expect(
    await test.db.collection('auth_users').countDocuments({ email: `${id}@example.invalid` }),
  ).toBe(0);
  await test.db
    .collection('memberships')
    .updateOne({ customer_id: id }, { $set: { status: 'expired' } });
  await expect(activation.issue(id, actorId)).rejects.toMatchObject({ status: 409 });
});

it('allows exactly one concurrent redemption and leaves no orphan credentials', async () => {
  const id = await customer();
  const issued = await activation.issue(id, actorId);
  const input = {
    onboardingToken: new URL(issued.activationUrl).hash.slice(7),
    password,
    passwordConfirmation: password,
  };
  const results = await Promise.allSettled([activation.redeem(input), activation.redeem(input)]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const users = await test.db
    .collection('auth_users')
    .find({ email: `${id}@example.invalid` })
    .toArray();
  expect(users).toHaveLength(1);
  expect(await test.db.collection('auth_accounts').countDocuments({ userId: users[0]!._id })).toBe(
    1,
  );
});

it('preserves an existing bootstrapped administrator and refuses linking its identity', async () => {
  const id = await customer();
  const adminId = randomUUID();
  const admin = {
    _id: adminId,
    email: `${id}@example.invalid`,
    emailVerified: true,
    name: 'Existing Administrator',
  };
  await test.db
    .collection<Record<string, unknown> & { _id: string }>('auth_users')
    .insertOne(admin);
  await test.db
    .collection<Record<string, unknown> & { _id: string }>('staff_users')
    .insertOne({ _id: adminId });
  const credential = {
    _id: randomUUID(),
    userId: adminId,
    providerId: 'credential',
    accountId: adminId,
    password: 'synthetic-existing-hash',
  };
  await test.db.collection<MongoRow>('auth_accounts').insertOne(credential);
  const assignment = { _id: randomUUID(), staff_id: adminId, role_id: randomUUID() };
  await test.db.collection<MongoRow>('staff_role_assignments').insertOne(assignment);
  const issued = await activation.issue(id, actorId);
  await expect(
    activation.redeem({
      onboardingToken: new URL(issued.activationUrl).hash.slice(7),
      password,
      passwordConfirmation: password,
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(await test.db.collection('auth_users').findOne({ email: admin.email })).toEqual(admin);
  expect(await test.db.collection('auth_accounts').findOne({ userId: adminId })).toEqual(
    credential,
  );
  expect(await test.db.collection('staff_role_assignments').findOne({ staff_id: adminId })).toEqual(
    assignment,
  );
  expect(
    await test.db
      .collection('customer_onboarding_tokens')
      .countDocuments({ customer_id: id, consumed_at: null }),
  ).toBe(1);
});

it('links an orphan identity without changing its existing password or creating another credential', async () => {
  const id = await customer();
  const admin = createAfHomesAdminAuth(test.db, test.client, env);
  const created = await admin.api.createUser({
    body: {
      name: 'Synthetic Orphan',
      email: `${id}@example.invalid`,
      password: 'ExistingOwnerPassword123',
      data: { emailVerified: true },
    },
  });
  const before = await test.db.collection('auth_accounts').findOne({ userId: created.user.id });
  const issued = await activation.issue(id, actorId);
  const result = await activation.redeem({
    onboardingToken: new URL(issued.activationUrl).hash.slice(7),
    password,
    passwordConfirmation: password,
  });
  expect(result.linkedExistingAuth).toBe(true);
  expect(await test.db.collection('auth_accounts').findOne({ userId: created.user.id })).toEqual(
    before,
  );
  const auth = createAfHomesAuth(test.db, test.client, env);
  expect(
    (
      await auth.api.signInEmail({
        body: { email: result.email, password: 'ExistingOwnerPassword123' },
        asResponse: true,
      })
    ).status,
  ).toBe(200);
  expect(
    (await auth.api.signInEmail({ body: { email: result.email, password }, asResponse: true }))
      .status,
  ).toBe(401);
});

it('rolls identity, credential, link and token back together if the audit cannot be written', async () => {
  const id = await customer();
  const issued = await activation.issue(id, actorId);
  await test.db.command({
    collMod: 'audit_events',
    validator: { action: { $ne: 'CUSTOMER_ACCOUNT_LINKED' } },
    validationLevel: 'strict',
  });
  try {
    await expect(
      activation.redeem({
        onboardingToken: new URL(issued.activationUrl).hash.slice(7),
        password,
        passwordConfirmation: password,
      }),
    ).rejects.toBeDefined();
    expect(
      await test.db.collection('auth_users').countDocuments({ email: `${id}@example.invalid` }),
    ).toBe(0);
    expect(
      await test.db.collection('customers').countDocuments({
        customer_number: `AF-CUS-${id.slice(0, 5).toUpperCase()}`,
        auth_user_id: null,
      }),
    ).toBe(1);
    expect(
      await test.db
        .collection('customer_onboarding_tokens')
        .countDocuments({ customer_id: id, consumed_at: null }),
    ).toBe(1);
    expect(
      await test.db
        .collection('audit_events')
        .countDocuments({ entity_id: id, action: 'CUSTOMER_AUTH_ACTIVATED' }),
    ).toBe(0);
  } finally {
    await test.db.command({ collMod: 'audit_events', validator: {} });
  }
});

it('refuses an identity already owned by another customer and ignores browser-supplied identity claims', async () => {
  const id = await customer();
  const identityId = randomUUID();
  await test.db
    .collection<MongoRow>('auth_users')
    .insertOne({ _id: identityId, email: `${id}@example.invalid`, emailVerified: true });
  await test.db.collection<MongoRow>('customers').insertOne({
    _id: randomUUID(),
    customer_number: 'SYNTHETIC-OTHER-OWNER',
    auth_user_id: identityId,
  });
  const issued = await activation.issue(id, actorId);
  await expect(
    activation.redeem({
      onboardingToken: new URL(issued.activationUrl).hash.slice(7),
      password,
      passwordConfirmation: password,
      customerId: randomUUID(),
      email: 'attacker@example.invalid',
      role: 'super_admin',
    }),
  ).rejects.toMatchObject({ status: 409 });
  expect(
    await test.db.collection('auth_users').countDocuments({ email: 'attacker@example.invalid' }),
  ).toBe(0);
});
