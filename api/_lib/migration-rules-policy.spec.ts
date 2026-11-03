import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  reviewedRulesAndPolicyTables,
  migrationRulePolicyIssues,
  reconcileSourceRulesAndPolicies,
} from './migration-rules-policy.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { readMongoPublicVerificationSettings } from './public-verification-settings.mongo.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-31T00:00:00.123456Z';
const notice =
  'AFHomes historical privacy notice covering consent, retention, purposes and contact details for public verification. '.repeat(
    2,
  );
function fixture() {
  const definitions = reviewedRulesAndPolicyTables();
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
      {
        source: 'public.roles',
        target: 'roles',
        key: ['id'],
        columns: ['id', 'slug'],
        referenceMatch: ['slug'],
      },
      { source: 'public.ost_members', target: 'ost_members', key: ['id'], columns: ['id'] },
      ...definitions,
    ],
  };
  const source: Record<string, Record<string, unknown>[]> = {
    'public.staff_users': [{ id: id(1), email: 'owner@example.invalid', status: 'active' }],
    'public.roles': [{ id: id(3), slug: 'employee' }],
    'public.ost_members': [],
  };
  for (const table of definitions) {
    const row: Record<string, unknown> = Object.fromEntries(
      table.columns.map((column) => [column, null]),
    );
    for (const column of table.notNull ?? [])
      row[column] = table.booleans?.includes(column)
        ? true
        : table.int32?.includes(column)
          ? 1
          : table.uuids?.includes(column)
            ? id(1)
            : table.timestamps?.includes(column)
              ? at
              : table.dates?.includes(column)
                ? '2025-01-01'
                : 'Original text';
    source[table.source] = [row];
  }
  Object.assign(source['public.commission_rules']![0]!, {
    id: id(5),
    target_type: 'role',
    target_id: id(3),
    target_role_id: id(3),
    rate: '0.0850',
    updated_by: id(1),
  });
  Object.assign(source['private.public_verification_settings']![0]!, {
    privacy_notice: notice,
    verification_phone: '+639171234567',
    support_phone: '+639171234567',
    support_email: 'support@example.invalid',
    retention_days: 30,
  });
  const target: Record<string, MigrationRecord[]> = Object.fromEntries(
    manifest.tables.map((table) => [table.target, []]),
  );
  target.staff_users = [{ _id: id(2), email: 'owner@example.invalid', protected: true }];
  target.roles = [{ _id: id(4), slug: 'employee' }];
  return { manifest, source, target, definitions };
}

it('covers every rule/policy source column, PK, scalar and typed FK including generated target columns', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  );
  for (const table of reviewedRulesAndPolicyTables()) {
    const columns = inventory.columns.filter(
      (column: { schema: string; table: string }) =>
        `${column.schema}.${column.table}` === table.source,
    );
    expect(table.columns).toEqual(columns.map((column: { name: string }) => column.name));
    expect(table.notNull).toEqual(
      columns
        .filter((column: { nullable: string }) => column.nullable === 'NO')
        .map((column: { name: string }) => column.name),
    );
    for (const [type, declared] of [
      ['uuid', table.uuids],
      ['text', table.text],
      ['integer', table.int32],
      ['boolean', table.booleans],
      ['date', table.dates],
      ['timestamp with time zone', table.timestamps],
    ] as const)
      expect(declared).toEqual(
        columns
          .filter((column: { type: string }) => column.type === type)
          .map((column: { name: string }) => column.name),
      );
    const constraints = inventory.constraints.filter(
      (constraint: { schema: string; table: string }) =>
        `${constraint.schema}.${constraint.table}` === table.source,
    );
    expect(table.key).toEqual(
      constraints.find((constraint: { kind: string }) => constraint.kind === 'p').columns,
    );
    for (const fk of constraints.filter((constraint: { kind: string }) => constraint.kind === 'f'))
      expect(table.references?.[fk.columns[0]]).toBe(
        `${fk.reference_schema}.${fk.reference_table}`,
      );
  }
});

