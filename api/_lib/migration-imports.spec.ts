import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  migrationImportIssues,
  reviewedImportMigrationTables,
  reconcileSourceImports,
  revalidateMigratedImportRows,
} from './migration-imports.js';
import type { ImportContext } from './customer-import.js';
import { planMigrationMapping, type MigrationManifest } from './migration-mapping.js';
import type { MigrationRecord } from './migration-mapping.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoImportJobs } from './customer-import-jobs.mongo.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-31T00:00:00.123456Z';
const ctx = (): ImportContext => ({
  plansByTier: new Map(),
  customerByNumber: new Map(),
  customerByEmail: new Map(),
  membershipByNumber: new Map(),
  referralStaffByCode: new Map(),
  seenMembershipNumbers: new Map(),
});

it('covers exact archived import columns, keys, references and source scalar declarations', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  );
  for (const table of reviewedImportMigrationTables()) {
    const columns = inventory.columns.filter(
      (c: { schema: string; table: string }) => `${c.schema}.${c.table}` === table.source,
    );
    expect(table.columns).toEqual(columns.map((c: { name: string }) => c.name));
    expect(table.notNull).toEqual(
      columns
        .filter((c: { nullable: string }) => c.nullable === 'NO')
        .map((c: { name: string }) => c.name),
    );
    for (const [type, declared] of [
      ['uuid', table.uuids],
      ['text', table.text],
      ['integer', table.int32],
      ['timestamp with time zone', table.timestamps],
    ] as const)
      expect(declared).toEqual(
        columns
          .filter((c: { type: string }) => c.type === type)
          .map((c: { name: string }) => c.name),
      );
    const constraints = inventory.constraints.filter(
      (c: { schema: string; table: string }) => `${c.schema}.${c.table}` === table.source,
    );
    expect(table.key).toEqual(constraints.find((c: { kind: string }) => c.kind === 'p').columns);
    expect(table.references).toEqual(
      Object.fromEntries(
        constraints
          .filter((c: { kind: string }) => c.kind === 'f')
          .map((c: { columns: string[]; reference_schema: string; reference_table: string }) => [
            c.columns[0],
            `${c.reference_schema}.${c.reference_table}`,
          ]),
      ),
    );
  }
});

