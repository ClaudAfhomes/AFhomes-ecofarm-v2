import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { BSON } from 'mongodb';
import { hash } from 'bcryptjs';
import { expect, it } from 'vitest';
import {
  planMigrationIdentities,
  type SourceMigrationIdentity,
  type MigrationIdentityBinding,
} from './migration-identity-plan.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase7Fixture } from './testing/phase7-fixture.js';
import { createMongoPhase5Runtime } from './mongo-runtime.js';

const owner = {
  sourceId: '00000000-0000-4000-8000-000000000001',
  targetId: '00000000-0000-4000-8000-000000000002',
};
const importedId = '00000000-0000-4000-8000-000000000003';
const legacy = '$2b$10$' + 'a'.repeat(53);
const sourceRow = (id = importedId, email = 'import@example.invalid'): SourceMigrationIdentity => ({
  id,
  email,
  encrypted_password: legacy,
  created_at: '2026-10-01T00:00:00.123456Z',
  updated_at: '2026-10-02T00:00:00.654321Z',
  email_confirmed_at: '2026-10-01T00:00:00Z',
  banned_until: null,
  deleted_at: null,
  is_anonymous: false,
  is_sso_user: false,
  providers: ['email'],
});
function fixture() {
  return {
    source: [sourceRow(owner.sourceId, 'owner@example.invalid'), sourceRow()],
    bindings: [
      {
        identityId: owner.sourceId,
        email: 'owner@example.invalid',
        fullName: 'Source Owner',
        kind: 'staff',
        mustChangePassword: false,
      },
      {
        identityId: importedId,
        email: 'import@example.invalid',
        fullName: 'Synthetic Imported Staff',
        kind: 'staff',
        mustChangePassword: true,
      },
    ] as MigrationIdentityBinding[],
    target: [{ id: owner.targetId, email: 'OWNER@example.invalid' }],
  };
}

it('plans only new identities, preserves exact source timestamp provenance, keeps hashes out of serializable reports and excludes the owner', () => {
  const data = fixture(),
    before = structuredClone(data);
  data.source[0]!.encrypted_password = 'EXCLUDED-OWNER-CREDENTIAL';
  before.source[0]!.encrypted_password = 'EXCLUDED-OWNER-CREDENTIAL';
  const plan = planMigrationIdentities(data.source, data.bindings, data.target, owner);
  expect(plan.ready).toBe(true);
  expect(plan.users).toEqual([
    expect.objectContaining({
      _id: importedId,
      email: 'import@example.invalid',
      emailVerified: true,
      name: 'Synthetic Imported Staff',
      createdAt: new Date('2026-10-01T00:00:00.123Z'),
      migration_source_timestamps: {
        created_at: data.source[1]!.created_at,
        updated_at: data.source[1]!.updated_at,
        email_confirmed_at: data.source[1]!.email_confirmed_at,
      },
    }),
  ]);
  expect(plan.accounts).toEqual([
    expect.objectContaining({
      accountId: importedId,
      userId: importedId,
      providerId: 'credential',
    }),
  ]);
  expect(plan.credentials.get(importedId)).toBe('afhomes-supabase-bcrypt-v1:' + legacy);
  expect(Object.keys(plan)).not.toContain('credentials');
  expect(plan.staffPasswordFlags[importedId]).toBe(true);
  data.bindings[1]!.mustChangePassword = false;
  expect(
    planMigrationIdentities(data.source, data.bindings, data.target, owner).staffPasswordFlags[
      importedId
    ],
  ).toBe(false);
  data.bindings[1]!.mustChangePassword = true;
  expect(JSON.stringify(plan)).not.toContain(legacy);
  expect(JSON.stringify(plan)).not.toContain('EXCLUDED-OWNER-CREDENTIAL');
  expect(data).toEqual(before);
  expect(planMigrationIdentities(data.source, data.bindings, data.target, owner).digest).toBe(
    plan.digest,
  );
});

it('preserves approved native test identities instead of proposing their old credentials or password flags', () => {
  const data = fixture(), targetId = '00000000-0000-4000-8000-000000000004';
  data.source[1]!.email = 'john@gmail.com'; data.bindings[1]!.email = 'john@gmail.com';
  data.target.push({ id: targetId, email: 'john@gmail.com' });
  const aliases = [{ sourceId: importedId, targetId, email: 'john@gmail.com', reason: 'owner-approved-test-account' as const }];
  const plan = planMigrationIdentities(data.source, data.bindings, data.target, owner, aliases);
  expect(plan.ready).toBe(true); expect(plan.users).toEqual([]); expect(plan.accounts).toEqual([]);
  expect(plan.credentials.size).toBe(0); expect(plan.staffPasswordFlags).toEqual({});
  expect(plan.preservedIdentities).toEqual([{ sourceId: importedId, targetId }]);
});

