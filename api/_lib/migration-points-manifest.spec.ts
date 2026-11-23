import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  reviewedMembershipPointsMigrationTables,
  reconcileSourceMembershipPoints,
} from './migration-points-manifest.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoCustomerPoints } from './customer-points.mongo.js';
import { setupMongoSales } from './sales.mongo.js';
import { mongoCoreValidators } from './core-validators.mongo.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const definitions = reviewedMembershipPointsMigrationTables();
  const manifest: MigrationManifest = {
    version: 1,
    timestampPrecision: 'preserve-source',
    protectedOwner: { table: 'public.staff_users', sourceId: id(1), targetId: id(2) },
    tables: [
      {
        source: 'public.staff_users',
        target: 'staff_users',
        key: ['id'],
        columns: ['id', 'email', 'status'],
        ownerField: 'id',
        uuids: ['id'],
      },
      ...['customers', 'card_sales', 'card_plans'].map((name) => ({
        source: `public.${name}`,
        target: name,
        key: ['id'],
        columns: ['id'],
        uuids: ['id'],
      })),
      ...definitions,
    ],
  };
  const source: Record<string, Record<string, unknown>[]> = {
    'public.staff_users': [{ id: id(1), email: 'owner@example.invalid', status: 'active' }],
    'public.customers': [{ id: id(3) }],
    'public.card_sales': [{ id: id(4) }],
    'public.card_plans': [{ id: id(5) }],
  };
  for (const table of definitions)
    source[table.source] = [Object.fromEntries(table.columns.map((column) => [column, null]))];
  Object.assign(source['public.memberships']![0]!, {
    id: id(6),
    customer_id: id(3),
    sale_id: id(4),
    product_id: id(5),
    membership_number: 'AF-MEM-SYNTHETIC',
    fallback_code_hash: 'a'.repeat(64),
    qr_token_hash: 'b'.repeat(64),
    status: 'active',
    points_balance: '90',
    activated_by: id(1),
    activated_at: '2026-10-31T01:00:00.123456Z',
    expires_at: '2027-10-31T01:00:00Z',
    issued_at: '2026-10-31T01:00:00Z',
    yearly_points_allocated: 100,
    print_count: 0,
  });
  Object.assign(source['public.points_accounts']![0]!, {
    id: id(7),
    membership_id: id(6),
    balance: '90',
    lifetime_allocated: '100',
    lifetime_redeemed: '10',
    reversal_debt: '0',
    weekday_balance: '63',
    weekend_balance: '27',
    created_at: '2026-10-31T01:00:00Z',
    updated_at: '2026-10-31T01:00:00Z',
  });
  Object.assign(source['public.points_periods']![0]!, {
    id: id(8),
    account_id: id(7),
    period_start: '2026-10-31',
    period_end: '2027-10-31',
    tier: 'GOLD',
    annual_points_cap: '1000',
    opening_balance: '0',
    status: 'open',
    created_at: '2026-10-31T01:00:00Z',
  });
  Object.assign(source['public.points_ledger']![0]!, {
    id: '9223372036854775805',
    account_id: id(7),
    entry_type: 'annual_allocation',
    amount: '100',
    balance_after: '100',
    balance_before: '0',
    reference_type: 'year',
    reference_id: '2026',
    actor_id: id(1),
    metadata: { frozen: { rate: '0.10' } },
    created_at: '2026-10-31T01:00:00.123456Z',
    counts_toward_cap: true,
    origin_period_id: id(8),
    weekday_delta: '70',
    weekend_delta: '30',
  });
  source['public.points_ledger']!.push({
    ...source['public.points_ledger']![0],
    id: '9223372036854775806',
    entry_type: 'adjustment',
    amount: '-10',
    balance_before: '100',
    balance_after: '90',
    weekday_delta: '-7',
    weekend_delta: '-3',
    origin_award_id: '9223372036854775805',
    counts_toward_cap: false,
  });
  const target: Record<string, MigrationRecord[]> = Object.fromEntries(
    manifest.tables.map((table) => [table.target, []]),
  );
  target.staff_users = [
    { _id: id(2), email: 'owner@example.invalid', status: 'active', preserved: true },
  ];
  return { manifest, data: { source, target } };
}

it('covers every source column, nullability, primary key, scalar type and FK for membership and points tables', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  ) as {
    columns: { schema: string; table: string; name: string; type: string; nullable: string }[];
    constraints: {
      schema: string;
      table: string;
      kind: string;
      columns: string[];
      reference_schema: string;
      reference_table: string;
    }[];
  };
  for (const table of reviewedMembershipPointsMigrationTables()) {
    const columns = inventory.columns.filter(
      (column) => `${column.schema}.${column.table}` === table.source,
    );
    expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
    expect([...table.notNull!].sort()).toEqual(
      columns
        .filter((column) => column.nullable === 'NO')
        .map((column) => column.name)
        .sort(),
    );
    const constraints = inventory.constraints.filter(
      (constraint) => `${constraint.schema}.${constraint.table}` === table.source,
    );
    expect(table.key).toEqual(constraints.find((constraint) => constraint.kind === 'p')!.columns);
    for (const column of columns) {
      const declared =
        column.type === 'bigint'
          ? Object.keys(table.bigints!)
          : column.type === 'uuid'
            ? table.uuids
            : column.type === 'text'
              ? table.text
              : column.type === 'integer'
                ? table.int32
                : column.type === 'boolean'
                  ? table.booleans
                  : column.type === 'date'
                    ? table.dates
                    : column.type === 'timestamp with time zone'
                      ? table.timestamps
                      : [column.name];
      expect(declared).toContain(column.name);
    }
    const references = Object.fromEntries(
      constraints
        .filter((constraint) => constraint.kind === 'f')
        .map((constraint) => [
          constraint.columns[0],
          `${constraint.reference_schema}.${constraint.reference_table}`,
        ]),
    );
    expect(table.references).toEqual(references);
  }
});

