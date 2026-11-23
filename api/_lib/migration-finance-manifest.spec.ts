import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  reviewedFinanceMigrationTables,
  reconcileSourceFinance,
} from './migration-finance-manifest.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoSales } from './sales.mongo.js';
import { mongoCoreValidators } from './core-validators.mongo.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
  const definitions = reviewedFinanceMigrationTables();
  const parents = [
    'customers',
    'card_plans',
    'ost_members',
    'referral_relationships',
    'commission_rules',
    'customer_import_jobs',
    'customer_import_rows',
    'reservation_agreements',
  ];
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
      ...parents.map((name) => ({
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
  };
  parents.forEach((name, index) => (source[`public.${name}`] = [{ id: id(index + 3) }]));
  source['public.referral_relationships'] = [];
  source['public.reservation_agreements'] = [];
  for (const table of definitions)
    source[table.source] = [Object.fromEntries(table.columns.map((column) => [column, null]))];
  Object.assign(source['public.card_sales']![0]!, {
    id: id(20),
    sale_number: 'SYNTHETIC-SALE',
    customer_id: id(3),
    plan_id: id(4),
    seller_type: 'staff',
    seller_staff_id: id(1),
    cash_price: '1000.00',
    balance_due_at: '2026-11-01T00:00:00Z',
    status: 'active',
    created_at: '2026-10-31T00:00:00.123456Z',
    updated_at: '2026-10-31T00:00:00Z',
    cash_price_snapshot: '1000.00',
    minimum_down_payment_snapshot: '100.00',
    yearly_points_snapshot: 100,
    commission_rate_snapshot: '0.0200',
    expected_commission_snapshot: '20.00',
    created_by: id(1),
    payment_scheme: 'spot_cash',
    reservation_fee_snapshot: '100.00',
    required_initial_snapshot: '100.00',
    origin: 'normal',
    commission_rule_id: id(7),
  });
  Object.assign(source['public.payments']![0]!, {
    id: id(21),
    sale_id: id(20),
    customer_id: id(3),
    amount: '1000.00',
    method: 'cash',
    reference: 'SYNTHETIC-RECEIPT',
    status: 'verified',
    recorded_by: id(1),
    verified_by: id(1),
    recorded_at: '2026-10-31T00:00:00Z',
    verified_at: '2026-10-31T00:00:00Z',
    payment_type: 'full',
    payment_number: 'SYNTHETIC-PAYMENT',
    origin: 'sale',
  });
  Object.assign(source['public.commissions']![0]!, {
    id: id(22),
    sale_id: id(20),
    amount: '20.00',
    status: 'final_qualification_pending',
    created_at: '2026-10-31T00:00:00Z',
    beneficiary_type: 'staff',
    beneficiary_staff_id: id(1),
    rate_snapshot: '0.0200',
    basis_amount_snapshot: '1000.00',
    commission_number: 'SYNTHETIC-COMMISSION',
    settled_before_system: false,
  });
  Object.assign(source['public.card_sale_hierarchy_snapshots']![0]!, {
    sale_id: id(20),
    ancestor_staff_id: id(1),
    ancestor_role: 'sales_manager',
    depth: 0,
    captured_at: '2026-10-31T00:00:00.123456Z',
  });
  const target: Record<string, MigrationRecord[]> = Object.fromEntries(
    manifest.tables.map((table) => [table.target, []]),
  );
  target.staff_users = [
    { _id: id(2), email: 'owner@example.invalid', status: 'active', preserved: true },
  ];
  return { manifest, data: { source, target } };
}

it('matches full financial source columns, nullability, scalar types, keys and single-column foreign keys', () => {
  const schema = JSON.parse(
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
  for (const table of reviewedFinanceMigrationTables()) {
    const columns = schema.columns.filter(
      (column) => `${column.schema}.${column.table}` === table.source,
    );
    expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
    expect([...table.notNull!].sort()).toEqual(
      columns
        .filter((column) => column.nullable === 'NO')
        .map((column) => column.name)
        .sort(),
    );
    const constraints = schema.constraints.filter(
      (constraint) => `${constraint.schema}.${constraint.table}` === table.source,
    );
    expect(table.key).toEqual(constraints.find((constraint) => constraint.kind === 'p')!.columns);
    expect(table.references).toEqual(
      Object.fromEntries(
        constraints
          .filter((constraint) => constraint.kind === 'f' && constraint.columns.length === 1)
          .map((constraint) => [
            constraint.columns[0],
            `${constraint.reference_schema}.${constraint.reference_table}`,
          ]),
      ),
    );
    for (const column of columns) {
      const declaration =
        column.type === 'uuid'
          ? table.uuids
          : column.type === 'text'
            ? [...(table.text ?? []), ...(table.money ?? [])]
            : ['integer', 'smallint'].includes(column.type)
              ? table.int32
              : column.type === 'boolean'
                ? table.booleans
                : table.timestamps;
      expect(declaration).toContain(column.name);
    }
  }
});

it('preserves frozen money, payment evidence, manual commission state and sale-time ancestry without recomputing them', () => {
  const { manifest, data } = fixture(),
    saved = structuredClone(data),
    plan = planMigrationMapping(manifest, data);
  expect(plan.issues).toEqual([]);
  expect(plan.records.card_sales![0]).toMatchObject({
    cash_price_snapshot: '1000.00',
    commission_rate_snapshot: '0.0200',
    expected_commission_snapshot: '20.00',
    seller_staff_id: id(2),
  });
  expect(plan.records.commissions![0]).toMatchObject({
    amount: '20.00',
    status: 'final_qualification_pending',
    settled_before_system: false,
  });
  expect(plan.records.card_sale_hierarchy_snapshots![0]).toMatchObject({
    ancestor_staff_id: id(2),
    ancestor_role: 'sales_manager',
    depth: 0,
  });
  expect(data).toEqual(saved);
});

it('counts only verified money and checks composite reservation links while preserving manual commission decisions', () => {
  const { data } = fixture(),
    saved = structuredClone(data.source);
  expect(reconcileSourceFinance(data.source, []).issues).toEqual([]);
  expect(data.source).toEqual(saved);
  data.source['public.payments']![0]!.status = 'recorded';
  expect(reconcileSourceFinance(data.source, []).issues).toContainEqual(
    expect.objectContaining({ code: 'ACTIVE_SALE_NOT_FULLY_VERIFIED' }),
  );
  data.source['public.payments']![0]!.status = 'verified';
  data.source['public.payments']![0]!.origin = 'reservation';
  data.source['public.payments']![0]!.reservation_id = id(10);
  expect(
    reconcileSourceFinance(data.source, [{ id: id(10), sale_id: id(20), customer_id: id(3) }])
      .issues,
  ).toEqual([]);
  expect(
    reconcileSourceFinance(data.source, [{ id: id(10), sale_id: id(99), customer_id: id(3) }])
      .issues,
  ).toContainEqual(expect.objectContaining({ code: 'RESERVATION_PAYMENT_LINK_MISMATCH' }));
  data.source['public.card_sale_hierarchy_snapshots'] = [];
  expect(
    reconcileSourceFinance(data.source, [{ id: id(10), sale_id: id(20), customer_id: id(3) }])
      .warnings,
  ).toHaveLength(1);
  expect(data.source['public.commissions']![0]!.status).toBe('final_qualification_pending');
});

it('blocks source domain violations and cross-status duplicate open sales', () => {
  for (const [name, column, value] of [
    ['card_sales', 'seller_staff_id', null],
    ['card_sales', 'seller_ost_id', id(5)],
    ['card_sales', 'commission_rate_snapshot', '1.0001'],
    ['card_sales', 'installment_months_snapshot', 0],
    ['payments', 'amount', '0.50'],
    ['payments', 'payment_type', 'unknown'],
    ['payments', 'reservation_id', id(10)],
    ['commissions', 'beneficiary_staff_id', null],
    ['commissions', 'status', 'automatically_earned'],
    ['card_sale_hierarchy_snapshots', 'depth', 4],
  ]) {
    const { manifest, data } = fixture();
    data.source[`public.${name}`]![0]![String(column)] = value;
    expect(planMigrationMapping(manifest, data), `${name}.${column}`).toMatchObject({
      ready: false,
      records: {},
      issues: expect.arrayContaining([
        expect.objectContaining({ code: 'INVALID_FINANCE_HISTORY' }),
      ]),
    });
  }
  const { manifest, data } = fixture();
  data.source['public.card_sales']![0]!.status = 'draft';
  data.source['public.card_sales']!.push({
    ...data.source['public.card_sales']![0],
    id: id(99),
    sale_number: 'SECOND-SYNTHETIC-SALE',
    status: 'submitted',
  });
  expect(planMigrationMapping(manifest, data).issues).toContainEqual(
    expect.objectContaining({ code: 'UNIQUE_CONFLICT' }),
  );
});

it('retains nullable historical money, rejects required nulls and refuses malformed conditional indexes', () => {
  const { manifest, data } = fixture();
  const plan = planMigrationMapping(manifest, data);
  expect(plan.records.card_sales![0]!.monthly_amount_snapshot).toBeNull();
  data.source['public.card_sales']![0]!.cash_price = null;
  expect(planMigrationMapping(manifest, data).issues).toContainEqual(
    expect.objectContaining({ code: 'NOT_NULL_VIOLATION', column: 'cash_price' }),
  );
  for (const statuses of [[], ['draft', 'draft']]) {
    const current = fixture();
    current.manifest.tables.find(
      (table) => table.target === 'card_sales',
    )!.partialUnique![0]!.when.status = statuses;
    expect(planMigrationMapping(current.manifest, current.data).issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_PARTIAL_UNIQUE_MAPPING' }),
    );
  }
});

it('stores mapped financial history under native validators/indexes and reconciles an empty replay', async () => {
  const replica = await createTestReplica();
  try {
    await setupMongoSales(replica.db);
    for (const name of ['card_sales', 'payments', 'commissions']) {
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
    expect(planMigrationMapping(manifest, { ...data, target: after }).records.card_sales).toEqual(
      [],
    );
    expect(after.staff_users).toEqual(data.target.staff_users);
    expect(after.payments![0]!.amount).toBe('1000.00');
  } finally {
    await replica.stop();
  }
}, 15000);