it('retains raw values and flags under native indexes and deterministic replay, with stale commits gated', async () => {
  const definitions = reviewedImportMigrationTables();
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
      },
      ...['customers', 'memberships', 'card_sales'].map((name) => ({
        source: `public.${name}`,
        target: name,
        key: ['id'],
        columns: ['id'],
      })),
      ...definitions,
    ],
  };
  const job: Record<string, unknown> = Object.fromEntries(
    definitions[0]!.columns.map((column) => [column, null]),
  );
  Object.assign(job, {
    id: id(3),
    source_type: 'excel',
    source_name: 'Synthetic workbook',
    status: 'ready',
    total_rows: 1,
    valid_rows: 1,
    invalid_rows: 0,
    inserted_rows: 0,
    updated_rows: 0,
    skipped_rows: 0,
    failed_rows: 0,
    created_by: id(1),
    created_at: at,
    validated_at: at,
    job_number: 'SYNTHETIC-IMPORT',
  });
  const row = Object.fromEntries(definitions[1]!.columns.map((column) => [column, null]));
  Object.assign(row, {
    id: id(4),
    import_job_id: id(3),
    row_number: 2,
    raw_data: { first_name: 'Original value' },
    normalized_data: { staleSourceId: id(99), externalVerified: true },
    validation_status: 'warning',
    validation_errors: [],
    validation_warnings: [{ field: 'first_name', message: 'Original explanation' }],
    action: 'CREATE',
    created_at: at,
  });
  const source = {
    'public.staff_users': [{ id: id(1), email: 'owner@example.invalid', status: 'active' }],
    'public.customers': [],
    'public.memberships': [],
    'public.card_sales': [],
    'public.customer_import_jobs': [job],
    'public.customer_import_rows': [row],
  };
  const target = {
    staff_users: [{ _id: id(2), email: 'owner@example.invalid', protected: true }],
    customers: [],
    memberships: [],
    card_sales: [],
    customer_import_jobs: [],
    customer_import_rows: [],
  };
  const before = structuredClone(source);
  const plan = planMigrationMapping(manifest, { source, target });
  expect(plan.issues).toEqual([]);
  expect(plan.records.customer_import_jobs).toEqual([
    expect.objectContaining({
      _id: id(3),
      created_by: id(2),
      migration_revalidation_required: true,
    }),
  ]);
  expect(plan.records.customer_import_rows).toEqual([
    expect.objectContaining({
      raw_data: row.raw_data,
      normalized_data: row.normalized_data,
      validation_warnings: row.validation_warnings,
    }),
  ]);
  expect(source).toEqual(before);
  expect(reconcileSourceImports(source)).toMatchObject({
    ready: true,
    jobs: 1,
    rows: 1,
    requiresNativeRevalidation: true,
  });
  expect(migrationImportIssues(definitions[0]!, { ...job, failed_rows: -1 })).not.toEqual([]);
  expect(reconcileSourceImports({ ...source, 'public.customer_import_rows': [] }).ready).toBe(
    false,
  );
  const emptyOnly = structuredClone(manifest);
  emptyOnly.tables.find((table) => table.target === 'customer_import_jobs')!.requireEmpty = true;
  expect(planMigrationMapping(emptyOnly, { source, target }).issues).toContainEqual(
    expect.objectContaining({ code: 'NONEMPTY_SOURCE_REQUIRES_MAPPING_REVIEW' }),
  );
  const replica = await createTestReplica();
  try {
    await setupMongoImportJobs(replica.db);
    for (const [name, records] of Object.entries(target))
      if (records.length) await replica.db.collection<MigrationRecord>(name).insertMany(records);
    for (const [name, records] of Object.entries(plan.records))
      if (records.length) await replica.db.collection<MigrationRecord>(name).insertMany(records);
    const after: Record<string, MigrationRecord[]> = {};
    for (const table of manifest.tables)
      after[table.target] = await replica.db
        .collection<MigrationRecord>(table.target)
        .find()
        .toArray();
    expect(reconcileMigrationMapping(manifest, { source, target }, after).issues).toEqual([]);
    expect(
      planMigrationMapping(manifest, { source, target: after }).records.customer_import_jobs,
    ).toEqual([]);
    expect(after.staff_users).toEqual(target.staff_users);
  } finally {
    await replica.stop();
  }
}, 15000);

it('revalidates original fields without reusing old normalized claims and never changes the source evidence', async () => {
  const rows = [
    { row_number: 2, raw_data: { email: 'invalid', first_name: 'Original', last_name: 'Value' } },
  ];
  const before = structuredClone(rows);
  const result = await revalidateMigratedImportRows(rows, ctx(), [], new Map());
  expect(result.nativeCommitReady).toBe(false);
  expect(result.validated[0]!.errors.length).toBeGreaterThan(0);
  expect(rows).toEqual(before);
  await expect(
    revalidateMigratedImportRows(
      [{ row_number: 2, raw_data: { workbook_format: 'company_v2' } }],
      ctx(),
      [],
      new Map(),
    ),
  ).rejects.toThrow('original guided workbook');
  await expect(
    revalidateMigratedImportRows([...rows, ...rows], ctx(), [], new Map()),
  ).rejects.toThrow('Invalid archived');
});

it('uses the current MongoDB identity context rather than an archived customer match', async () => {
  const rows = [
    {
      row_number: 2,
      raw_data: {
        first_name: 'Synthetic',
        last_name: 'Customer',
        email: 'synthetic@example.invalid',
        mobile: '09171234567',
        payment_scheme: 'spot_cash',
        historical_sale_total: '312000.00',
        payment_date: '2025-01-01',
        payment_method: 'cash',
        source_status: 'Pending',
      },
    },
  ];
  const fresh = ctx();
  fresh.customerByEmail.set('synthetic@example.invalid', { id: id(80) });
  const result = await revalidateMigratedImportRows(rows, fresh, [], new Map());
  expect(result.validated[0]!.customerId).toBe(id(80));
  expect(result.validated[0]!.normalized?.externalVerified).not.toBe(true);
  expect(result.requiresContinuationReview).toBe(true);
});