it('preserves identifiers, credential hashes, period history, weekday/weekend balances and self-references', () => {
  const { manifest, data } = fixture(),
    before = structuredClone(data);
  const plan = planMigrationMapping(manifest, data);
  expect(plan.issues).toEqual([]);
  expect(plan.records.points_ledger![1]).toMatchObject({
    _id: '9223372036854775806',
    origin_award_id: '9223372036854775805',
    amount: -10,
    weekday_delta: -7,
    weekend_delta: -3,
    actor_id: id(2),
  });
  expect(plan.records.memberships![0]).toMatchObject({
    points_balance: 90,
    fallback_code_hash: 'a'.repeat(64),
    qr_token_hash: 'b'.repeat(64),
  });
  expect(data).toEqual(before);
});

it('reconciles membership mirrors, origins and the latest exact-microsecond ledger balance without rebuilding history', () => {
  const { data } = fixture();
  data.source['public.points_ledger']![1]!.created_at = '2026-10-31T01:00:00.123457Z';
  const before = structuredClone(data.source);
  expect(reconcileSourceMembershipPoints(data.source).issues).toEqual([]);
  expect(data.source).toEqual(before);
  for (const mutate of [
    (source: typeof data.source) => {
      source['public.memberships']![0]!.points_balance = '89';
    },
    (source: typeof data.source) => {
      source['public.points_ledger']![1]!.balance_after = '89';
    },
    (source: typeof data.source) => {
      source['public.points_ledger']![1]!.origin_period_id = id(99);
    },
    (source: typeof data.source) => {
      source['public.points_periods']![0]!.account_id = id(99);
    },
  ]) {
    const source = structuredClone(data.source);
    mutate(source);
    expect(reconcileSourceMembershipPoints(source).ready).toBe(false);
  }
});

it('blocks source CHECK violations, mismatched day allowances and duplicate conditional awards', () => {
  for (const [name, column, value] of [
    ['memberships', 'status', 'unknown'],
    ['memberships', 'fallback_code_hash', 'invalid'],
    ['memberships', 'points_balance', '-1'],
    ['memberships', 'print_count', -1],
    ['points_accounts', 'weekday_balance', '62'],
    ['points_accounts', 'reversal_debt', '-1'],
    ['points_periods', 'annual_points_cap', '0'],
    ['points_periods', 'period_end', '2026-10-30'],
    ['points_ledger', 'amount', '0'],
    ['points_ledger', 'weekday_delta', '71'],
    ['points_ledger', 'weekend_delta', null],
    ['points_ledger', 'metadata', []],
  ]) {
    const { manifest, data } = fixture();
    data.source[`public.${name}`]![0]![String(column)] = value;
    expect(planMigrationMapping(manifest, data)).toMatchObject({
      ready: false,
      records: {},
      issues: expect.arrayContaining([expect.objectContaining({ code: 'INVALID_POINTS_HISTORY' })]),
    });
  }
  const { manifest, data } = fixture();
  data.source['public.points_ledger']!.push({
    ...data.source['public.points_ledger']![0],
    id: '9223372036854775807',
  });
  expect(planMigrationMapping(manifest, data).issues).toContainEqual(
    expect.objectContaining({ code: 'UNIQUE_CONFLICT' }),
  );
});

it('loads converted history under native indexes/validators and reconciles an empty replay', async () => {
  const replica = await createTestReplica();
  try {
    await setupMongoCustomerPoints(replica.db);
    await setupMongoSales(replica.db);
    for (const name of ['memberships', 'points_accounts', 'points_ledger']) {
      if (!(await replica.db.listCollections({ name }).toArray()).length)
        await replica.db.createCollection(name);
      await replica.db.command({
        collMod: name,
        validator: mongoCoreValidators()[name],
        validationAction: 'error',
        validationLevel: 'strict',
      });
    }
    const { manifest, data } = fixture(),
      plan = planMigrationMapping(manifest, data);
    expect(plan.issues).toEqual([]);
    for (const [name, rows] of Object.entries(data.target))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    for (const [name, rows] of Object.entries(plan.records))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    const after: Record<string, MigrationRecord[]> = {};
    for (const table of manifest.tables)
      after[table.target] = await replica.db
        .collection<MigrationRecord>(table.target)
        .find()
        .toArray();
    expect(reconcileMigrationMapping(manifest, data, after).issues).toEqual([]);
    expect(
      planMigrationMapping(manifest, { ...data, target: after }).records.points_ledger,
    ).toEqual([]);
    expect(after.staff_users).toEqual(data.target.staff_users);
    expect(after.points_accounts![0]).toMatchObject({
      balance: 90,
      weekday_balance: 63,
      weekend_balance: 27,
    });
  } finally {
    await replica.stop();
  }
}, 15000);
