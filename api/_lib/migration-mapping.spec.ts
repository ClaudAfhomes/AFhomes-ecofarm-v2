import { expect, it } from 'vitest';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { createTestReplica } from './testing/mongo-replica.js';

const manifest: MigrationManifest = {
  version: 1,
  protectedOwner: {
    table: 'public.staff_users',
    sourceId: 'source-owner',
    targetId: 'target-owner',
  },
  tables: [
    {
      source: 'public.staff_users',
      target: 'staff_users',
      key: ['id'],
      columns: ['id', 'email', 'status'],
      ownerField: 'id',
      unique: [['email']],
    },
    {
      source: 'public.roles',
      target: 'roles',
      key: ['id'],
      columns: ['id', 'slug', 'name'],
      referenceMatch: ['slug'],
    },
    {
      source: 'public.staff_role_assignments',
      target: 'staff_role_assignments',
      key: ['id'],
      columns: ['id', 'staff_id', 'role_id'],
      ownerField: 'staff_id',
      references: { staff_id: 'public.staff_users', role_id: 'public.roles' },
      unique: [['staff_id', 'role_id']],
    },
    {
      source: 'public.card_sales',
      target: 'card_sales',
      key: ['id'],
      columns: ['id', 'created_by', 'cash_price_snapshot', 'snapshot'],
      references: { created_by: 'public.staff_users' },
      money: ['cash_price_snapshot'],
    },
    {
      source: 'auth.sessions',
      target: '',
      key: ['id'],
      columns: [],
      exclude: 'Provider-bound sessions are not migrated',
    },
  ],
};
const input = () => ({
  source: {
    'public.staff_users': [
      { id: 'source-owner', email: 'owner@example.invalid', status: 'active' },
      { id: 'staff-two', email: 'staff@example.invalid', status: 'active' },
    ],
    'public.roles': [{ id: 'source-role', slug: 'sales_manager', name: 'Sales Manager' }],
    'public.staff_role_assignments': [
      { id: 'owner-assignment', staff_id: 'source-owner', role_id: 'source-role' },
      { id: 'staff-assignment', staff_id: 'staff-two', role_id: 'source-role' },
    ],
    'public.card_sales': [
      {
        id: 'sale-one',
        created_by: 'source-owner',
        cash_price_snapshot: '100000.01',
        snapshot: { actorId: 'source-owner', text: 'source-owner must remain in evidence' },
      },
    ],
    'auth.sessions': [{ id: 'discard-session', user_id: 'source-owner' }],
  },
  target: {
    card_sales: [] as MigrationRecord[],
    staff_users: [
      {
        _id: 'target-owner',
        email: 'OWNER@example.invalid',
        status: 'active',
        untouched: 'Current owner profile',
      },
    ],
    roles: [{ _id: 'target-role', slug: 'sales_manager', name: 'Sales Manager' }],
    staff_role_assignments: [
      { _id: 'current-owner-assignment', staff_id: 'target-owner', role_id: 'current-role' },
    ],
  },
});

it('maps declared references without rewriting snapshots or replacing the existing owner and assignments', () => {
  const data = input(),
    saved = structuredClone(data);
  const plan = planMigrationMapping(manifest, data);
  expect(plan.ready).toBe(true);
  expect(plan.records.card_sales).toEqual([
    {
      _id: 'sale-one',
      created_by: 'target-owner',
      cash_price_snapshot: '100000.01',
      snapshot: { actorId: 'source-owner', text: 'source-owner must remain in evidence' },
    },
  ]);
  expect(plan.records.staff_users).toEqual([
    { _id: 'staff-two', email: 'staff@example.invalid', status: 'active' },
  ]);
  expect(plan.records.staff_role_assignments).toEqual([
    { _id: 'staff-assignment', staff_id: 'staff-two', role_id: 'target-role' },
  ]);
  expect(plan.excluded.map((row) => row.reason)).toContain('PROTECTED_OWNER');
  expect(plan.excluded.map((row) => row.reason)).toContain(
    'Provider-bound sessions are not migrated',
  );
  expect(plan.records.roles).toEqual([]);
  expect(data).toEqual(saved);
  expect(planMigrationMapping(manifest, data).digest).toBe(plan.digest);
});

it('blocks dangling references, changed reference records, unknown fields/tables and numeric money without emitting an applyable plan', () => {
  for (const mutate of [
    (data: ReturnType<typeof input>) => {
      data.source['public.card_sales'][0]!.created_by = 'missing-staff';
    },
    (data: ReturnType<typeof input>) => {
      data.source['public.roles'][0]!.name = 'Different grant vocabulary';
    },
    (data: ReturnType<typeof input>) => {
      Object.assign(data.source['public.staff_users'][1]!, { unreviewed: 'value' });
    },
    (data: ReturnType<typeof input>) => {
      Object.assign(data.source, { 'public.unknown': [{ id: 'unknown' }] });
    },
    (data: ReturnType<typeof input>) => {
      Object.assign(data.source['public.card_sales'][0]!, { cash_price_snapshot: 100000.01 });
    },
    (data: ReturnType<typeof input>) => {
      delete (data.target as Partial<typeof data.target>).card_sales;
    },
  ]) {
    const data = input();
    mutate(data);
    const plan = planMigrationMapping(manifest, data);
    expect(plan.ready).toBe(false);
    expect(plan.issues.length).toBeGreaterThan(0);
    expect(plan.records).toEqual({});
  }
});

