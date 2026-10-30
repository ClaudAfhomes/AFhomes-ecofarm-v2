import { expect, it } from 'vitest';
import { mongoRuntimeDatabase } from './mongodb-scope.js';
import { createMongoClient } from './mongodb.js';
import { createAfHomesAuth } from './auth.js';
import { hostedMongoConfig } from './hosted-runtime.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { seedPhase5Fixture } from './testing/phase5-fixture.js';

const production = {
  NODE_ENV: 'production',
  AFHOMES_MONGODB_SCOPE: 'production',
  AFHOMES_HOSTED_RUNTIME_ENABLED: 'true',
  MONGODB_DB: 'afhomes_prod',
  MONGODB_URI: 'mongodb://127.0.0.1:27017',
  BETTER_AUTH_SECRET: 'synthetic-scope-only-secret'.repeat(3),
  BETTER_AUTH_URL: 'https://scope.example.invalid',
  AFHOMES_PUBLIC_ORIGIN: 'https://scope.example.invalid',
  AFHOMES_WEB_URL: 'https://scope.example.invalid',
  AFHOMES_ADMIN_URL: 'https://scope.example.invalid/admin',
  AFHOMES_PRIVATE_STORAGE_PROVIDER: 's3',
};

it('keeps the development default and requires paired explicit production opt-ins', () => {
  expect(mongoRuntimeDatabase({})).toBe('afhomes_dev');
  expect(hostedMongoConfig(production)).toMatchObject({ coreWritesEnabled: false });
  const connection = createMongoClient(production);
  expect(connection.database).toBe('afhomes_prod');
  for (const patch of [
    { AFHOMES_MONGODB_SCOPE: '' },
    { AFHOMES_MONGODB_SCOPE: 'other' },
    { AFHOMES_MONGODB_SCOPE: undefined },
    { AFHOMES_HOSTED_RUNTIME_ENABLED: undefined },
    { NODE_ENV: 'development' },
    { MONGODB_DB: 'afhomes_dev' },
    { MONGODB_DB: 'other' },
  ])
    expect(() => createMongoClient({ ...production, ...patch })).toThrow();
});

it('binds authentication to the selected namespace and matching client without initializing it', async () => {
  const replica = await createTestReplica();
  try {
    const db = replica.client.db('afhomes_prod');
    const before = await db.listCollections().toArray();
    expect(() => createAfHomesAuth(replica.db, replica.client, production)).toThrow();
    expect(() =>
      createAfHomesAuth(db, replica.client, { ...production, AFHOMES_MONGODB_SCOPE: undefined }),
    ).toThrow();
    createAfHomesAuth(db, replica.client, production);
    expect(await db.listCollections().toArray()).toEqual(before);
    const fixture = await seedPhase5Fixture(db, replica.client, production);
    const signedIn = await createAfHomesAuth(db, replica.client, production).api.signInEmail({
      body: { email: fixture.staff.email, password: fixture.staff.password },
    });
    expect(signedIn.user.id === fixture.staff.id).toBe(true);
    expect(await replica.db.listCollections().toArray()).toEqual([]);
  } finally {
    await replica.stop();
  }
}, 30000);
