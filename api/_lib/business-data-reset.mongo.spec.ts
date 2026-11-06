import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTestReplica } from './testing/mongo-replica.js';
import { createAfHomesAdminAuth, createAfHomesAuth } from './auth.js';
import { createMongoSessionVerifier } from './auth-verify.mongo.js';
import { createMongoStaffAccess } from './afhomes-access.mongo.js';
import { captureLocalBackup } from './local-mongo-backup.js';
import { readMongoPublicVerificationSettings } from './public-verification-settings.mongo.js';
import {
  RESET_RULES,
  applyBusinessDataReset,
  planBusinessDataReset,
  verifyBackupRestorable,
} from './business-data-reset.mongo.js';
import type { VercelRequest } from './http.js';
import type { MongoRow } from './customer-activation.mongo.js';

let test: Awaited<ReturnType<typeof createTestReplica>>;
let auth: ReturnType<typeof createAfHomesAuth>;
let scratch = '';
const env = {
  BETTER_AUTH_SECRET: 'business-reset-auth-fixture-'.repeat(3),
  BETTER_AUTH_URL: 'http://localhost:3000',
};
const password = 'Temp1234';
const staffEmail = 'reset-admin@example.invalid',
  customerEmail = 'reset-customer@example.invalid';
let staffId = '',
  customerUserId = '';
const roleId = randomUUID(),
  sellerRoleId = randomUUID(),
  moduleId = randomUUID(),
  departmentId = randomUUID(),
  sellerId = randomUUID();
const col = (name: string) => test.db.collection<MongoRow>(name);