it('refuses owner mismatches and imported authentication credentials', () => {
  const mismatch = input();
  mismatch.target.staff_users[0]!.email = 'someone-else@example.invalid';
  expect(
    planMigrationMapping(manifest, mismatch).issues.some(
      (issue) => issue.code === 'OWNER_IDENTITY_MISMATCH',
    ),
  ).toBe(true);
  const changed: MigrationManifest = {
    ...manifest,
    tables: [
      ...manifest.tables,
      {
        source: 'auth.users',
        target: 'auth_users',
        key: ['id'],
        columns: ['id', 'encrypted_password'],
      },
    ],
  };
  expect(
    planMigrationMapping(changed, input()).issues.some(
      (issue) => issue.code === 'AUTH_MAPPING_NOT_APPROVED',
    ),
  ).toBe(true);
});

it('preserves owner restrictions, refuses duplicate identities and supports stable interrupted/repeated plans', () => {
  const data = input(),
    initial = planMigrationMapping(manifest, data);
  data.target.staff_users.push(...(initial.records.staff_users! as typeof data.target.staff_users));
  const resumed = planMigrationMapping(manifest, data);
  expect(resumed.ready).toBe(true);
  expect(resumed.records.staff_users).toEqual([]);
  for (const [table, rows] of Object.entries(resumed.records))
    Object.assign(data.target, {
      [table]: [...(data.target[table as keyof typeof data.target] ?? []), ...rows],
    });
  const replay = planMigrationMapping(manifest, data);
  expect(replay.ready).toBe(true);
  expect(Object.values(replay.records).every((rows) => rows.length === 0)).toBe(true);
  expect(planMigrationMapping(manifest, data).digest).toBe(replay.digest);
  const duplicate = input();
  duplicate.source['public.staff_users'].push({
    id: 'duplicate-email',
    email: 'staff@example.invalid',
    status: 'active',
  });
  expect(
    planMigrationMapping(manifest, duplicate).issues.some(
      (issue) => issue.code === 'UNIQUE_CONFLICT',
    ),
  ).toBe(true);
  const unsafe = structuredClone(manifest);
  unsafe.tables[2]!.ownerField = 'id';
  expect(
    planMigrationMapping(unsafe, input()).issues.some(
      (issue) => issue.code === 'OWNER_PROTECTION_RULE_REQUIRED',
    ),
  ).toBe(true);
});

it('blocks email case collisions, invalid target keys and non-canonical export types', () => {
  const collision = input();
  collision.source['public.staff_users'][1]!.email = 'owner@example.invalid';
  expect(
    planMigrationMapping(manifest, collision).issues.some(
      (issue) => issue.code === 'UNIQUE_CONFLICT',
    ),
  ).toBe(true);
  const duplicate = input();
  duplicate.target.staff_users.push({ ...duplicate.target.staff_users[0]! });
  expect(
    planMigrationMapping(manifest, duplicate).issues.some(
      (issue) => issue.code === 'INVALID_TARGET_KEY',
    ),
  ).toBe(true);
  const nonCanonical = input();
  Object.assign(nonCanonical.source['public.card_sales'][0]!.snapshot, {
    date: new Date('2025-01-01'),
  });
  expect(
    planMigrationMapping(manifest, nonCanonical).issues.some(
      (issue) => issue.code === 'CANONICAL_JSON_REQUIRED',
    ),
  ).toBe(true);
  const required = structuredClone(manifest);
  required.tables[3]!.requiredReferences = ['created_by'];
  const missing = input();
  Object.assign(missing.source['public.card_sales'][0]!, { created_by: null });
  expect(
    planMigrationMapping(required, missing).issues.some(
      (issue) => issue.code === 'DANGLING_REFERENCE',
    ),
  ).toBe(true);
});

it('loads the prepared business mapping only into a new disposable database while leaving the synthetic target owner intact', async () => {
  const replica = await createTestReplica();
  try {
    const data = input();
    await replica.db
      .collection<MigrationRecord>('staff_users')
      .insertMany(structuredClone(data.target.staff_users));
    await replica.db
      .collection<MigrationRecord>('roles')
      .insertMany(structuredClone(data.target.roles));
    await replica.db
      .collection<MigrationRecord>('staff_role_assignments')
      .insertMany(structuredClone(data.target.staff_role_assignments));
    const plan = planMigrationMapping(manifest, data);
    expect(plan.ready).toBe(true);
    for (const [table, records] of Object.entries(plan.records))
      if (records.length) await replica.db.collection<MigrationRecord>(table).insertMany(records);
    expect(
      await replica.db.collection<MigrationRecord>('staff_users').findOne({ _id: 'target-owner' }),
    ).toMatchObject({ untouched: 'Current owner profile' });
    expect(
      await replica.db
        .collection<MigrationRecord>('staff_role_assignments')
        .countDocuments({ staff_id: 'target-owner' }),
    ).toBe(1);
    expect(
      await replica.db.collection<MigrationRecord>('card_sales').findOne({ _id: 'sale-one' }),
    ).toMatchObject({
      created_by: 'target-owner',
      cash_price_snapshot: '100000.01',
      snapshot: { actorId: 'source-owner' },
    });
  } finally {
    await replica.stop();
  }
}, 30000);
