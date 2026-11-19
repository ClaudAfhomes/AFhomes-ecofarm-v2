import { BSON, Long, Decimal128, Binary } from 'mongodb';
import { expect, it } from 'vitest';
import { createRecoveryRehearsal } from './mongo-recovery.js';
import { seedPhase5Fixture } from './phase5-fixture.js';
import { createAfHomesAdminAuth } from '../auth.js';

it('recovers an encrypted BSON/schema/private-file snapshot after the disposable source is stopped', async () => {
  const rehearsal = await createRecoveryRehearsal();
  try {
    const env = {
      NODE_ENV: 'test',
      BETTER_AUTH_SECRET: 'synthetic-recovery-secret-only'.repeat(3),
      BETTER_AUTH_URL: 'http://localhost:52761',
    };
    const fixture = await seedPhase5Fixture(rehearsal.source.db, rehearsal.source.client, env);
    const authBefore = await rehearsal.source.db.collection('auth_accounts').find().toArray();
    await rehearsal.source.db.createCollection('recovery_fidelity', {
      validator: { money: { $type: 'string', $regex: '^\\d+\\.\\d{2}$' } },
      validationLevel: 'strict',
    });
    await rehearsal.source.db
      .collection('recovery_fidelity')
      .createIndex({ reference: 1 }, { unique: true });
    await rehearsal.source.db.collection('recovery_fidelity').insertOne({
      reference: 'SYNTHETIC-RESTORE',
      money: '100000.01',
      wide: Long.fromString('9223372036854775806'),
      decimal: Decimal128.fromString('1234567890.0123456789'),
      binary: new Binary(Buffer.from([0, 1, 255])),
      date: new Date('2025-01-01T12:34:56.789Z'),
      immutableSnapshot: { actorId: fixture.staff.id, total: '100000.01' },
    });
    const before = await rehearsal.source.db
      .collection('recovery_fidelity')
      .findOne({}, { promoteValues: false });
    await rehearsal.source.files.put(
      'photos/synthetic.jpeg',
      Buffer.from('Synthetic private bytes'),
      'image/jpeg',
    );
    const bundle = await rehearsal.capture();
    expect(bundle.includes(Buffer.from('SYNTHETIC-RESTORE'))).toBe(false);
    expect(bundle.includes(Buffer.from('Synthetic private bytes'))).toBe(false);
    await rehearsal.stopSource();
    const restored = await rehearsal.restore(bundle, { runtimeCompatibility: true });
    expect(restored.db.databaseName).toBe('afhomes_dev');
    const after = await restored.db
      .collection('recovery_fidelity')
      .findOne({}, { promoteValues: false });
    expect(Buffer.from(BSON.serialize(after!))).toEqual(Buffer.from(BSON.serialize(before!)));
    const authAfter = await restored.db.collection('auth_accounts').find().toArray();
    // A failed assertion must never dump credential records to test output.
    expect(
      Buffer.from(BSON.serialize({ accounts: authAfter })).equals(
        Buffer.from(BSON.serialize({ accounts: authBefore })),
      ),
    ).toBe(true);
    expect(
      await restored.db.collection('staff_users').findOne({ email: fixture.staff.email }),
    ).toMatchObject({ must_change_password: true });
    const signedIn = await createAfHomesAdminAuth(
      restored.db,
      restored.client,
      env,
    ).api.signInEmail({
      body: { email: fixture.staff.email, password: fixture.staff.password },
    });
    expect(signedIn.user.id === fixture.staff.id).toBe(true);
    expect(await restored.files.read('photos/synthetic.jpeg', 1024)).toEqual({
      bytes: Buffer.from('Synthetic private bytes'),
      contentType: 'image/jpeg',
    });
    await expect(
      restored.db.collection('recovery_fidelity').insertOne({ reference: 'OTHER', money: 1 }),
    ).rejects.toMatchObject({ code: 121 });
    await expect(
      restored.db
        .collection('recovery_fidelity')
        .insertOne({ reference: 'SYNTHETIC-RESTORE', money: '1.00' }),
    ).rejects.toMatchObject({ code: 11000 });
    expect(restored.summary.collections).toBeGreaterThan(20);
    expect(restored.summary.documents).toBeGreaterThan(10);
  } finally {
    await rehearsal.close();
  }
}, 30000);

it('refuses unsupported view metadata rather than silently omitting it from recovery', async () => {
  const rehearsal = await createRecoveryRehearsal();
  try {
    await rehearsal.source.db.createCollection('synthetic_base');
    await rehearsal.source.db.createCollection('synthetic_view', {
      viewOn: 'synthetic_base',
      pipeline: [],
    });
    await expect(rehearsal.capture()).rejects.toThrow('Unsupported recovery collection');
    expect(rehearsal.targetCount()).toBe(0);
  } finally {
    await rehearsal.close();
  }
}, 30000);

it('refuses modified/truncated recovery archives before creating any restore target', async () => {
  const rehearsal = await createRecoveryRehearsal();
  try {
    await rehearsal.source.db.collection('synthetic').insertOne({ value: 'Private fixture' });
    const bundle = await rehearsal.capture(),
      damaged = Buffer.from(bundle);
    damaged[damaged.length - 1] ^= 1;
    await expect(rehearsal.restore(damaged)).rejects.toThrow(
      'Recovery archive authentication failed',
    );
    await expect(rehearsal.restore(bundle.subarray(0, 10))).rejects.toThrow(
      'Recovery archive authentication failed',
    );
    expect(rehearsal.targetCount()).toBe(0);
    const first = await rehearsal.restore(bundle),
      second = await rehearsal.restore(bundle);
    expect(first.db.databaseName).toMatch(/^afhomes_restore_/);
    expect(second.client !== first.client).toBe(true);
    expect(first.db.databaseName).not.toBe(second.db.databaseName);
    expect(await first.db.collection('synthetic').countDocuments()).toBe(1);
    expect(await second.db.collection('synthetic').countDocuments()).toBe(1);
  } finally {
    await rehearsal.close();
  }
}, 30000);