it('remaps generated commission target IDs consistently while retaining exact rates and historical policy content', () => {
  const f = fixture(),
    before = structuredClone(f.source),
    plan = planMigrationMapping(f.manifest, { source: f.source, target: f.target });
  expect(plan.issues).toEqual([]);
  expect(plan.records.commission_rules![0]).toMatchObject({
    target_id: id(4),
    target_role_id: id(4),
    target_staff_id: null,
    rate: '0.0850',
    created_by: id(2),
    updated_by: id(2),
  });
  expect(plan.records.migration_source_public_verification_settings![0]).toMatchObject({
    enabled: true,
    privacy_approved: true,
    privacy_notice: notice,
  });
  expect(plan.records.migration_source_staff_security_policy![0]).toMatchObject({
    admin_mfa_required: true,
  });
  expect(plan.records.public_verification_settings).toBeUndefined();
  expect(plan.records.mfa_policy).toBeUndefined();
  expect(reconcileSourceRulesAndPolicies(f.source)).toMatchObject({
    ready: true,
    commissionRules: 1,
    policySnapshots: 2,
    privacyApprovalTransferred: false,
    mfaRequirementTransferred: false,
  });
  expect(f.source).toEqual(before);
  const staff = fixture();
  Object.assign(staff.source['public.commission_rules']![0]!, { target_type: 'staff', target_id: id(1), target_role_id: null, target_staff_id: id(1) });
  expect(planMigrationMapping(staff.manifest, { source: staff.source, target: staff.target }).records.commission_rules![0]).toMatchObject({ target_id: id(2), target_staff_id: id(2), target_role_id: null });
});

it('blocks mismatched targets, overlapping active rules, malformed policy and active runtime policy destinations', () => {
  for (const change of ['target_mismatch', 'overlap', 'rate', 'notice', 'active_policy'] as const) {
    const f = fixture();
    if (change === 'target_mismatch') f.source['public.commission_rules']![0]!.target_id = id(8);
    if (change === 'overlap')
      f.target.commission_rules!.push({
        _id: id(9),
        target_type: 'role',
        target_id: id(4),
        rate: '0.1000',
        is_active: true,
        effective_from: '2025-06-01',
        effective_until: null,
      });
    if (change === 'rate') f.source['public.commission_rules']![0]!.rate = '1.0001';
    if (change === 'notice')
      f.source['private.public_verification_settings']![0]!.privacy_notice = '[Insert notice]';
    if (change === 'active_policy')
      f.manifest.tables.find(
        (table) => table.source === 'private.public_verification_settings',
      )!.target = 'public_verification_settings';
    expect(planMigrationMapping(f.manifest, { source: f.source, target: f.target }).ready).toBe(
      false,
    );
  }
  const f = fixture();
  expect(
    migrationRulePolicyIssues(f.definitions[1]!, {
      ...f.source['private.public_verification_settings']![0]!,
      retention_days: 0,
    }),
  ).not.toEqual([]);
});

it('loads/replays native rules and history snapshots without changing current privacy or MFA policy', async () => {
  const replica = await createTestReplica();
  try {
    const f = fixture(),
      plan = planMigrationMapping(f.manifest, { source: f.source, target: f.target });
    const native = {
      _id: 'public',
      enabled: false,
      privacyApproved: false,
      dailyLimitEnabled: true,
      verificationPhone: '+639171234567',
      privacyNotice: notice,
      retentionDays: 30,
      noticeVersion: 'native',
      revision: 8,
      updatedAt: '2026-11-01T00:00:00.000Z',
    };
    await replica.db.collection<MigrationRecord>('public_verification_settings').insertOne(native);
    await replica.db
      .collection('mfa_policy')
      .insertOne({ key: 'admin_mfa_required', value: false });
    for (const [name, rows] of Object.entries(f.target))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    for (const [name, rows] of Object.entries(plan.records))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    expect(await readMongoPublicVerificationSettings(replica.db)).toMatchObject({
      enabled: false,
      privacyApproved: false,
      revision: 8,
      cleanupReady: false,
    });
    expect(
      await replica.db.collection('mfa_policy').findOne({ key: 'admin_mfa_required' }),
    ).toMatchObject({ value: false });
    expect(
      await replica.db
        .collection<MigrationRecord>('commission_rules')
        .findOne({ target_type: 'role', target_id: id(4) }),
    ).toMatchObject({ rate: '0.0850' });
    const after: Record<string, MigrationRecord[]> = {};
    for (const table of f.manifest.tables)
      after[table.target] = await replica.db
        .collection<MigrationRecord>(table.target)
        .find()
        .toArray();
    expect(
      reconcileMigrationMapping(f.manifest, { source: f.source, target: f.target }, after).issues,
    ).toEqual([]);
    expect(
      planMigrationMapping(f.manifest, { source: f.source, target: after }).records
        .commission_rules,
    ).toEqual([]);
    expect(after.staff_users).toEqual(f.target.staff_users);
  } finally {
    await replica.stop();
  }
}, 15000);