async function signIn(email: string) {
  const response = await auth.handler(
    new Request(`${env.BETTER_AUTH_URL}/api/v1/auth/identity/sign-in/email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: env.BETTER_AUTH_URL },
      body: JSON.stringify({ email, password }),
    }),
  );
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  return { status: response.status, cookie };
}
async function backup() {
  return captureLocalBackup(test.db, await mkdtemp(path.join(scratch, 'files-')));
}

beforeAll(async () => {
  test = await createTestReplica();
  scratch = await mkdtemp(path.join(tmpdir(), 'afhomes-reset-spec-'));
  auth = createAfHomesAuth(test.db, test.client, env);
  const internal = createAfHomesAdminAuth(test.db, test.client, env);
  staffId = (
    await internal.api.createUser({
      body: { name: 'Reset Admin', email: staffEmail, password, data: { emailVerified: true } },
    })
  ).user.id;
  customerUserId = (
    await internal.api.createUser({
      body: {
        name: 'Reset Customer',
        email: customerEmail,
        password,
        data: { emailVerified: true },
      },
    })
  ).user.id;
  const now = new Date();
  await col('departments').insertOne({
    _id: departmentId,
    code: 'OPS',
    name: 'Operations',
    is_active: true,
  });
  await col('roles').insertMany([
    { _id: roleId, slug: 'super_admin', name: 'Super Admin', is_active: true, is_system: true },
    { _id: sellerRoleId, slug: 'ost', name: 'OST', is_active: true, is_system: true },
  ]);
  await col('modules').insertOne({ _id: moduleId, key: 'sales.customers', is_active: true });
  await col('role_permissions').insertOne({
    _id: randomUUID(),
    role_id: roleId,
    module_id: moduleId,
    can_view: true,
    can_create: true,
    can_update: true,
    can_delete: true,
  });
  await col('staff_users').insertMany([
    {
      _id: staffId,
      email: staffEmail,
      full_name: 'RESET ADMIN',
      department_id: departmentId,
      status: 'active',
      must_change_password: false,
    },
    { _id: sellerId, email: 'seller@example.invalid', full_name: 'SELLER', status: 'active' },
  ]);
  await col('staff_role_assignments').insertMany([
    { _id: randomUUID(), staff_id: staffId, role_id: roleId },
    { _id: randomUUID(), staff_id: sellerId, role_id: sellerRoleId },
  ]);
  await col('staff_permission_restrictions').insertOne({
    _id: randomUUID(),
    staff_id: sellerId,
    module_id: moduleId,
    deny_view: true,
  });
  await col('public_verification_settings').insertOne({
    _id: 'public',
    enabled: false,
    dailyLimitEnabled: true,
    privacyApproved: false,
    cleanupReady: false,
    verificationPhone: '+639604316867',
    retentionDays: 30,
    noticeVersion: 'reset-spec',
    revision: 2,
    updatedAt: now.toISOString(),
    privacyNotice:
      'Synthetic privacy notice for the business data reset specification only. '.repeat(2),
  });
  await col('counters').insertOne({ _id: 'company-customer:2026', seq: 7 });
  await col('ost_members').insertOne({
    _id: sellerId,
    ost_number: 'AF-OST-AAAAA',
    status: 'active',
  });
  await col('audit_events').insertOne({
    _id: randomUUID(),
    action: 'CUSTOMER_CREATED',
    created_at: now,
  });
  // Business records, with a validator and index that must survive the reset.
  await test.db.createCollection('customers', {
    validator: { $jsonSchema: { bsonType: 'object', required: ['customer_number'] } },
  });
  await col('customers').createIndex({ customer_number: 1 }, { unique: true });
  await col('customers').insertOne({
    _id: randomUUID(),
    customer_number: '2026-0007',
    auth_user_id: customerUserId,
    status: 'active',
  });
  await col('card_sales').insertOne({ _id: randomUUID(), sale_number: 'AF-CSALE-AAAAA' });
  await col('payments').insertMany([{ _id: randomUUID() }, { _id: randomUUID() }]);
  await col('commissions').insertOne({ _id: randomUUID() });
  await col('points_ledger').insertOne({ _id: randomUUID(), points: 10 });
  expect((await signIn(staffEmail)).status).toBe(200);
  expect((await signIn(customerEmail)).status).toBe(200);
}, 180_000);
afterAll(async () => {
  await test?.stop();
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

it('plans read-only: classifies every collection, splits sign-ins by owner, writes nothing', async () => {
  const before = await col('auth_users').countDocuments();
  const plan = await planBusinessDataReset(test.db);
  expect(plan.ready).toBe(true);
  expect(plan.blockers).toEqual([]);
  expect(plan.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  const row = (name: string) => plan.collections.find((entry) => entry.name === name);
  expect(row('auth_users')).toMatchObject({ rule: 'identity', total: 2, delete: 1, preserve: 1 });
  expect(row('auth_sessions')).toMatchObject({ rule: 'identity', delete: 1, preserve: 1 });
  expect(row('payments')).toMatchObject({ rule: 'delete', delete: 2, preserve: 0 });
  expect(row('staff_users')).toMatchObject({ rule: 'preserve', delete: 0, preserve: 2 });
  expect(row('audit_events')).toMatchObject({ rule: 'review', delete: 0 });
  expect(row('ost_members')).toMatchObject({ rule: 'review', delete: 0 });
  expect(await col('auth_users').countDocuments()).toBe(before);
  expect((await planBusinessDataReset(test.db)).fingerprint).toBe(plan.fingerprint);
});

it('refuses other databases, unconfirmed targets and bad fingerprints', async () => {
  const snapshot = await backup();
  await expect(planBusinessDataReset(test.client.db('afhomes_prod'))).rejects.toThrow(
    'afhomes_dev',
  );
  const { fingerprint } = await planBusinessDataReset(test.db);
  await expect(
    applyBusinessDataReset(test.client.db('afhomes_prod'), {
      fingerprint,
      confirmTarget: 'afhomes_dev',
      backup: snapshot,
    }),
  ).rejects.toThrow('afhomes_dev');
  await expect(
    applyBusinessDataReset(test.db, { fingerprint, confirmTarget: 'afhomes', backup: snapshot }),
  ).rejects.toThrow('confirmed exactly');
  await expect(
    applyBusinessDataReset(test.db, {
      fingerprint: 'f'.repeat(64),
      confirmTarget: 'afhomes_dev',
      backup: snapshot,
    }),
  ).rejects.toThrow('Run --plan again');
  expect(await col('payments').countDocuments()).toBe(2);
});

it('refuses a stale plan after any write, and a backup that misses current records', async () => {
  const stale = await backup();
  const { fingerprint } = await planBusinessDataReset(test.db);
  const extra = randomUUID();
  await col('payments').insertOne({ _id: extra });
  await expect(
    applyBusinessDataReset(test.db, { fingerprint, confirmTarget: 'afhomes_dev', backup: stale }),
  ).rejects.toThrow('Run --plan again');
  const fresh = await planBusinessDataReset(test.db);
  await expect(
    applyBusinessDataReset(test.db, {
      fingerprint: fresh.fingerprint,
      confirmTarget: 'afhomes_dev',
      backup: stale,
    }),
  ).rejects.toThrow('Backup does not match');
  await col('payments').deleteOne({ _id: extra });
  expect(await col('payments').countDocuments()).toBe(2);
});

it('blocks unknown collections and sign-ins owned by neither staff nor a customer', async () => {
  await col('unexpected_records').insertOne({ _id: randomUUID() });
  await col('auth_users').insertOne({ _id: 'orphan-user', email: 'orphan@example.invalid' });
  const plan = await planBusinessDataReset(test.db);
  expect(plan.ready).toBe(false);
  expect(plan.blockers).toEqual([
    'auth_users: 1 record(s) not linked to a staff user or customer',
    'unexpected_records: not classified',
  ]);
  await expect(
    applyBusinessDataReset(test.db, {
      fingerprint: plan.fingerprint,
      confirmTarget: 'afhomes_dev',
      backup: await backup(),
    }),
  ).rejects.toThrow('Plan is blocked');
  await col('unexpected_records').drop();
  await col('auth_users').deleteOne({ _id: 'orphan-user' });
  expect(RESET_RULES.has('unexpected_records')).toBe(false);
});

it('deletes only the reviewed business records; Organization, staff sign-in and settings keep working', async () => {
  const snapshot = await backup();
  expect(
    await verifyBackupRestorable(snapshot, test.client, path.join(scratch, 'restore-checks')),
  ).toMatchObject({ collections: snapshot.collections.length });
  const indexesBefore = await col('customers').listIndexes().toArray();
  const optionsBefore = (
    await test.db.listCollections({ name: 'customers' }, { nameOnly: false }).toArray()
  )[0]!.options;
  const plan = await planBusinessDataReset(test.db);
  const result = await applyBusinessDataReset(test.db, {
    fingerprint: plan.fingerprint,
    confirmTarget: 'afhomes_dev',
    backup: snapshot,
  });
  expect(result).toMatchObject({ applied: true, schemaUnchanged: true, countsMatch: true });

  for (const name of ['customers', 'card_sales', 'payments', 'commissions', 'points_ledger'])
    expect(await col(name).countDocuments()).toBe(0);
  for (const [name, count] of [
    ['staff_users', 2],
    ['departments', 1],
    ['roles', 2],
    ['role_permissions', 1],
    ['staff_role_assignments', 2],
    ['staff_permission_restrictions', 1],
    ['modules', 1],
    ['ost_members', 1],
    ['audit_events', 1],
  ] as const)
    expect(await col(name).countDocuments()).toBe(count);
  expect(await col('counters').findOne({ _id: 'company-customer:2026' })).toMatchObject({ seq: 7 });
  expect(
    await col('auth_users')
      .find({}, { projection: { _id: 1 } })
      .toArray(),
  ).toEqual([{ _id: staffId }]);
  expect(await col('auth_accounts').countDocuments({ userId: customerUserId })).toBe(0);
  expect(await col('auth_sessions').countDocuments({ userId: customerUserId })).toBe(0);
  expect(await col('customers').listIndexes().toArray()).toEqual(indexesBefore);
  expect(
    (await test.db.listCollections({ name: 'customers' }, { nameOnly: false }).toArray())[0]!
      .options,
  ).toEqual(optionsBefore);

  // Staff sign in with their existing password and keep their permissions.
  const staff = await signIn(staffEmail);
  expect(staff.status).toBe(200);
  const access = createMongoStaffAccess(test.db, createMongoSessionVerifier(test.db, auth), env);
  const request = { headers: { cookie: staff.cookie }, query: {} } as VercelRequest;
  expect(await access.resolve(request)).toMatchObject({ userId: staffId });
  expect(await access.authorize(request, 'sales.customers', 'update')).not.toHaveProperty('error');
  expect((await signIn(customerEmail)).status).not.toBe(200);
  expect(await readMongoPublicVerificationSettings(test.db)).toMatchObject({
    noticeVersion: 'reset-spec',
    revision: 2,
  });

  // A second run has nothing left to delete.
  expect((await planBusinessDataReset(test.db)).totals.delete).toBe(0);
}, 120_000);