it('fails closed on unsupported provider/account states, credentials, bindings and target conflicts without returning credential values', () => {
  for (const change of [
    { email_confirmed_at: null },
    { banned_until: '2026-01-01T00:00:00Z' },
    { deleted_at: '2026-01-01T00:00:00Z' },
    { is_anonymous: true },
    { is_sso_user: true },
    { providers: ['google'] },
    { encrypted_password: '$2b$31$' + 'a'.repeat(53) },
    { created_at: '2026-02-30T00:00:00Z' },
    { recovery_token: 'PRIVATE-TOKEN' },
  ]) {
    const data = fixture();
    Object.assign(data.source[1]!, change);
    const plan = planMigrationIdentities(data.source, data.bindings, data.target, owner);
    expect(plan.ready).toBe(false);
    expect(plan.users).toEqual([]);
    expect(plan.accounts).toEqual([]);
    expect(plan.credentials.size).toBe(0);
    expect(plan.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(plan)).not.toContain('PRIVATE-TOKEN');
  }
  for (const mutate of [
    (data: ReturnType<typeof fixture>) => {
      data.bindings.pop();
    },
    (data: ReturnType<typeof fixture>) => {
      data.bindings.push({ ...data.bindings[1]! });
    },
    (data: ReturnType<typeof fixture>) => {
      data.bindings[1]!.email = 'other@example.invalid';
    },
    (data: ReturnType<typeof fixture>) => {
      data.bindings[1]!.mustChangePassword = null;
    },
    (data: ReturnType<typeof fixture>) => {
      data.target.push({
        id: '00000000-0000-4000-8000-000000000004',
        email: 'import@example.invalid',
      });
    },
    (data: ReturnType<typeof fixture>) => {
      data.source.push({ ...data.source[1]! });
    },
  ]) {
    const data = fixture();
    mutate(data);
    expect(planMigrationIdentities(data.source, data.bindings, data.target, owner).ready).toBe(
      false,
    );
  }
});

it('signs in a disposable migrated identity with its original password, enforces first change and leaves the native owner credential intact', async () => {
  const replica = await createTestReplica(),
    server = http.createServer();
  try {
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const env = {
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 'synthetic-identity-migration-only'.repeat(3),
      BETTER_AUTH_URL: base,
      AFHOMES_ENABLE_LEGACY_PASSWORDS: 'true',
    };
    const original = await seedPhase7Fixture(
      replica.db,
      replica.client,
      env,
      'SyntheticNativeOwner123!',
    );
    const ownerBefore = await replica.db
      .collection('auth_accounts')
      .findOne({ userId: original.admin.id });
    const sourceOwner = randomUUID(),
      sourceUser = randomUUID();
    const source = [
      sourceRow(sourceOwner, original.admin.email),
      { ...sourceRow(sourceUser), encrypted_password: await hash('SyntheticMigrated123!', 4) },
    ];
    const bindings: MigrationIdentityBinding[] = [
      {
        identityId: sourceOwner,
        email: original.admin.email,
        fullName: 'Excluded Source Owner',
        kind: 'staff',
        mustChangePassword: false,
      },
      {
        identityId: sourceUser,
        email: 'import@example.invalid',
        fullName: 'Synthetic Imported Staff',
        kind: 'staff',
        mustChangePassword: true,
      },
    ];
    const headers = (await replica.db.collection('auth_users').find().toArray()).map((row) => ({
      id: String(row._id),
      email: String(row.email),
    }));
    const plan = planMigrationIdentities(source, bindings, headers, {
      sourceId: sourceOwner,
      targetId: original.admin.id,
    });
    expect(plan.ready).toBe(true);
    const existingAssignment = await replica.db
      .collection('staff_role_assignments')
      .findOne({ staff_id: original.staff.id });
    const session = replica.client.startSession();
    try {
      await expect(
        session.withTransaction(async () => {
          await replica.db
            .collection<{ _id: string; [key: string]: unknown }>('auth_users')
            .insertMany(plan.users, { session });
          await replica.db
            .collection<{ _id: string; [key: string]: unknown }>('auth_accounts')
            .insertMany(
              plan.accounts.map((row) => ({
                ...row,
                password: plan.credentials.get(String(row.userId)),
              })),
              { session },
            );
          throw new Error('SYNTHETIC-IDENTITY-ROLLBACK');
        }),
      ).rejects.toThrow('SYNTHETIC-IDENTITY-ROLLBACK');
      expect(await replica.db.collection<{ _id: string }>('auth_users').countDocuments({ _id: sourceUser })).toBe(0);
      expect(
        await replica.db.collection('auth_accounts').countDocuments({ userId: sourceUser }),
      ).toBe(0);
      await session.withTransaction(async () => {
        await replica.db
          .collection<{ _id: string; [key: string]: unknown }>('auth_users')
          .insertMany(plan.users, { session });
        await replica.db
          .collection<{ _id: string; [key: string]: unknown }>('auth_accounts')
          .insertMany(
            plan.accounts.map((row) => ({
              ...row,
              password: plan.credentials.get(String(row.userId)),
            })),
            { session },
          );
        await replica.db
          .collection<{ _id: string; [key: string]: unknown }>('staff_users')
          .insertOne(
            {
              _id: sourceUser,
              email: 'import@example.invalid',
              full_name: 'Synthetic Imported Staff',
              status: 'active',
              must_change_password: plan.staffPasswordFlags[sourceUser],
              employee_number: 'SYNTHETIC-IMPORT-EMP',
              created_at: new Date().toISOString(),
            },
            { session },
          );
        await replica.db
          .collection<{ _id: string; [key: string]: unknown }>('staff_role_assignments')
          .insertOne(
            { _id: randomUUID(), staff_id: sourceUser, role_id: existingAssignment!.role_id },
            { session },
          );
      });
    } finally {
      await session.endSession();
    }
    server.on('request', createMongoPhase5Runtime(replica.db, replica.client, env));
    const login = await fetch(base + '/api/v1/auth/identity/sign-in/email', {
      method: 'POST',
      headers: { Origin: base, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'import@example.invalid', password: 'SyntheticMigrated123!' }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(';')[0])
      .join('; ');
    expect(
      (await fetch(base + '/api/v1/customers', { headers: { Origin: base, Cookie: cookie } }))
        .status,
    ).toBe(403);
    const ownerAfter = await replica.db
      .collection('auth_accounts')
      .findOne({ userId: original.admin.id });
    expect(
      Buffer.from(BSON.serialize(ownerBefore!)).equals(Buffer.from(BSON.serialize(ownerAfter!))),
    ).toBe(true);
    expect(await replica.db.collection('auth_verifications').countDocuments()).toBe(0);
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
    await replica.stop();
  }
}, 30000);
