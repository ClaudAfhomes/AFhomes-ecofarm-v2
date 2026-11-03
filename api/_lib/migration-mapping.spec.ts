import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import {
  planMigrationMapping,
  migrationSourceRowKey,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  reviewedAccessMigrationTables,
  reviewedOrganizationReferenceTables,
  reviewedStaffMigrationTable,
  reviewedNetworkProfileMigrationTable,
} from './migration-access-manifest.js';
import { setupMongoOrganization } from './organization.mongo.js';
import { setupMongoMembers } from './members.mongo.js';
import {
  reviewedCatalogMigrationTables,
  reviewedPointsTierMigrationTable,
} from './migration-catalog-manifest.js';
import { setupMongoCatalog } from './catalog.mongo.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { proposedPointsTierGuards } from './migration-reference-guards.mongo.js';
import { migrationFingerprint } from './migration-fingerprint.js';
import { planMigrationLedgerIds } from './migration-ledger-ids.js';
import { planMigrationDepartmentSetup } from './migration-department-setup.js';
import { reviewedNetworkMigrationTables } from './migration-network-manifest.js';
import { setupMongoSaleTeam } from './sale-team.mongo.js';
import { setupMongoReferrals } from './referrals.mongo.js';
import { reviewedCustomerMigrationTable } from './migration-customer-manifest.js';
import { setupMongoCustomers } from './customers.mongo.js';
import { setupCustomerActivation } from './customer-activation.mongo.js';
import { toCustomer } from './customer-model.js';

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

it('prepares missing role links and new departments without overwriting native assignments or configuration', () => {
  const defined = structuredClone(manifest), data = input() as Parameters<typeof planMigrationMapping>[1];
  const roles = defined.tables.find(table => table.source === 'public.roles')!;
  roles.columns.push('department_id');
  roles.references = { department_id: 'public.departments' };
  defined.tables.push({ source: 'public.departments', target: 'departments', key: ['id'], columns: ['id', 'code', 'name', 'is_active'], booleans: ['is_active'], referenceMatch: ['code'] });
  data.source['public.departments'] = [{ id: 'source-sales', code: 'SALES', name: 'Sales', is_active: true }];
  data.source['public.roles']![0]!.department_id = 'source-sales';
  data.target.departments = [];
  const before = structuredClone(data);
  const plan = planMigrationDepartmentSetup(defined, data);
  expect(plan.issues).toEqual([]);
  expect(plan).toMatchObject({ setupReady: true, candidateReady: true, databaseWrites: false, roleFills: [{ roleId: 'target-role', departmentId: 'source-sales' }] });
  expect(plan.newDepartments).toHaveLength(1);
  expect(data).toEqual(before);
  data.target.roles![0]!.department_id = 'different-existing-department';
  expect(planMigrationDepartmentSetup(defined, data)).toMatchObject({ setupReady: false, roleFills: [] });
  data.target.roles![0]!.department_id = null;
  data.source['public.departments']![0]!.is_active = false;
  expect(planMigrationDepartmentSetup(defined, data).setupReady).toBe(false);
  data.source['public.departments']![0]!.is_active = true;
  data.source['public.roles']![0]!.slug = 'INVALID ROLE SLUG';
  expect(planMigrationDepartmentSetup(defined, data).setupReady).toBe(false);
});

it('translates colliding internal ledger IDs and typed links while preserving native rows and nested evidence', () => {
  const defined = structuredClone(manifest), data = input() as Parameters<typeof planMigrationMapping>[1];
  defined.tables.push({ source: 'public.points_ledger', target: 'points_ledger', key: ['id'], columns: ['id', 'origin_award_id', 'metadata'], bigints: { id: 'identifier', origin_award_id: 'identifier' }, references: { origin_award_id: 'public.points_ledger' } });
  data.source['public.points_ledger'] = [{ id: '1', origin_award_id: null, metadata: { originalLedgerId: '1' } }, { id: '2', origin_award_id: '1', metadata: { immutable: true } }];
  data.target.points_ledger = [{ _id: '1', origin_award_id: null, metadata: { nativeHistory: true } }];
  const before = structuredClone(data);
  const ids = planMigrationLedgerIds(data.source['public.points_ledger'], data.target.points_ledger, '1');
  const ledgerIdPlan = { existingSequence: '1', digest: ids.digest };
  expect(planMigrationMapping(defined, data).ready).toBe(false);
  const plan = planMigrationMapping(defined, { ...data, ledgerIdPlan });
  expect(plan.issues).toEqual([]);
  expect(plan.records.points_ledger).toMatchObject([{ _id: '3', origin_award_id: null, metadata: { originalLedgerId: '1' }, migration_source_ledger_id: '1' }, { _id: '4', origin_award_id: '3', migration_source_ledger_id: '2' }]);
  const after = Object.fromEntries(Object.keys(data.target).map(name => [name, [...data.target[name]!, ...plan.records[name]!]]));
  expect(reconcileMigrationMapping(defined, { ...data, ledgerIdPlan }, after).ready).toBe(true);
  expect(planMigrationMapping(defined, { ...data, target: after, ledgerIdPlan }).records.points_ledger).toEqual([]);
  expect(planMigrationMapping(defined, { ...data, ledgerIdPlan: { ...ledgerIdPlan, digest: '0'.repeat(64) } }).ready).toBe(false);
  expect(data).toEqual(before);
});

it('reuses an exact reviewed metadata conflict while retaining both native state and original source evidence', () => {
  const data = input();
  data.source['public.roles'][0]!.name = 'Historical Sales Manager';
  const saved = structuredClone(data);
  const decision = { table: 'public.roles', sourceId: 'source-role', targetId: 'target-role', sourceFingerprint: migrationFingerprint(data.source['public.roles'][0]), targetFingerprint: migrationFingerprint(data.target.roles[0]) };
  expect(planMigrationMapping(manifest, data).ready).toBe(false);
  const plan = planMigrationMapping(manifest, { ...data, referenceReuse: [decision] });
  expect(plan.issues).toEqual([]);
  expect(plan.records.roles).toEqual([]);
  expect(plan.referenceEvidence[0]).toMatchObject({ source_table: 'public.roles', target_id: 'target-role', source_values: data.source['public.roles'][0] });
  const after = Object.fromEntries(Object.keys(data.target).map(name => [name, [...data.target[name as keyof typeof data.target], ...plan.records[name]!]]));
  const replay = planMigrationMapping(manifest, { ...data, target: after, referenceReuse: [decision] });
  expect(replay.ready).toBe(true);
  expect(replay.referenceEvidence).toEqual(plan.referenceEvidence);
  expect(reconcileMigrationMapping(manifest, { ...data, referenceReuse: [decision] }, after).ready).toBe(true);
  expect(data).toEqual(saved);
  const changed = structuredClone(data);
  changed.target.roles[0]!.name = 'Newer Native Role';
  expect(planMigrationMapping(manifest, { ...changed, referenceReuse: [decision] }).ready).toBe(false);
  expect(planMigrationMapping(manifest, { ...data, referenceReuse: [decision, decision] }).ready).toBe(false);
  expect(planMigrationMapping(manifest, { ...data, referenceReuse: [{ ...decision, table: 'public.role_permissions' }] }).ready).toBe(false);
});

it('never uses metadata reuse to bypass changed role activation', () => {
  const defined = structuredClone(manifest);
  defined.tables.find(table => table.source === 'public.roles')!.columns.push('is_active');
  const data = input() as Parameters<typeof planMigrationMapping>[1];
  data.source['public.roles']![0]!.is_active = false;
  data.target.roles![0]!.is_active = true;
  const referenceReuse = [{ table: 'public.roles', sourceId: 'source-role', targetId: 'target-role', sourceFingerprint: migrationFingerprint(data.source['public.roles']![0]), targetFingerprint: migrationFingerprint(data.target.roles![0]) }];
  expect(planMigrationMapping(defined, { ...data, referenceReuse })).toMatchObject({ ready: false, referenceEvidence: [] });
});

it('does not treat different annual points caps as reusable metadata', () => {
  const defined = structuredClone(manifest), data = input() as Parameters<typeof planMigrationMapping>[1];
  const table = { source: 'public.tier_points_config', target: 'tier_points_config', key: ['tier'], columns: ['tier', 'annual_points_cap'], bigints: { annual_points_cap: 'safe_integer' as const }, referenceMatch: ['tier'] };
  defined.tables.push(table);
  const original = { tier: 'BRONZE', annual_points_cap: '100' };
  const native = { _id: 'native-tier', tier: 'BRONZE', annual_points_cap: 200 };
  data.source[table.source] = [original];
  data.target[table.target] = [native];
  const plan = planMigrationMapping(defined, { ...data, referenceReuse: [{ table: table.source, sourceId: migrationSourceRowKey(table, original), targetId: native._id, sourceFingerprint: migrationFingerprint(original), targetFingerprint: migrationFingerprint(native) }] });
  expect(plan.ready).toBe(false);
  expect(plan.issues.some(issue => issue.code === 'REFERENCE_RECORD_CONFLICT' && issue.table === table.source)).toBe(true);
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

function integerFixture() {
  const reviewed = structuredClone(manifest);
  reviewed.tables.push({
    source: 'public.points_ledger',
    target: 'points_ledger',
    key: ['id'],
    columns: ['id', 'origin_award_id', 'amount', 'balance_after', 'metadata'],
    references: { origin_award_id: 'public.points_ledger' },
    bigints: {
      id: 'identifier',
      origin_award_id: 'identifier',
      amount: 'safe_integer',
      balance_after: 'safe_integer',
    },
  });
  const data = input();
  const rows = [
    {
      id: '9007199254740993',
      origin_award_id: null as string | null,
      amount: '2000',
      balance_after: '2000',
      metadata: { original_amount: '2000', original_id: '9007199254740993' },
    },
    {
      id: '9223372036854775807',
      origin_award_id: '9007199254740993',
      amount: '-600',
      balance_after: '1400',
      metadata: { original_amount: '-600', original_id: '9223372036854775807' },
    },
  ];
  return {
    manifest: reviewed,
    data: {
      source: { ...data.source, 'public.points_ledger': rows },
      target: { ...data.target, points_ledger: [] as MigrationRecord[] },
    },
  };
}

function calendarFixture() {
  const reviewed = structuredClone(manifest),
    data = input();
  reviewed.tables.push({
    source: 'public.customers',
    target: 'customers',
    key: ['id'],
    columns: ['id', 'birth_date', 'supplementary_birthday'],
    dates: ['birth_date', 'supplementary_birthday'],
  });
  return {
    manifest: reviewed,
    data: {
      source: {
        ...data.source,
        'public.customers': [
          {
            id: 'synthetic-calendar-customer',
            birth_date: '1994-02-01',
            supplementary_birthday: null as string | null,
          },
        ],
      },
      target: { ...data.target, customers: [] as MigrationRecord[] },
    },
  };
}

it('preserves real date-only values and null without applying signup-age rules or timezone conversion', () => {
  for (const date of [
    '0001-01-01',
    '1600-02-29',
    '1900-02-28',
    '1994-02-01',
    '2000-02-29',
    '9999-12-31',
  ]) {
    const fixture = calendarFixture();
    fixture.data.source['public.customers'][0]!.birth_date = date;
    const saved = structuredClone(fixture.data);
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready).toBe(true);
    expect(plan.records.customers).toEqual([
      {
        _id: 'synthetic-calendar-customer',
        birth_date: date,
        supplementary_birthday: null,
      },
    ]);
    expect(fixture.data).toEqual(saved);
    const raw = structuredClone(fixture.manifest);
    delete raw.tables.at(-1)!.dates;
    expect(plan.checksums).toEqual(planMigrationMapping(raw, fixture.data).checksums);
    fixture.data.target.customers.push(...plan.records.customers!);
    expect(planMigrationMapping(fixture.manifest, fixture.data).records.customers).toEqual([]);
  }
});

it('blocks invalid or non-date-only exports and conflicting date adapters', () => {
  for (const date of [
    '0000-01-01',
    '1900-02-29',
    '2025-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-01-00',
    '2026-13-01',
    '2026-1-1',
    '01/02/1994',
    '2026-01-01T00:00:00Z',
    ' 2026-01-01',
    '2026-01-01 ',
    'infinity',
    '-infinity',
    '',
    1793318400000,
  ]) {
    const fixture = calendarFixture();
    Object.assign(fixture.data.source['public.customers'][0]!, { birth_date: date });
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        table: 'public.customers',
        column: 'birth_date',
        code: 'INVALID_DATE',
      }),
    );
    expect(plan.records).toEqual({});
  }
  const parsed = calendarFixture();
  Object.assign(parsed.data.source['public.customers'][0]!, {
    birth_date: new Date('1994-02-01T00:00:00Z'),
  });
  expect(planMigrationMapping(parsed.manifest, parsed.data).issues).toContainEqual(
    expect.objectContaining({ code: 'CANONICAL_JSON_REQUIRED' }),
  );
  for (const mutate of [
    (table: MigrationManifest['tables'][number]) => {
      table.dates = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.timestamps = ['birth_date'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.bigints = { birth_date: 'identifier' };
    },
    (table: MigrationManifest['tables'][number]) => {
      table.money = ['birth_date'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.references = { birth_date: 'public.staff_users' };
    },
  ]) {
    const fixture = calendarFixture();
    mutate(fixture.manifest.tables.at(-1)!);
    expect(
      planMigrationMapping(fixture.manifest, fixture.data).issues.some((issue) =>
        ['UNDECLARED_MANIFEST_COLUMN', 'INVALID_DATE_MAPPING'].includes(issue.code),
      ),
    ).toBe(true);
  }
});

function permissionFixture() {
  const reviewed = structuredClone(manifest);
  reviewed.tables.push(
    {
      source: 'public.modules',
      target: 'modules',
      key: ['id'],
      columns: ['id', 'key', 'name'],
      referenceMatch: ['key'],
    },
    {
      source: 'public.role_permissions',
      target: 'role_permissions',
      key: ['role_id', 'module_id'],
      columns: ['role_id', 'module_id', 'can_view', 'can_create', 'can_update', 'can_delete'],
      notNull: ['role_id', 'module_id', 'can_view', 'can_create', 'can_update', 'can_delete'],
      booleans: ['can_view', 'can_create', 'can_update', 'can_delete'],
      references: { role_id: 'public.roles', module_id: 'public.modules' },
      requiredReferences: ['role_id', 'module_id'],
      referenceMatch: ['role_id', 'module_id'],
      unique: [['role_id', 'module_id']],
    },
  );
  const data = input();
  return {
    manifest: reviewed,
    data: {
      source: {
        ...data.source,
        'public.modules': [{ id: 'source-module', key: 'sales.customers', name: 'Customers' }],
        'public.role_permissions': [
          {
            role_id: 'source-role',
            module_id: 'source-module',
            can_view: true,
            can_create: false,
            can_update: false,
            can_delete: false,
          },
        ],
      },
      target: {
        ...data.target,
        modules: [{ _id: 'target-module', key: 'sales.customers', name: 'Customers' }],
        role_permissions: [
          {
            _id: 'existing-grant',
            role_id: 'target-role',
            module_id: 'target-module',
            can_view: true,
            can_create: false,
            can_update: false,
            can_delete: false,
          },
        ],
      },
    },
  };
}

function assignmentFixture() {
  const reviewed = structuredClone(manifest),
    data = input();
  reviewed.tables[2] = {
    source: 'public.staff_role_assignments',
    target: 'staff_role_assignments',
    key: ['staff_id'],
    columns: ['staff_id', 'role_id', 'assigned_by', 'assigned_at'],
    notNull: ['staff_id', 'role_id', 'assigned_at'],
    references: {
      staff_id: 'public.staff_users',
      role_id: 'public.roles',
      assigned_by: 'public.staff_users',
    },
    requiredReferences: ['staff_id', 'role_id'],
    ownerField: 'staff_id',
    referenceMatch: ['staff_id'],
    unique: [['staff_id']],
    renames: { assigned_at: 'created_at' },
    timestamps: ['assigned_at'],
  };
  return {
    manifest: reviewed,
    data: {
      source: {
        ...data.source,
        'public.staff_role_assignments': [
          {
            staff_id: 'source-owner',
            role_id: 'source-role',
            assigned_by: null,
            assigned_at: '2026-10-01 08:00:00+08',
          },
          {
            staff_id: 'staff-two',
            role_id: 'source-role',
            assigned_by: 'source-owner',
            assigned_at: '2026-10-30 08:15:30.123000+08',
          },
        ],
      },
      target: {
        ...data.target,
        staff_role_assignments: [
          {
            _id: 'current-owner-assignment',
            staff_id: 'target-owner',
            role_id: 'current-role',
            assigned_by: null,
            created_at: '2025-01-01T00:00:00.000Z',
          },
          {
            _id: 'current-staff-assignment',
            staff_id: 'staff-two',
            role_id: 'target-role',
            assigned_by: 'target-owner',
            created_at: '2026-10-30T00:15:30.123Z',
          },
        ],
      },
    },
  };
}

it('blocks null required values and malformed permission booleans without rejecting false grants', () => {
  const valid = permissionFixture();
  expect(planMigrationMapping(valid.manifest, valid.data).ready).toBe(true);
  for (const flag of ['can_view', 'can_create', 'can_update', 'can_delete'] as const) {
    for (const value of [null, 'false', 'true', 0, 1, [], {}, 'SENSITIVE-SYNTHETIC-VALUE']) {
      const fixture = permissionFixture();
      fixture.data.target.role_permissions.length = 0;
      Object.assign(fixture.data.source['public.role_permissions'][0]!, { [flag]: value });
      const plan = planMigrationMapping(fixture.manifest, fixture.data);
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          table: 'public.role_permissions',
          column: flag,
          code: value === null ? 'NOT_NULL_VIOLATION' : 'INVALID_BOOLEAN',
        }),
      );
      expect(plan.records).toEqual({});
      expect(JSON.stringify(plan)).not.toContain('SENSITIVE-SYNTHETIC-VALUE');
    }
  }
  const missing = permissionFixture();
  delete (missing.data.source['public.role_permissions'][0]! as Record<string, unknown>).can_delete;
  expect(planMigrationMapping(missing.manifest, missing.data).issues).toContainEqual(
    expect.objectContaining({ code: 'MISSING_SOURCE_COLUMN', column: 'can_delete' }),
  );
  const zero = integerFixture();
  zero.manifest.tables.at(-1)!.notNull = ['amount'];
  zero.data.source['public.points_ledger'][0]!.amount = '0';
  expect(planMigrationMapping(zero.manifest, zero.data).issues).toContainEqual(
    expect.objectContaining({ code: 'INVALID_POINTS_HISTORY', column: 'amount' }),
  );
});

it('keeps reviewed access definitions isolated between dry runs', () => {
  const first = reviewedAccessMigrationTables(),
    expected = structuredClone(first);
  first[0]!.booleans!.pop();
  first[0]!.unique![0]!.push('unreviewed');
  first[0]!.references!.role_id = 'public.unreviewed';
  first[1]!.renames!.assigned_at = 'unreviewed';
  expect(reviewedAccessMigrationTables()).toEqual(expected);
  const parents = reviewedOrganizationReferenceTables(),
    saved = structuredClone(parents);
  parents[0]!.text!.pop();
  parents[1]!.int32!.pop();
  parents[2]!.references!.department_id = 'public.unreviewed';
  expect(reviewedOrganizationReferenceTables()).toEqual(saved);
});

it('matches access and assignment declarations and supported CHECKs to the recorded schema', () => {
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
      definition: string;
      reference_schema: string | null;
      reference_table: string | null;
      reference_columns: string[];
    }[];
  };
  const reviewed = reviewedAccessMigrationTables();
  expect(reviewed.map((table) => table.source).sort()).toEqual([
    'public.role_permissions',
    'public.staff_permission_restrictions',
    'public.staff_role_assignments',
  ]);
  const parents = reviewedOrganizationReferenceTables();
  expect(parents.map((table) => table.source).sort()).toEqual([
    'public.departments',
    'public.modules',
    'public.roles',
  ]);
  for (const table of [...reviewed, ...parents]) {
    const columns = schema.columns.filter(
      (column) => `${column.schema}.${column.table}` === table.source,
    );
    expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
    expect([...(table.notNull ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.nullable === 'NO')
        .map((column) => column.name)
        .sort(),
    );
    expect([...(table.booleans ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === 'boolean')
        .map((column) => column.name)
        .sort(),
    );
    expect([...(table.uuids ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === 'uuid')
        .map((column) => column.name)
        .sort(),
    );
    expect([...(table.timestamps ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === 'timestamp with time zone')
        .map((column) => column.name)
        .sort(),
    );
    expect(table.key).toEqual(
      schema.constraints.find(
        (constraint) =>
          `${constraint.schema}.${constraint.table}` === table.source && constraint.kind === 'p',
      )!.columns,
    );
    const foreign = schema.constraints.filter(
      (constraint) =>
        `${constraint.schema}.${constraint.table}` === table.source && constraint.kind === 'f',
    );
    for (const constraint of foreign) {
      expect(constraint.columns).toHaveLength(1);
      expect(constraint.reference_columns).toEqual(['id']);
    }
    expect(table.references ?? {}).toEqual(
      Object.fromEntries(
        foreign.map((constraint) => [
          constraint.columns[0],
          `${constraint.reference_schema}.${constraint.reference_table}`,
        ]),
      ),
    );
    expect([...(table.requiredReferences ?? [])].sort()).toEqual(
      foreign
        .filter(
          (constraint) =>
            columns.find((column) => column.name === constraint.columns[0])!.nullable === 'NO',
        )
        .map((constraint) => constraint.columns[0])
        .sort(),
    );
    expect([...(table.text ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === 'text')
        .map((column) => column.name)
        .sort(),
    );
    expect([...(table.int32 ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === 'integer')
        .map((column) => column.name)
        .sort(),
    );
    expect(table.referenceMatch).toEqual(
      table.key[0] === 'id'
        ? [table.target === 'roles' ? 'slug' : table.target === 'modules' ? 'key' : 'code']
        : table.key,
    );
    if (table.key[0] !== 'id') expect(table.unique).toContainEqual(table.key);
    for (const unique of schema.constraints.filter(
      (constraint) =>
        `${constraint.schema}.${constraint.table}` === table.source && constraint.kind === 'u',
    ))
      expect(table.unique).toContainEqual(unique.columns);
  }
  for (const [table, definitions] of Object.entries({
    roles: ["CHECK (slug ~ '^[a-z][a-z0-9_]{1,63}$'::text)"],
    modules: ["CHECK (key ~ '^[a-z][a-z0-9_.]{2,79}$'::text)"],
    departments: ["CHECK (code ~ '^[A-Z][A-Z0-9_]{1,31}$'::text)"],
    role_permissions: [
      'CHECK (NOT can_create OR can_view)',
      'CHECK (NOT can_update OR can_view)',
      'CHECK (NOT can_delete OR can_view)',
    ],
    staff_permission_restrictions: [
      'CHECK (deny_view OR deny_create OR deny_update OR deny_delete)',
    ],
  }))
    expect(
      schema.constraints
        .filter(
          (constraint) =>
            constraint.schema === 'public' && constraint.table === table && constraint.kind === 'c',
        )
        .map((constraint) => constraint.definition)
        .sort(),
    ).toEqual([...definitions].sort());
});

it('requires assignment timestamps while preserving nullable actors and protected owner assignments', () => {
  const missing = assignmentFixture();
  missing.data.target.staff_role_assignments.pop();
  Object.assign(missing.data.source['public.staff_role_assignments'][1]!, { assigned_at: null });
  expect(planMigrationMapping(missing.manifest, missing.data).issues).toContainEqual(
    expect.objectContaining({ code: 'NOT_NULL_VIOLATION', column: 'assigned_at' }),
  );
  const nullable = assignmentFixture();
  nullable.data.target.staff_role_assignments.pop();
  nullable.data.source['public.staff_role_assignments'][1]!.assigned_by = null;
  Object.assign(nullable.data.source['public.staff_role_assignments'][0]!, { assigned_at: null });
  const plan = planMigrationMapping(nullable.manifest, nullable.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.staff_role_assignments).toEqual([
    expect.objectContaining({ assigned_by: null, staff_id: 'staff-two' }),
  ]);
  expect(plan.excluded).toContainEqual(
    expect.objectContaining({
      table: 'public.staff_role_assignments',
      reason: 'PROTECTED_OWNER',
    }),
  );
});

it('refuses undeclared required/boolean columns and overlapping boolean conversions', () => {
  for (const mutate of [
    (table: MigrationManifest['tables'][number]) => {
      table.notNull = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.booleans = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.booleans = ['role_id'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.bigints = { can_view: 'identifier' };
    },
    (table: MigrationManifest['tables'][number]) => {
      table.dates = ['can_view'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.timestamps = ['can_view'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.money = ['can_view'];
    },
  ]) {
    const fixture = permissionFixture();
    mutate(fixture.manifest.tables.at(-1)!);
    expect(
      planMigrationMapping(fixture.manifest, fixture.data).issues.some((issue) =>
        ['UNDECLARED_MANIFEST_COLUMN', 'INVALID_BOOLEAN_MAPPING'].includes(issue.code),
      ),
    ).toBe(true);
  }
});

it('maps SQL assignment fields and timezone text before matching without changing raw checksums or the owner', () => {
  const fixture = assignmentFixture(),
    saved = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.staff_role_assignments).toEqual([]);
  expect(plan.mapping).toContainEqual(
    expect.objectContaining({
      table: 'public.staff_role_assignments',
      targetId: 'current-staff-assignment',
    }),
  );
  const rawManifest = structuredClone(fixture.manifest);
  delete rawManifest.tables[2]!.timestamps;
  expect(plan.checksums).toEqual(planMigrationMapping(rawManifest, fixture.data).checksums);
  expect(fixture.data).toEqual(saved);
  fixture.data.target.staff_role_assignments.pop();
  const newPlan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(newPlan.ready).toBe(true);
  expect(newPlan.records.staff_role_assignments).toEqual([
    {
      _id: expect.stringMatching(/^migration-/),
      staff_id: 'staff-two',
      role_id: 'target-role',
      assigned_by: 'target-owner',
      created_at: '2026-10-30T00:15:30.123Z',
    },
  ]);
  fixture.data.target.staff_role_assignments.push(
    ...(newPlan.records
      .staff_role_assignments! as typeof fixture.data.target.staff_role_assignments),
  );
  expect(
    planMigrationMapping(fixture.manifest, fixture.data).records.staff_role_assignments,
  ).toEqual([]);
});

it('normalizes only explicitly declared timestamp text with no fractional precision loss', () => {
  for (const [source, expected] of [
    ['2024-02-29 23:59:59.1Z', '2024-02-29T23:59:59.100Z'],
    ['2026-10-30T08:15:30.123+08:00', '2026-10-30T00:15:30.123Z'],
    ['2026-10-30 08:15:30+0800', '2026-10-30T00:15:30.000Z'],
    ['2026-01-01 00:00:00-05:30', '2026-01-01T05:30:00.000Z'],
    ['2026-01-01 00:00:00.000000+08', '2025-12-31T16:00:00.000Z'],
  ]) {
    const fixture = assignmentFixture();
    fixture.data.source['public.staff_role_assignments'][1]!.assigned_at = source!;
    fixture.data.target.staff_role_assignments.pop();
    Object.assign(fixture.data.source['public.card_sales'][0]!.snapshot, { assigned_at: source });
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready).toBe(true);
    expect(plan.records.staff_role_assignments![0]!.created_at).toBe(expected);
    expect(plan.records.card_sales![0]!.snapshot).toMatchObject({ assigned_at: source });
  }
});

it('preserves exact source timestamp evidence only with the explicit lossless migration policy', () => {
  const fixture = assignmentFixture();
  fixture.manifest.timestampPrecision = 'preserve-source';
  fixture.data.target.staff_role_assignments.pop();
  const raw = '2026-10-30 08:15:30.123456+08';
  fixture.data.source['public.staff_role_assignments'][1]!.assigned_at = raw;
  const saved = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.issues).toEqual([]);
  expect(plan.records.staff_role_assignments![0]).toMatchObject({
    created_at: '2026-10-30T00:15:30.123Z',
    migration_source_timestamps: { assigned_at: raw },
  });
  expect(fixture.data).toEqual(saved);
  fixture.data.target.staff_role_assignments.push(
    ...(plan.records.staff_role_assignments! as typeof fixture.data.target.staff_role_assignments),
  );
  expect(planMigrationMapping(fixture.manifest, fixture.data).records.staff_role_assignments).toEqual([]);
  fixture.data.source['public.staff_role_assignments'][1]!.assigned_at = raw.replace('456', '457');
  const changed = planMigrationMapping(fixture.manifest, fixture.data);
  expect(changed.ready).toBe(false);
  expect(changed.issues).toContainEqual(expect.objectContaining({ code: 'REFERENCE_RECORD_CONFLICT' }));
  expect(changed.digest).not.toBe(plan.digest);
});

it('stores timestamp evidence in native BSON and preserves it through replay and reconciliation', async () => {
  const replica = await createTestReplica();
  try {
    const fixture = assignmentFixture();
    fixture.manifest.timestampPrecision = 'preserve-source';
    fixture.data.target.staff_role_assignments.pop();
    fixture.data.source['public.staff_role_assignments'][1]!.assigned_at = '2026-10-30 08:15:30.123456+08';
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.issues).toEqual([]);
    for (const [name, rows] of Object.entries(fixture.data.target))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    for (const [name, rows] of Object.entries(plan.records))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    const target: Record<string, MigrationRecord[]> = {};
    for (const name of Object.keys(fixture.data.target))
      target[name] = await replica.db.collection<MigrationRecord>(name).find().toArray();
    expect(planMigrationMapping(fixture.manifest, { ...fixture.data, target }).issues).toEqual([]);
    expect(planMigrationMapping(fixture.manifest, { ...fixture.data, target }).records.staff_role_assignments).toEqual([]);
    expect(reconcileMigrationMapping(fixture.manifest, fixture.data, target).issues).toEqual([]);
    expect(target.staff_role_assignments!.find((row) => row.staff_id === 'staff-two')!.migration_source_timestamps).toEqual({ assigned_at: '2026-10-30 08:15:30.123456+08' });
  } finally {
    await replica.stop();
  }
}, 15000);

it('rejects invalid timestamps and forged provenance under the preservation policy', () => {
  for (const raw of ['2025-02-29T00:00:00.123456Z', '2026-01-01T00:00:00.1234567Z', '2026-01-01 00:00:00.123456']) {
    const fixture = assignmentFixture();
    fixture.manifest.timestampPrecision = 'preserve-source';
    fixture.data.source['public.staff_role_assignments'][1]!.assigned_at = raw;
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
  }
  for (const rename of [false, true]) {
    const fixture = assignmentFixture();
    fixture.manifest.timestampPrecision = 'preserve-source';
    if (rename) fixture.manifest.tables[2]!.renames = { assigned_at: 'migration_source_timestamps' };
    else fixture.manifest.tables[2]!.columns.push('migration_source_timestamps');
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
  }
});

it('rejects ambiguous, invalid and sub-millisecond timestamps rather than guessing or truncating', () => {
  for (const source of [
    '2026-10-30 08:15:30.123001+08',
    '2026-10-30T08:15:30.000001Z',
    '2026-10-30 08:15:30',
    '2026-10-30',
    '2025-02-29T00:00:00Z',
    '2026-04-31T00:00:00Z',
    '2026-01-01T24:00:00Z',
    '2026-01-01T00:00:60Z',
    '2026-01-01T00:00:00+24:00',
    '2026-01-01T00:00:00+08:60',
    '0000-01-01T00:00:00Z',
    'infinity',
    '-infinity',
    1793319330123,
    new Date('2026-10-30T00:15:30.123Z'),
  ]) {
    const fixture = assignmentFixture();
    fixture.data.target.staff_role_assignments.pop();
    Object.assign(fixture.data.source['public.staff_role_assignments'][1]!, {
      assigned_at: source,
    });
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready).toBe(false);
    expect(plan.records).toEqual({});
  }
});

it('blocks unsafe field renames, collisions, undeclared columns and overlapping scalar adapters', () => {
  for (const destination of [
    '_id',
    'id',
    '__proto__',
    'constructor',
    'password',
    'encrypted_password',
    'secret',
    'refresh_token',
    'role_id',
    'nested.field',
    '$set',
  ]) {
    const fixture = assignmentFixture();
    fixture.data.target.staff_role_assignments.pop();
    fixture.manifest.tables[2]!.renames = { assigned_at: destination };
    expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_RENAME_MAPPING' }),
    );
  }
  for (const mutate of [
    (table: MigrationManifest['tables'][number]) => {
      table.renames = { unreviewed: 'created_at' };
    },
    (table: MigrationManifest['tables'][number]) => {
      table.renames = { staff_id: 'other_staff' };
    },
    (table: MigrationManifest['tables'][number]) => {
      table.timestamps = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.timestamps = ['role_id'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.bigints = { assigned_at: 'identifier' };
    },
  ]) {
    const fixture = assignmentFixture();
    fixture.data.target.staff_role_assignments.pop();
    mutate(fixture.manifest.tables[2]!);
    expect(
      planMigrationMapping(fixture.manifest, fixture.data).issues.some((issue) =>
        [
          'INVALID_RENAME_MAPPING',
          'UNDECLARED_MANIFEST_COLUMN',
          'INVALID_TIMESTAMP_MAPPING',
        ].includes(issue.code),
      ),
    ).toBe(true);
  }
});

it('loads source-shaped assignments with native fields and one assignment per staff while preserving the owner', async () => {
  const replica = await createTestReplica();
  try {
    const fixture = assignmentFixture();
    fixture.data.target.staff_role_assignments.pop();
    for (const [name, rows] of Object.entries(fixture.data.target))
      if (rows.length)
        await replica.db.collection<MigrationRecord>(name).insertMany(structuredClone(rows));
    const assignments = replica.db.collection<MigrationRecord>('staff_role_assignments');
    await assignments.createIndex({ staff_id: 1 }, { unique: true });
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready).toBe(true);
    for (const [name, rows] of Object.entries(plan.records))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    expect(await assignments.findOne({ staff_id: 'target-owner' })).toEqual(
      fixture.data.target.staff_role_assignments[0],
    );
    expect(await assignments.findOne({ staff_id: 'staff-two' })).toEqual({
      _id: expect.stringMatching(/^migration-/),
      staff_id: 'staff-two',
      role_id: 'target-role',
      assigned_by: 'target-owner',
      created_at: '2026-10-30T00:15:30.123Z',
    });
    expect(await assignments.countDocuments({ assigned_at: { $exists: true } })).toBe(0);
    const target = Object.fromEntries(
      await Promise.all(
        Object.keys(fixture.data.target).map(async (name) => [
          name,
          await replica.db.collection<MigrationRecord>(name).find().toArray(),
        ]),
      ),
    );
    const replay = planMigrationMapping(fixture.manifest, { source: fixture.data.source, target });
    expect(replay.ready).toBe(true);
    expect(Object.values(replay.records).flat()).toEqual([]);
  } finally {
    await replica.stop();
  }
}, 30000);

it('matches composite permission keys after parent aliases resolve, independent of manifest order', () => {
  const fixture = permissionFixture(),
    saved = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.role_permissions).toEqual([]);
  expect(plan.mapping).toContainEqual(
    expect.objectContaining({
      table: 'public.role_permissions',
      targetId: 'existing-grant',
    }),
  );
  expect(plan.excluded).toContainEqual(
    expect.objectContaining({
      table: 'public.role_permissions',
      reason: 'REFERENCE_REUSED',
    }),
  );
  fixture.manifest.tables.reverse();
  const reordered = planMigrationMapping(fixture.manifest, fixture.data);
  expect(reordered.ready).toBe(true);
  expect(reordered.records).toEqual(plan.records);
  expect(reordered.mapping).toEqual(plan.mapping);
  expect(fixture.data).toEqual(saved);
});

it('blocks every differing permission flag without overwriting or merging existing grants', () => {
  for (const flag of ['can_view', 'can_create', 'can_update', 'can_delete'] as const) {
    const fixture = permissionFixture(),
      row = fixture.data.source['public.role_permissions'][0]!;
    row[flag] = !row[flag];
    const saved = structuredClone(fixture.data);
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({
        table: 'public.role_permissions',
        code: 'REFERENCE_RECORD_CONFLICT',
      }),
    );
    expect(plan.records).toEqual({});
    expect(fixture.data).toEqual(saved);
  }
});

it('gives new composite-key grants stable IDs and preserves them across retries', () => {
  const fixture = permissionFixture();
  fixture.data.target.role_permissions.length = 0;
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.role_permissions).toEqual([
    expect.objectContaining({
      _id: expect.stringMatching(/^migration-/),
      role_id: 'target-role',
      module_id: 'target-module',
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    }),
  ]);
  fixture.data.target.role_permissions.push(
    ...(plan.records.role_permissions! as typeof fixture.data.target.role_permissions),
  );
  const replay = planMigrationMapping(fixture.manifest, fixture.data);
  expect(replay.ready).toBe(true);
  expect(replay.records.role_permissions).toEqual([]);
  fixture.data.target.role_permissions.push({
    ...fixture.data.target.role_permissions[0]!,
    _id: 'duplicate-grant',
  });
  expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
    expect.objectContaining({
      code: 'AMBIGUOUS_REFERENCE_MATCH',
      table: 'public.role_permissions',
    }),
  );
});

it('blocks missing permission parents and unresolved reference-match cycles', () => {
  const fixture = permissionFixture();
  fixture.data.source['public.role_permissions'][0]!.module_id = 'missing-module';
  expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
    expect.objectContaining({
      code: 'DANGLING_REFERENCE',
      column: 'module_id',
    }),
  );
  const cycle = permissionFixture();
  cycle.manifest.tables[1]!.references = { name: 'public.modules' };
  cycle.manifest.tables.find((table) => table.target === 'modules')!.references = {
    name: 'public.roles',
  };
  cycle.data.source['public.roles'][0]!.name = 'source-module';
  cycle.data.source['public.modules'][0]!.name = 'source-role';
  const plan = planMigrationMapping(cycle.manifest, cycle.data);
  expect(plan.records).toEqual({});
  expect(plan.issues).toContainEqual(
    expect.objectContaining({ code: 'REFERENCE_MATCH_DEPENDENCY_CYCLE' }),
  );
});

function restrictionFixture() {
  const fixture = permissionFixture();
  fixture.manifest.tables.push({
    source: 'public.staff_permission_restrictions',
    target: 'staff_permission_restrictions',
    key: ['staff_id', 'module_id'],
    columns: ['staff_id', 'module_id', 'deny_view', 'deny_create', 'deny_update', 'deny_delete'],
    notNull: ['staff_id', 'module_id', 'deny_view', 'deny_create', 'deny_update', 'deny_delete'],
    booleans: ['deny_view', 'deny_create', 'deny_update', 'deny_delete'],
    references: { staff_id: 'public.staff_users', module_id: 'public.modules' },
    ownerField: 'staff_id',
    requiredReferences: ['staff_id', 'module_id'],
    referenceMatch: ['staff_id', 'module_id'],
    unique: [['staff_id', 'module_id']],
  });
  const staffDeny = {
    staff_id: 'staff-two',
    module_id: 'source-module',
    deny_view: false,
    deny_create: true,
    deny_update: true,
    deny_delete: true,
  };
  const data = {
    source: {
      ...fixture.data.source,
      'public.staff_permission_restrictions': [
        { ...staffDeny, staff_id: 'source-owner', deny_create: false },
        staffDeny,
      ],
    },
    target: {
      ...fixture.data.target,
      staff_permission_restrictions: [
        { ...staffDeny, _id: 'owner-deny', staff_id: 'target-owner', module_id: 'target-module' },
        { ...staffDeny, _id: 'existing-deny', module_id: 'target-module' },
      ],
    },
  };
  return { manifest: fixture.manifest, data, staffDeny };
}

function uuidFixture() {
  const fixture = restrictionFixture(),
    assignments = assignmentFixture();
  fixture.manifest.tables[2] = assignments.manifest.tables[2]!;
  const ids: Record<string, string> = Object.fromEntries(
    [
      'source-owner',
      'target-owner',
      'staff-two',
      'source-role',
      'target-role',
      'source-module',
      'target-module',
      'current-role',
    ].map((name, index) => [
      name,
      `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    ]),
  );
  const mapRow = (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key,
        typeof value === 'string' ? (ids[value] ?? value) : value,
      ]),
    );
  const source = {
    ...fixture.data.source,
    'public.staff_role_assignments': assignments.data.source['public.staff_role_assignments'],
  };
  const target = {
    ...fixture.data.target,
    staff_role_assignments: assignments.data.target.staff_role_assignments,
  };
  for (const table of fixture.manifest.tables) {
    if (['staff_users', 'roles', 'modules'].includes(table.target)) table.uuids = ['id'];
    if (table.target === 'staff_role_assignments')
      table.uuids = ['staff_id', 'role_id', 'assigned_by'];
    if (['role_permissions', 'staff_permission_restrictions'].includes(table.target))
      table.uuids = Object.keys(table.references!);
  }
  for (const table of reviewedAccessMigrationTables()) {
    const index = fixture.manifest.tables.findIndex(
      (candidate) => candidate.source === table.source,
    );
    fixture.manifest.tables[index] = table;
  }
  fixture.manifest.protectedOwner.sourceId = ids['source-owner']!;
  fixture.manifest.protectedOwner.targetId = ids['target-owner']!;
  return {
    manifest: fixture.manifest,
    ids,
    data: {
      source: Object.fromEntries(
        Object.entries(source).map(([name, rows]) => [name, rows.map(mapRow)]),
      ),
      target: Object.fromEntries(
        Object.entries(target).map(([name, rows]) => [name, rows.map(mapRow) as MigrationRecord[]]),
      ),
    },
  };
}

function organizationFixture() {
  const fixture = uuidFixture();
  const sourceDepartment = '00000000-0000-4000-8000-000000000010';
  const targetDepartment = '00000000-0000-4000-8000-000000000011';
  const sourceTimes = {
    created_at: '2026-10-01 08:00:00.000000+08',
    updated_at: '2026-10-01 08:00:00+08',
  };
  const targetTimes = {
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-01T00:00:00.000Z',
  };
  Object.assign(fixture.data.source['public.roles']![0]!, sourceTimes, {
    is_system: false,
    is_active: true,
    department_id: sourceDepartment,
  });
  Object.assign(fixture.data.target.roles![0]!, targetTimes, {
    is_system: false,
    is_active: true,
    department_id: targetDepartment,
  });
  for (const row of fixture.data.source['public.modules']!)
    Object.assign(row, { group_name: 'Sales', sort_order: 10, is_active: true });
  for (const row of fixture.data.target.modules!)
    Object.assign(row, { group_name: 'Sales', sort_order: 10, is_active: true });
  fixture.data.source['public.departments'] = [
    { id: sourceDepartment, code: 'SALES', name: 'Sales', is_active: true, ...sourceTimes },
  ];
  fixture.data.target.departments = [
    { _id: targetDepartment, code: 'SALES', name: 'Sales', is_active: true, ...targetTimes },
  ];
  for (const table of reviewedOrganizationReferenceTables()) {
    const index = fixture.manifest.tables.findIndex(
      (candidate) => candidate.source === table.source,
    );
    if (index === -1) fixture.manifest.tables.push(table);
    else fixture.manifest.tables[index] = table;
  }
  return fixture;
}

function staffFixture() {
  const fixture = organizationFixture();
  const table = reviewedStaffMigrationTable();
  fixture.manifest.tables[
    fixture.manifest.tables.findIndex((candidate) => candidate.target === 'staff_users')
  ] = table;
  for (const [index, row] of fixture.data.source['public.staff_users']!.entries())
    Object.assign(row, {
      full_name: index === 0 ? 'Synthetic Source Owner' : 'Synthetic Migrating Staff',
      department_id: fixture.data.source['public.departments']![0]!.id,
      invited_at: null,
      activated_at: '2026-10-01T00:00:00Z',
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      must_change_password: true,
      password_changed_at: null,
      employee_number: index === 0 ? 'SOURCE-OWNER-EMP' : 'SYNTHETIC-STAFF-EMP',
      sales_number: null,
    });
  const identities = {
    source: fixture.data.source['public.staff_users']!.map((row) => ({
      id: String(row.id),
      email: String(row.email),
    })),
    target: [
      { id: fixture.ids['target-owner']!, email: 'OWNER@example.invalid' },
      { id: fixture.ids['staff-two']!, email: 'staff@example.invalid' },
    ],
  };
  return { ...fixture, data: { ...fixture.data, identities } };
}

function networkProfileFixture() {
  const fixture = staffFixture();
  const table = reviewedNetworkProfileMigrationTable();
  fixture.manifest.tables.push(table);
  const profile = {
    staff_id: fixture.ids['staff-two'],
    date_of_birth: '1990-02-01',
    sex: 'Male',
    civil_status: 'Single',
    street_no: 'Synthetic street',
    city_municipality: 'Synthetic city',
    province: 'Synthetic province',
    zip_code: '',
    tel_no: null,
    mobile_no: 'SYNTHETIC-PHONE',
    fb_messenger: null,
    tin: null,
    employer_name: 'Synthetic employer',
    employer_address: 'Synthetic address',
    job_position: 'Synthetic position',
    government_id_type: 'Synthetic ID',
    government_id_number: 'FICTIONAL-PROFILE-ID',
    referrer_staff_id: fixture.ids['source-owner'],
    ost_referrer_staff_id: null,
    province_code: '0100000000',
    city_municipality_code: '0100100000',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
  fixture.data.source[table.source] = [
    { ...profile, staff_id: fixture.ids['source-owner'] },
    profile,
  ];
  fixture.data.target[table.target] = [
    {
      _id: 'existing-owner-profile',
      staff_id: fixture.ids['target-owner'],
      mobile_no: 'SYNTHETIC-CURRENT',
    },
  ];
  return fixture;
}

function catalogFixture() {
  const fixture = networkProfileFixture();
  fixture.manifest.tables.push(...reviewedCatalogMigrationTables());
  fixture.manifest.tables.push(reviewedPointsTierMigrationTable());
  fixture.data.source['public.tier_points_config'] = [
    {
      tier: 'GOLD',
      annual_points_cap: '60000',
      updated_at: '2026-10-01T00:00:00Z',
      updated_by: fixture.ids['source-owner'],
    },
  ];
  fixture.data.target.tier_points_config = [];
  const categoryId = '00000000-0000-4000-8000-000000000050';
  const targetCategoryId = '00000000-0000-4000-8000-000000000051';
  const planId = '00000000-0000-4000-8000-000000000052';
  const category = {
    id: categoryId,
    slug: 'membership',
    name: 'Synthetic membership',
    description: null,
    is_active: true,
    sort_order: 0,
  };
  fixture.data.source['public.card_categories'] = [category];
  fixture.data.target.card_categories = [
    { ...category, id: undefined, _id: targetCategoryId } as MigrationRecord,
  ];
  delete fixture.data.target.card_categories[0]!.id;
  fixture.data.source['public.card_plans'] = [
    {
      id: planId,
      category_id: categoryId,
      code: 'SYNTHETIC-GOLD',
      name: 'Synthetic Gold',
      cash_price: '312000.00',
      minimum_down_payment: '10000.00',
      yearly_points: 25000,
      commission_rate: '0.1234',
      is_active: true,
      created_at: '2026-10-01T00:00:00Z',
      updated_at: '2026-10-01T00:00:00Z',
      sort_order: 1,
      installment_price: '400000.00',
      reservation_fee: '10000.00',
      spot_cash_days: 7,
      standard_installment_months: 24,
      validity_years: 22,
      move_a_enabled: true,
      move_b1_enabled: false,
      move_b2_enabled: true,
      discount_percent: 25,
      base_validity_years: 20,
      validity_extension_years: 2,
      cardholder_limit: 2,
      annual_points_tranches: 20,
      total_loyalty_value: '500000.00',
      priority_reservation: true,
      no_monthly_annual_dues: true,
      description: null,
    },
  ];
  fixture.data.target.card_plans = [];
  return fixture;
}

function networkFixture() {
  const fixture = catalogFixture();
  fixture.manifest.tables.push(...reviewedNetworkMigrationTables());
  const time = '2026-10-01T00:00:00Z';
  fixture.data.source['public.referral_relationships'] = [
    {
      id: '00000000-0000-4000-8000-000000000060',
      subject_staff_id: fixture.ids['staff-two'],
      upline_staff_id: fixture.ids['source-owner'],
      hierarchy_role: 'sales_manager',
      is_authoritative: true,
      is_active: true,
      assigned_by: fixture.ids['source-owner'],
      assigned_at: time,
      created_at: time,
      updated_at: time,
    },
  ];
  fixture.data.target.referral_relationships = [];
  const accreditation = {
    staff_id: fixture.ids['staff-two'],
    aa_number: 'AAI26100001',
    public_name: 'Synthetic original name',
    kind: 'IST',
    status: 'active',
    starts_on: null,
    expires_on: null,
    approved_by: fixture.ids['source-owner'],
    approved_at: time,
    revoked_by: null,
    revoked_at: null,
  };
  fixture.data.source['private.sale_team_accreditations'] = [
    accreditation,
    { ...accreditation, staff_id: fixture.ids['source-owner'], aa_number: 'AAI26100003' },
  ];
  fixture.data.target.sale_team_accreditations = [
    {
      ...accreditation,
      _id: 'existing-owner-aa',
      staff_id: fixture.ids['target-owner'],
      aa_number: 'AAI26100099',
      approved_by: fixture.ids['target-owner'],
    },
  ];
  fixture.data.source['private.sale_team_accreditation_history'] = [
    {
      id: '00000000-0000-4000-8000-000000000061',
      staff_id: fixture.ids['staff-two'],
      aa_number: 'AAO26090002',
      kind: 'OST',
      public_name: 'Synthetic historical name',
      starts_on: '2026-09-01',
      expires_on: '2027-09-01',
      status: 'superseded',
      event: 'transferred',
      successor_aa_number: accreditation.aa_number,
      reason: 'Synthetic original reason',
      recorded_by: fixture.ids['source-owner'],
      recorded_at: time,
    },
  ];
  fixture.data.target.sale_team_accreditation_history = [];
  return fixture;
}

function customerFixture() {
  const fixture = networkFixture();
  const table = reviewedCustomerMigrationTable();
  fixture.manifest.tables.push(table);
  const row: Record<string, unknown> = Object.fromEntries(
    table.columns.map((column) => [column, null]),
  );
  for (const column of table.notNull ?? []) row[column] = 'SYNTHETIC';
  Object.assign(row, {
    id: '00000000-0000-4000-8000-000000000070',
    auth_user_id: '00000000-0000-4000-8000-000000000071',
    email: 'portal@example.invalid',
    customer_number: 'AF-CUS-SYNTHETIC',
    customer_code: 'AF-CC-SYNTHETIC',
    first_name: 'Synthetic',
    last_name: 'Portal',
    phone: 'SYNTHETIC-PHONE',
    status: 'active',
    created_by: fixture.ids['source-owner'],
    referred_by_staff_id: fixture.ids['staff-two'],
    address: { province: 'Synthetic province', historicalActorId: fixture.ids['source-owner'] },
    registration_source: 'admin',
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
    government_id_type: 'Synthetic ID',
    government_id_number: 'PRIVATE-SYNTHETIC-ID',
    tin_number: 'PRIVATE-SYNTHETIC-TIN',
    vip_card_number: '26100100001G1C01S',
  });
  fixture.data.source[table.source] = [row];
  fixture.data.target.customers = [];
  fixture.data.identities.source.push({ id: String(row.auth_user_id), email: String(row.email) });
  fixture.data.identities.target.push({ id: String(row.auth_user_id), email: String(row.email) });
  return fixture;
}

it('maps all customer fields and checks portal ownership without rewriting private history or returning government IDs in the native projection', () => {
  const fixture = customerFixture(),
    table = reviewedCustomerMigrationTable();
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
  const columns = schema.columns.filter(
    (column) => column.schema === 'public' && column.table === 'customers',
  );
  expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
  expect([...(table.notNull ?? [])].sort()).toEqual(
    columns
      .filter((column) => column.nullable === 'NO')
      .map((column) => column.name)
      .sort(),
  );
  for (const [type, declared] of [
    ['uuid', table.uuids],
    ['text', table.text],
    ['date', table.dates],
    ['timestamp with time zone', table.timestamps],
  ] as const)
    expect([...(declared ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === type)
        .map((column) => column.name)
        .sort(),
    );
  const fks = schema.constraints.filter(
    (constraint) =>
      constraint.schema === 'public' && constraint.table === 'customers' && constraint.kind === 'f',
  );
  expect({ ...table.references, auth_user_id: 'auth.users' }).toEqual(
    Object.fromEntries(
      fks.map((constraint) => [
        constraint.columns[0],
        `${constraint.reference_schema}.${constraint.reference_table}`,
      ]),
    ),
  );
  const before = structuredClone(fixture.data),
    plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  const customer = plan.records.customers![0]!;
  expect(customer).toMatchObject({
    created_by: fixture.ids['target-owner'],
    auth_user_id: '00000000-0000-4000-8000-000000000071',
    vip_card_number: '26100100001G1C01S',
    government_id_number: 'PRIVATE-SYNTHETIC-ID',
    address: { historicalActorId: fixture.ids['source-owner'] },
  });
  expect(JSON.stringify(toCustomer(customer))).not.toContain('PRIVATE-SYNTHETIC-ID');
  expect(fixture.data).toEqual(before);
  const row = fixture.data.source['public.customers']![0]!;
  row.auth_user_id = null;
  row.status = 'prospect';
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(true);
});

it('blocks invalid customer states, missing/mismatched portal identities and silently linking the protected owner', () => {
  for (const [column, value] of [
    ['status', 'pending'],
    ['gender', 'Male'],
    ['supplementary_gender', 'unknown'],
    ['email', 'UPPER@example.invalid'],
    ['address', []],
    ['vip_card_number', 'B-123'],
  ] as const) {
    const fixture = customerFixture();
    fixture.data.source['public.customers']![0]![column] = value;
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready, column).toBe(false);
  }
  const missing = customerFixture();
  missing.data.identities.target.pop();
  expect(planMigrationMapping(missing.manifest, missing.data).issues).toContainEqual(
    expect.objectContaining({ code: 'TARGET_IDENTITY_MISSING', table: 'public.customers' }),
  );
  const mismatch = customerFixture();
  mismatch.data.identities.target.at(-1)!.email = 'wrong@example.invalid';
  expect(planMigrationMapping(mismatch.manifest, mismatch.data).ready).toBe(false);
  const owner = customerFixture();
  owner.data.source['public.customers']![0]!.auth_user_id = owner.ids['source-owner'];
  expect(planMigrationMapping(owner.manifest, owner.data).ready).toBe(false);
});

it('preserves complete referral/accreditation metadata, original AA numbers and dated history with owner protection', () => {
  const fixture = networkFixture();
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
  for (const table of reviewedNetworkMigrationTables()) {
    const [namespace, name] = table.source.split('.');
    const columns = schema.columns.filter(
      (column) => column.schema === namespace && column.table === name,
    );
    const constraints = schema.constraints.filter(
      (constraint) => constraint.schema === namespace && constraint.table === name,
    );
    expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
    expect([...(table.notNull ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.nullable === 'NO')
        .map((column) => column.name)
        .sort(),
    );
    for (const [type, declared] of [
      ['uuid', table.uuids],
      ['text', table.text],
      ['boolean', table.booleans],
      ['date', table.dates],
      ['timestamp with time zone', table.timestamps],
    ] as const)
      expect([...(declared ?? [])].sort()).toEqual(
        columns
          .filter((column) => column.type === type)
          .map((column) => column.name)
          .sort(),
      );
    expect(table.key).toEqual(constraints.find((constraint) => constraint.kind === 'p')!.columns);
    expect(table.references ?? {}).toEqual(
      Object.fromEntries(
        constraints
          .filter((constraint) => constraint.kind === 'f')
          .map((constraint) => [
            constraint.columns[0],
            `${constraint.reference_schema}.${constraint.reference_table}`,
          ]),
      ),
    );
  }
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.sale_team_accreditations).toEqual([
    expect.objectContaining({
      aa_number: 'AAI26100001',
      staff_id: fixture.ids['staff-two'],
      approved_by: fixture.ids['target-owner'],
      starts_on: null,
    }),
  ]);
  expect(plan.records.sale_team_accreditation_history).toEqual([
    expect.objectContaining({
      aa_number: 'AAO26090002',
      public_name: 'Synthetic historical name',
      starts_on: '2026-09-01',
      expires_on: '2027-09-01',
      recorded_by: fixture.ids['target-owner'],
      successor_aa_number: 'AAI26100001',
    }),
  ]);
  expect(plan.records.referral_relationships).toEqual([
    expect.objectContaining({
      upline_staff_id: fixture.ids['target-owner'],
      hierarchy_role: 'sales_manager',
    }),
  ]);
  expect(plan.excluded).toContainEqual(
    expect.objectContaining({
      table: 'private.sale_team_accreditations',
      reason: 'PROTECTED_OWNER',
    }),
  );
});

it('rejects invalid accreditation states, dates, AA kind or transfer history and duplicate active uplines', () => {
  for (const [table, field, value] of [
    ['private.sale_team_accreditations', 'aa_number', 'AAO26100001'],
    ['private.sale_team_accreditations', 'aa_number', 'AAI26100000'],
    ['private.sale_team_accreditations', 'kind', 'OTHER'],
    ['private.sale_team_accreditations', 'status', 'accredited'],
    ['private.sale_team_accreditations', 'kind', 'OST'],
    ['private.sale_team_accreditations', 'starts_on', '2026-10-01'],
    ['private.sale_team_accreditation_history', 'expires_on', '2026-08-01'],
    ['private.sale_team_accreditation_history', 'event', 'approved'],
    ['private.sale_team_accreditation_history', 'status', 'active'],
    ['private.sale_team_accreditation_history', 'successor_aa_number', 'AAO26090002'],
    ['public.referral_relationships', 'hierarchy_role', 'super_admin'],
  ] as const) {
    const fixture = networkFixture();
    fixture.data.source[table]![0]![field] = value;
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready, `${table}:${field}`).toBe(
      false,
    );
  }
  const fixture = networkFixture();
  fixture.data.source['public.referral_relationships']!.push({
    ...fixture.data.source['public.referral_relationships']![0]!,
    id: '00000000-0000-4000-8000-000000000062',
  });
  expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
    expect.objectContaining({ code: 'UNIQUE_CONFLICT' }),
  );
  fixture.data.source['public.referral_relationships']![1]!.is_active = false;
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(true);
  fixture.data.source['public.referral_relationships']![0]!.upline_staff_id =
    fixture.ids['staff-two'];
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
});

it('reconciles the full target baseline plus planned inserts and detects changes outside migrated source rows', () => {
  const fixture = catalogFixture();
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  const after = structuredClone(fixture.data.target);
  for (const [name, rows] of Object.entries(plan.records))
    after[name]!.push(...structuredClone(rows));
  const before = structuredClone(after);
  expect(reconcileMigrationMapping(fixture.manifest, fixture.data, after)).toMatchObject({
    ready: true,
    issues: [],
  });
  expect(after).toEqual(before);
  for (const mutation of [
    (target: typeof after) => {
      target.staff_users![0]!.full_name = 'CHANGED-OWNER';
    },
    (target: typeof after) => {
      target.staff_role_assignments!.shift();
    },
    (target: typeof after) => {
      target.card_plans![0]!.cash_price = '0.01';
    },
    (target: typeof after) => {
      target.card_plans!.push({ ...target.card_plans![0]! });
    },
    (target: typeof after) => {
      target.card_plans!.push({ _id: 'unexpected-row' });
    },
    (target: typeof after) => {
      delete target.card_plans;
    },
  ]) {
    const changed = structuredClone(after);
    mutation(changed);
    const result = reconcileMigrationMapping(fixture.manifest, fixture.data, changed);
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('CHANGED-OWNER');
    expect(JSON.stringify(result)).not.toContain('FICTIONAL-PROFILE-ID');
  }
  const invalid = structuredClone(fixture.data);
  invalid.source['public.card_plans']![0]!.cash_price = '-1';
  expect(reconcileMigrationMapping(fixture.manifest, invalid, after).ready).toBe(false);
});

it('preserves points-tier caps as checked native integers and remaps the updating actor without changing existing caps', () => {
  const fixture = catalogFixture();
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.tier_points_config).toEqual([
    expect.objectContaining({
      tier: 'GOLD',
      annual_points_cap: 60000,
      updated_by: fixture.ids['target-owner'],
      updated_at: '2026-10-01T00:00:00.000Z',
    }),
  ]);
  fixture.data.target.tier_points_config = [
    { ...plan.records.tier_points_config![0]!, _id: 'existing-tier-config' },
  ];
  expect(planMigrationMapping(fixture.manifest, fixture.data).records.tier_points_config).toEqual(
    [],
  );
  fixture.data.target.tier_points_config[0]!.annual_points_cap = 40000;
  expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
    expect.objectContaining({ code: 'REFERENCE_RECORD_CONFLICT' }),
  );
  for (const [column, value] of [
    ['tier', 'PLATINUM'],
    ['annual_points_cap', '0'],
    ['annual_points_cap', '-1'],
    ['annual_points_cap', '9007199254740992'],
  ] as const) {
    const invalid = catalogFixture();
    invalid.data.source['public.tier_points_config']![0]![column] = value;
    expect(planMigrationMapping(invalid.manifest, invalid.data).ready, `${column}:${value}`).toBe(
      false,
    );
  }
});

it('proposes points-tier validation and a unique tier index without broadening approved core rules', () => {
  const proposal = proposedPointsTierGuards();
  expect(proposal.index).toEqual({ key: { tier: 1 }, unique: true });
  expect(proposal.validator.$jsonSchema.properties.tier.enum).toEqual(['BRONZE', 'SILVER', 'GOLD']);
  expect(proposal.validator.$jsonSchema.properties.annual_points_cap).toMatchObject({
    minimum: 1,
    maximum: Number.MAX_SAFE_INTEGER,
    multipleOf: 1,
  });
});

it('covers complete source catalog metadata and preserves prices, rates and terms with category aliases', () => {
  const fixture = catalogFixture();
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
  for (const table of [...reviewedCatalogMigrationTables(), reviewedPointsTierMigrationTable()]) {
    const name = table.target;
    const columns = schema.columns.filter(
      (column) => column.schema === 'public' && column.table === name,
    );
    const constraints = schema.constraints.filter(
      (constraint) => constraint.schema === 'public' && constraint.table === name,
    );
    expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
    expect([...(table.notNull ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.nullable === 'NO')
        .map((column) => column.name)
        .sort(),
    );
    for (const [type, declared] of [
      ['uuid', table.uuids],
      ['text', [...(table.text ?? []), ...(table.money ?? [])]],
      ['boolean', table.booleans],
      ['integer', table.int32],
      ['timestamp with time zone', table.timestamps],
    ] as const)
      expect([...(declared ?? [])].sort()).toEqual(
        columns
          .filter((column) => column.type === type)
          .map((column) => column.name)
          .sort(),
      );
    expect(table.key).toEqual(constraints.find((constraint) => constraint.kind === 'p')!.columns);
    for (const unique of constraints.filter((constraint) => constraint.kind === 'u'))
      expect(table.unique).toContainEqual(unique.columns);
    expect(table.references ?? {}).toEqual(
      Object.fromEntries(
        constraints
          .filter((constraint) => constraint.kind === 'f')
          .map((constraint) => [
            constraint.columns[0],
            `${constraint.reference_schema}.${constraint.reference_table}`,
          ]),
      ),
    );
  }
  const before = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.card_categories).toEqual([]);
  expect(plan.records.card_plans).toEqual([
    expect.objectContaining({
      category_id: fixture.data.target.card_categories[0]!._id,
      cash_price: '312000.00',
      commission_rate: '0.1234',
      total_loyalty_value: '500000.00',
      description: null,
      validity_years: 22,
      discount_percent: 25,
    }),
  ]);
  expect(fixture.data).toEqual(before);
  fixture.data.target.card_plans = [
    { ...plan.records.card_plans![0]!, _id: '00000000-0000-4000-8000-000000000053' },
  ];
  const reuse = planMigrationMapping(fixture.manifest, fixture.data);
  expect(reuse.ready).toBe(true);
  expect(reuse.records.card_plans).toEqual([]);
  fixture.data.target.card_plans[0]!.cash_price = '999.00';
  const conflict = planMigrationMapping(fixture.manifest, fixture.data);
  expect(conflict.records).toEqual({});
  expect(conflict.issues).toContainEqual(
    expect.objectContaining({ code: 'REFERENCE_RECORD_CONFLICT' }),
  );
});

it('blocks invalid source catalog CHECKs instead of repairing prices or benefits', () => {
  for (const [column, value] of [
    ['yearly_points', 0],
    ['annual_points_tranches', 0],
    ['base_validity_years', 0],
    ['spot_cash_days', 0],
    ['standard_installment_months', 0],
    ['validity_years', 0],
    ['validity_extension_years', -1],
    ['cardholder_limit', 0],
    ['cardholder_limit', 3],
    ['discount_percent', -1],
    ['discount_percent', 101],
    ['commission_rate', '1.0001'],
    ['commission_rate', '-0.1'],
    ['commission_rate', '0.12345'],
    ['cash_price', '01.00'],
    ['minimum_down_payment', '-1.00'],
    ['installment_price', '1.001'],
    ['reservation_fee', 100],
    ['total_loyalty_value', '1e6'],
  ] as const) {
    const fixture = catalogFixture();
    fixture.data.source['public.card_plans']![0]![column] = value;
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready, column).toBe(false);
    expect(plan.records).toEqual({});
    expect(plan.issues).toContainEqual(expect.objectContaining({ column }));
  }
  const fixture = catalogFixture();
  fixture.data.source['public.card_categories']![0]!.slug = 'UPPERCASE';
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
});

it('maps the complete network profile metadata and preserves private fields only in business output', () => {
  const fixture = networkProfileFixture();
  const table = reviewedNetworkProfileMigrationTable();
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
  const columns = schema.columns.filter(
    (column) => column.schema === 'public' && column.table === 'network_member_profiles',
  );
  expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
  expect([...(table.notNull ?? [])].sort()).toEqual(
    columns
      .filter((column) => column.nullable === 'NO')
      .map((column) => column.name)
      .sort(),
  );
  for (const [type, declared] of [
    ['uuid', table.uuids],
    ['text', table.text],
    ['date', table.dates],
    ['timestamp with time zone', table.timestamps],
  ] as const)
    expect([...(declared ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === type)
        .map((column) => column.name)
        .sort(),
    );
  const constraints = schema.constraints.filter(
    (constraint) =>
      constraint.schema === 'public' && constraint.table === 'network_member_profiles',
  );
  expect(table.key).toEqual(constraints.find((constraint) => constraint.kind === 'p')!.columns);
  expect(table.references).toEqual(
    Object.fromEntries(
      constraints
        .filter((constraint) => constraint.kind === 'f')
        .map((constraint) => [
          constraint.columns[0],
          `${constraint.reference_schema}.${constraint.reference_table}`,
        ]),
    ),
  );
  const before = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.network_member_profiles).toEqual([
    expect.objectContaining({
      staff_id: fixture.ids['staff-two'],
      referrer_staff_id: fixture.ids['target-owner'],
      government_id_number: 'FICTIONAL-PROFILE-ID',
      date_of_birth: '1990-02-01',
      zip_code: '',
      ost_referrer_staff_id: null,
    }),
  ]);
  expect(
    JSON.stringify({
      issues: plan.issues,
      mapping: plan.mapping,
      checksums: plan.checksums,
      excluded: plan.excluded,
    }),
  ).not.toContain('FICTIONAL-PROFILE-ID');
  expect(fixture.data).toEqual(before);
  expect(plan.excluded).toContainEqual(
    expect.objectContaining({ table: table.source, reason: 'PROTECTED_OWNER' }),
  );
});

it('blocks invalid network profile source CHECKs, dates and staff references without leaking ID data', () => {
  for (const [column, value, code] of [
    ['sex', 'Other', 'INVALID_NETWORK_PROFILE_VALUE'],
    ['civil_status', 'single', 'INVALID_NETWORK_PROFILE_VALUE'],
    ['province_code', '123', 'INVALID_NETWORK_PROFILE_VALUE'],
    ['city_municipality_code', '123456789x', 'INVALID_NETWORK_PROFILE_VALUE'],
    ['date_of_birth', '1990-02-30', 'INVALID_DATE'],
    ['referrer_staff_id', '00000000-0000-4000-8000-000000000099', 'DANGLING_REFERENCE'],
    ['staff_id', '00000000-0000-4000-8000-000000000099', 'DANGLING_REFERENCE'],
  ] as const) {
    const fixture = networkProfileFixture();
    fixture.data.source['public.network_member_profiles']![1]![column] = value;
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.records).toEqual({});
    expect(plan.issues).toContainEqual(expect.objectContaining({ code }));
    expect(JSON.stringify(plan.issues)).not.toContain('FICTIONAL-PROFILE-ID');
  }
});

it('covers all staff source fields and declares the auth foreign key separately from business references', () => {
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
  const table = reviewedStaffMigrationTable();
  const columns = schema.columns.filter(
    (column) => column.schema === 'public' && column.table === 'staff_users',
  );
  expect([...table.columns].sort()).toEqual(columns.map((column) => column.name).sort());
  expect([...(table.notNull ?? [])].sort()).toEqual(
    columns
      .filter((column) => column.nullable === 'NO')
      .map((column) => column.name)
      .sort(),
  );
  for (const [type, declared] of [
    ['uuid', table.uuids],
    ['text', table.text],
    ['boolean', table.booleans],
    ['timestamp with time zone', table.timestamps],
  ] as const)
    expect([...(declared ?? [])].sort()).toEqual(
      columns
        .filter((column) => column.type === type)
        .map((column) => column.name)
        .sort(),
    );
  expect(table.authIdentity).toBe(true);
  expect(table.references).toEqual({ department_id: 'public.departments' });
  const foreign = schema.constraints.filter(
    (constraint) =>
      constraint.schema === 'public' &&
      constraint.table === 'staff_users' &&
      constraint.kind === 'f',
  );
  expect(
    foreign.map((constraint) => [
      constraint.columns,
      constraint.reference_schema,
      constraint.reference_table,
    ]),
  ).toEqual(
    expect.arrayContaining([
      [['id'], 'auth', 'users'],
      [['department_id'], 'public', 'departments'],
    ]),
  );
  for (const unique of schema.constraints.filter(
    (constraint) =>
      constraint.schema === 'public' &&
      constraint.table === 'staff_users' &&
      constraint.kind === 'u',
  ))
    expect(table.unique).toContainEqual(unique.columns);
});

it('gates staff planning on explicit provider identity evidence without changing source password flags or the owner', () => {
  const fixture = staffFixture(),
    before = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.staff_users).toEqual([
    expect.objectContaining({
      _id: fixture.ids['staff-two'],
      full_name: 'Synthetic Migrating Staff',
      must_change_password: true,
      employee_number: 'SYNTHETIC-STAFF-EMP',
      department_id: fixture.data.target.departments![0]!._id,
    }),
  ]);
  expect(Object.keys(plan.records).some((name) => name.startsWith('auth_'))).toBe(false);
  expect(fixture.data).toEqual(before);
  const changedEvidence = structuredClone(fixture.data);
  changedEvidence.identities.target.push({ id: 'unrelated-id', email: 'other@example.invalid' });
  const rebound = planMigrationMapping(fixture.manifest, changedEvidence);
  expect(rebound.ready).toBe(true);
  expect(rebound.digest).not.toBe(plan.digest);
  const missing = { source: fixture.data.source, target: fixture.data.target };
  expect(planMigrationMapping(fixture.manifest, missing).issues).toContainEqual(
    expect.objectContaining({ code: 'IDENTITY_SNAPSHOTS_REQUIRED' }),
  );
  fixture.data.identities.target.pop();
  const blocked = planMigrationMapping(fixture.manifest, fixture.data);
  expect(blocked.records).toEqual({});
  expect(blocked.issues).toContainEqual(
    expect.objectContaining({ code: 'TARGET_IDENTITY_MISSING' }),
  );
});

it('enforces source staff email/status CHECKs and refuses an omitted auth reference gate', () => {
  for (const [column, value, code] of [
    ['email', 'STAFF@example.invalid', 'INVALID_STAFF_EMAIL'],
    ['email', ' staff@example.invalid ', 'INVALID_STAFF_EMAIL'],
    ['status', 'deleted', 'INVALID_STAFF_STATUS'],
  ]) {
    const fixture = staffFixture();
    fixture.data.source['public.staff_users']![1]![column!] = value;
    expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
      expect.objectContaining({ code }),
    );
  }
  const fixture = staffFixture();
  delete fixture.manifest.tables.find((table) => table.target === 'staff_users')!.authIdentity;
  expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
    expect.objectContaining({ code: 'AUTH_IDENTITY_REFERENCE_REQUIRED' }),
  );
});

it('reuses full organization references after department aliases resolve and blocks flag or history conflicts', () => {
  const fixture = organizationFixture(),
    saved = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  for (const name of ['departments', 'roles', 'modules']) expect(plan.records[name]).toEqual([]);
  expect(fixture.data).toEqual(saved);
  for (const [table, column, value] of [
    ['public.roles', 'is_system', true],
    ['public.roles', 'is_active', false],
    ['public.roles', 'created_at', '2026-09-01T00:00:00Z'],
    ['public.modules', 'sort_order', 20],
    ['public.departments', 'name', 'Different department'],
  ] as const) {
    const changed = organizationFixture();
    changed.data.source[table]![0]![column] = value;
    const blocked = planMigrationMapping(changed.manifest, changed.data);
    expect(blocked.records).toEqual({});
    expect(blocked.issues).toContainEqual(
      expect.objectContaining({ code: 'REFERENCE_RECORD_CONFLICT' }),
    );
  }
});

it('validates organization text and PostgreSQL int32 values without coercion', () => {
  for (const value of ['10', 1.5, 2147483648, -2147483649, true, {}]) {
    const fixture = organizationFixture();
    fixture.data.source['public.modules']![0]!.sort_order = value;
    expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_INT32', column: 'sort_order' }),
    );
  }
  for (const value of [-2147483648, 0, 2147483647]) {
    const fixture = organizationFixture();
    fixture.data.source['public.modules']![0]!.sort_order = value;
    fixture.data.target.modules![0]!.sort_order = value;
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(true);
  }
  for (const value of [42, false, {}, []]) {
    const fixture = organizationFixture();
    fixture.data.source['public.roles']![0]!.name = value;
    expect(planMigrationMapping(fixture.manifest, fixture.data).issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_TEXT', column: 'name' }),
    );
  }
});

it('blocks undeclared/overlapping reference scalars and native name collisions', () => {
  for (const mutate of [
    (table: MigrationManifest['tables'][number]) => {
      table.text = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.int32 = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.int32 = ['name'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.text!.push('department_id');
    },
    (table: MigrationManifest['tables'][number]) => {
      table.int32 = ['department_id'];
    },
  ]) {
    const fixture = organizationFixture();
    mutate(fixture.manifest.tables.find((table) => table.target === 'roles')!);
    expect(
      planMigrationMapping(fixture.manifest, fixture.data).issues.some((issue) =>
        ['UNDECLARED_MANIFEST_COLUMN', 'INVALID_SCALAR_MAPPING'].includes(issue.code),
      ),
    ).toBe(true);
  }
  for (const [table, code, value] of [
    ['roles', 'slug', 'another_role'],
    ['departments', 'code', 'OTHER'],
  ] as const) {
    const fixture = organizationFixture();
    fixture.data.source[`public.${table}`]![0]![code] = value;
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.records).toEqual({});
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ table: `public.${table}`, code: 'UNIQUE_CONFLICT' }),
    );
  }
});

it('enforces the recorded role/module/department code CHECKs at their length boundaries', () => {
  for (const [source, target, column, valid, invalid] of [
    [
      'public.roles',
      'roles',
      'slug',
      ['ab', 'a'.repeat(64)],
      ['a', 'A_role', 'bad-role', 'a'.repeat(65)],
    ],
    [
      'public.modules',
      'modules',
      'key',
      ['abc', 'a'.repeat(80)],
      ['ab', 'Sales.customers', 'bad-key', 'a'.repeat(81)],
    ],
    [
      'public.departments',
      'departments',
      'code',
      ['AA', 'A'.repeat(32)],
      ['A', 'sales', '1A', 'A'.repeat(33)],
    ],
  ] as const) {
    for (const value of [...valid, ...invalid]) {
      const fixture = organizationFixture();
      fixture.data.source[source]![0]![column] = value;
      fixture.data.target[target]![0]![column] = value;
      const plan = planMigrationMapping(fixture.manifest, fixture.data);
      expect(plan.ready).toBe((valid as readonly string[]).includes(value));
      if (!plan.ready)
        expect(plan.issues).toContainEqual(
          expect.objectContaining({ code: 'INVALID_REFERENCE_CODE', column }),
        );
    }
  }
});

it('preserves canonical UUIDs through access/reference reuse and leaves historical JSON unchanged', () => {
  const fixture = uuidFixture(),
    saved = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.role_permissions).toEqual([]);
  expect(plan.records.staff_permission_restrictions).toEqual([]);
  expect(plan.records.staff_role_assignments).toEqual([]);
  expect(plan.records.card_sales![0]!.created_by).toBe(fixture.ids['target-owner']);
  expect(plan.records.card_sales![0]!.snapshot).toEqual(
    saved.source['public.card_sales']![0]!.snapshot,
  );
  expect(fixture.data).toEqual(saved);
  fixture.data.target.staff_role_assignments!.pop();
  fixture.data.source['public.staff_role_assignments']![1]!.assigned_by = null;
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(true);
});

it('rejects malformed source UUIDs and malformed remapped target UUIDs', () => {
  for (const value of [
    'not-a-uuid',
    '00000000000040008000000000000004',
    '00000000-0000-4000-8000-00000000000g',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    ' 00000000-0000-4000-8000-000000000004',
    42,
    {},
  ]) {
    const fixture = uuidFixture();
    fixture.data.source['public.role_permissions']![0]!.role_id = value;
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.records).toEqual({});
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_UUID', column: 'role_id' }),
    );
  }
  const target = uuidFixture();
  target.data.target.roles![0]!._id = 'malformed-target-role';
  const plan = planMigrationMapping(target.manifest, target.data);
  expect(plan.records).toEqual({});
  expect(plan.issues).toContainEqual(expect.objectContaining({ code: 'INVALID_TARGET_UUID' }));
  const owner = uuidFixture();
  owner.manifest.protectedOwner.targetId = 'malformed-owner-id';
  owner.data.target.staff_users![0]!._id = 'malformed-owner-id';
  expect(planMigrationMapping(owner.manifest, owner.data).issues).toContainEqual(
    expect.objectContaining({ table: 'public.staff_users', code: 'INVALID_TARGET_UUID' }),
  );
});

it('refuses undeclared UUID columns and overlapping scalar UUID declarations', () => {
  for (const mutate of [
    (table: MigrationManifest['tables'][number]) => {
      table.uuids = ['unreviewed'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.booleans = ['role_id'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.bigints = { role_id: 'identifier' };
    },
    (table: MigrationManifest['tables'][number]) => {
      table.dates = ['role_id'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.timestamps = ['role_id'];
    },
    (table: MigrationManifest['tables'][number]) => {
      table.money = ['role_id'];
    },
  ]) {
    const fixture = uuidFixture();
    mutate(fixture.manifest.tables.find((table) => table.target === 'role_permissions')!);
    expect(
      planMigrationMapping(fixture.manifest, fixture.data).issues.some((issue) =>
        ['UNDECLARED_MANIFEST_COLUMN', 'INVALID_UUID_MAPPING'].includes(issue.code),
      ),
    ).toBe(true);
  }
});

it('enforces the source view prerequisite across all grant combinations without repairing or changing input', () => {
  for (let mask = 0; mask < 16; mask++) {
    const fixture = permissionFixture();
    fixture.data.target.role_permissions.length = 0;
    const row = fixture.data.source['public.role_permissions'][0]!;
    Object.assign(row, {
      can_view: Boolean(mask & 1),
      can_create: Boolean(mask & 2),
      can_update: Boolean(mask & 4),
      can_delete: Boolean(mask & 8),
    });
    const saved = structuredClone(fixture.data);
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    const allowed = row.can_view || !(row.can_create || row.can_update || row.can_delete);
    expect(plan.ready).toBe(allowed);
    if (!allowed) {
      expect(plan.records).toEqual({});
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          table: 'public.role_permissions',
          code: 'PERMISSION_VIEW_REQUIRED',
        }),
      );
    }
    expect(fixture.data).toEqual(saved);
  }
});

it('requires at least one deny flag and never weakens owner restrictions', () => {
  for (let mask = 0; mask < 16; mask++) {
    const fixture = restrictionFixture();
    fixture.data.target.staff_permission_restrictions.pop();
    const row = fixture.data.source['public.staff_permission_restrictions'][1]!;
    Object.assign(row, {
      deny_view: Boolean(mask & 1),
      deny_create: Boolean(mask & 2),
      deny_update: Boolean(mask & 4),
      deny_delete: Boolean(mask & 8),
    });
    const saved = structuredClone(fixture.data);
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready).toBe(mask !== 0);
    if (mask === 0) {
      expect(plan.records).toEqual({});
      expect(plan.issues).toContainEqual(
        expect.objectContaining({
          table: 'public.staff_permission_restrictions',
          code: 'EMPTY_PERMISSION_RESTRICTION',
        }),
      );
    }
    expect(fixture.data).toEqual(saved);
  }
});

it('refuses permission manifests that omit or rename canonical access flags', () => {
  for (const make of [permissionFixture, restrictionFixture]) {
    for (const mutate of [
      (table: MigrationManifest['tables'][number]) => {
        delete table.booleans;
      },
      (table: MigrationManifest['tables'][number]) => {
        table.booleans = table.booleans!.slice(1);
      },
      (table: MigrationManifest['tables'][number]) => {
        table.notNull = [];
      },
      (table: MigrationManifest['tables'][number]) => {
        table.renames = { [table.booleans![0]!]: 'unreadable_flag' };
      },
    ]) {
      const fixture = make();
      mutate(fixture.manifest.tables.at(-1)!);
      const plan = planMigrationMapping(fixture.manifest, fixture.data);
      expect(plan.issues).toContainEqual(
        expect.objectContaining({ code: 'ACCESS_CONSTRAINT_DECLARATION_REQUIRED' }),
      );
      expect(plan.records).toEqual({});
    }
  }
});

it('reuses identical deny-only restrictions and preserves owner restrictions without weakening a target deny flag', () => {
  const fixture = restrictionFixture(),
    { data, staffDeny } = fixture;
  const saved = structuredClone(data);
  const plan = planMigrationMapping(fixture.manifest, data);
  expect(plan.ready).toBe(true);
  expect(plan.records.staff_permission_restrictions).toEqual([]);
  expect(plan.excluded).toContainEqual(
    expect.objectContaining({
      table: 'public.staff_permission_restrictions',
      reason: 'PROTECTED_OWNER',
    }),
  );
  expect(data).toEqual(saved);
  for (const flag of ['deny_view', 'deny_create', 'deny_update', 'deny_delete'] as const) {
    const changed = structuredClone(data);
    changed.source['public.staff_permission_restrictions'][1]![flag] = !staffDeny[flag];
    const blocked = planMigrationMapping(fixture.manifest, changed);
    expect(blocked.records).toEqual({});
    expect(blocked.issues).toContainEqual(
      expect.objectContaining({
        table: 'public.staff_permission_restrictions',
        code: 'REFERENCE_RECORD_CONFLICT',
      }),
    );
  }
});

it('loads composite grants/restrictions under native unique indexes without changing existing access or the owner', async () => {
  const replica = await createTestReplica();
  try {
    const fixture = customerFixture(),
      newModuleId = '00000000-0000-4000-8000-000000000009';
    fixture.data.target.staff_role_assignments!.pop();
    fixture.data.source['public.modules']!.push({
      id: newModuleId,
      key: 'sales.card_sales',
      name: 'Card sales',
      group_name: 'Sales',
      sort_order: 20,
      is_active: true,
    });
    fixture.data.source['public.role_permissions']!.push({
      ...fixture.data.source['public.role_permissions']![0]!,
      module_id: newModuleId,
    });
    for (const [name, rows] of Object.entries(fixture.data.target))
      if (rows.length)
        await replica.db.collection<MigrationRecord>(name).insertMany(structuredClone(rows));
    await replica.db
      .collection<MigrationRecord>('auth_users')
      .insertMany(
        fixture.data.identities.target.map((header) => ({
          _id: header.id,
          email: header.email,
          name: 'Synthetic identity header',
          emailVerified: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      );
    await setupMongoOrganization(replica.db);
    await setupMongoCustomers(replica.db);
    await setupCustomerActivation(replica.db);
    await setupMongoMembers(replica.db);
    await setupMongoSaleTeam(replica.db);
    await setupMongoReferrals(replica.db);
    await setupMongoCatalog(replica.db);
    const tierGuards = proposedPointsTierGuards();
    await replica.db.createCollection('tier_points_config', {
      validator: tierGuards.validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await replica.db
      .collection('tier_points_config')
      .createIndex(tierGuards.index.key, { unique: tierGuards.index.unique });
    await replica.db.collection('modules').createIndex({ key: 1 }, { unique: true });
    const restrictions = replica.db.collection<MigrationRecord>('staff_permission_restrictions');
    for (const table of [
      ...reviewedAccessMigrationTables(),
      ...reviewedOrganizationReferenceTables(),
      reviewedStaffMigrationTable(),
      reviewedNetworkProfileMigrationTable(),
      ...reviewedCatalogMigrationTables(),
      reviewedPointsTierMigrationTable(),
      ...reviewedNetworkMigrationTables(),
      reviewedCustomerMigrationTable(),
    ]) {
      const indexes = await replica.db.collection(table.target).listIndexes().toArray();
      for (const key of table.unique ?? [])
        expect(indexes).toContainEqual(
          expect.objectContaining({
            key: Object.fromEntries(key.map((column) => [column, 1])),
            unique: true,
          }),
        );
      for (const rule of table.partialUnique ?? [])
        expect(indexes).toContainEqual(
          expect.objectContaining({
            key: Object.fromEntries(rule.columns.map((column) => [column, 1])),
            unique: true,
            partialFilterExpression: rule.when,
          }),
        );
    }
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.ready).toBe(true);
    expect(plan.records.card_plans).toHaveLength(1);
    for (const name of ['roles', 'departments']) expect(plan.records[name]).toEqual([]);
    for (const [name, rows] of Object.entries(plan.records))
      if (rows.length) await replica.db.collection<MigrationRecord>(name).insertMany(rows);
    const grants = replica.db.collection<MigrationRecord>('role_permissions');
    expect(
      await replica.db
        .collection('customers')
        .findOne({ auth_user_id: '00000000-0000-4000-8000-000000000071' }),
    ).toEqual(plan.records.customers![0]);
    const edges = replica.db.collection<MigrationRecord>('referral_relationships');
    const edge = plan.records.referral_relationships![0]!;
    expect(await edges.findOne({ _id: edge._id })).toEqual(edge);
    await expect(edges.insertOne({ ...edge, _id: 'duplicate-active-edge' })).rejects.toMatchObject({
      code: 11000,
    });
    await edges.insertOne({ ...edge, _id: 'allowed-inactive-edge', is_active: false });
    await edges.deleteOne({ _id: 'allowed-inactive-edge' });
    expect(
      await replica.db
        .collection('sale_team_accreditations')
        .findOne({ staff_id: fixture.ids['target-owner'] }),
    ).toEqual(fixture.data.target.sale_team_accreditations![0]);
    expect(
      await replica.db
        .collection('sale_team_accreditation_history')
        .findOne({ aa_number: 'AAO26090002' }),
    ).toEqual(plan.records.sale_team_accreditation_history![0]);
    const tiers = replica.db.collection<MigrationRecord>('tier_points_config');
    const tier = plan.records.tier_points_config![0]!;
    expect(await tiers.findOne({ tier: 'GOLD' })).toEqual(tier);
    for (const cap of [
      0,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ])
      await expect(
        tiers.insertOne({ ...tier, _id: 'invalid-cap', annual_points_cap: cap }),
      ).rejects.toMatchObject({ code: 121 });
    await expect(tiers.insertOne({ ...tier, _id: 'duplicate-tier' })).rejects.toMatchObject({
      code: 11000,
    });
    expect(await replica.db.collection('card_plans').findOne({ code: 'SYNTHETIC-GOLD' })).toEqual(
      plan.records.card_plans![0],
    );
    expect(await grants.findOne({ _id: 'existing-grant' })).toEqual(
      fixture.data.target.role_permissions![0],
    );
    expect(await restrictions.findOne({ _id: 'owner-deny' })).toEqual(
      fixture.data.target.staff_permission_restrictions![0],
    );
    expect(await restrictions.findOne({ _id: 'existing-deny' })).toEqual(
      fixture.data.target.staff_permission_restrictions![1],
    );
    expect(
      await restrictions.countDocuments({
        staff_id: fixture.ids['staff-two'],
        module_id: fixture.ids['target-module'],
      }),
    ).toBe(1);
    expect(
      await grants.countDocuments({
        role_id: fixture.ids['target-role'],
        module_id: fixture.ids['target-module'],
      }),
    ).toBe(1);
    expect(await grants.findOne({ module_id: newModuleId })).toMatchObject({
      _id: expect.stringMatching(/^migration-/),
      role_id: fixture.ids['target-role'],
      can_view: true,
      can_create: false,
      can_update: false,
      can_delete: false,
    });
    expect(
      await replica.db
        .collection<MigrationRecord>('staff_users')
        .findOne({ _id: fixture.ids['target-owner'] }),
    ).toEqual(fixture.data.target.staff_users![0]);
    expect(
      await replica.db
        .collection('network_member_profiles')
        .findOne({ staff_id: fixture.ids['target-owner'] }),
    ).toEqual(fixture.data.target.network_member_profiles![0]);
    expect(
      await replica.db
        .collection('network_member_profiles')
        .findOne({ staff_id: fixture.ids['staff-two'] }),
    ).toEqual(plan.records.network_member_profiles![0]);
    expect(
      await replica.db
        .collection<MigrationRecord>('staff_users')
        .findOne({ _id: fixture.ids['staff-two'] }),
    ).toEqual(plan.records.staff_users![0]);
    expect(
      await replica.db
        .collection<MigrationRecord>('staff_role_assignments')
        .findOne({ _id: 'current-owner-assignment' }),
    ).toEqual(fixture.data.target.staff_role_assignments![0]);
    expect(
      await replica.db
        .collection<MigrationRecord>('staff_role_assignments')
        .findOne({ staff_id: fixture.ids['staff-two'] }),
    ).toEqual({
      _id: expect.stringMatching(/^migration-/),
      staff_id: fixture.ids['staff-two'],
      role_id: fixture.ids['target-role'],
      assigned_by: fixture.ids['target-owner'],
      created_at: '2026-10-30T00:15:30.123Z',
    });
    const target = Object.fromEntries(
      await Promise.all(
        Object.keys(fixture.data.target).map(async (name) => [
          name,
          await replica.db.collection<MigrationRecord>(name).find().toArray(),
        ]),
      ),
    );
    expect(reconcileMigrationMapping(fixture.manifest, fixture.data, target)).toMatchObject({
      ready: true,
      issues: [],
    });
    const replay = planMigrationMapping(fixture.manifest, {
      source: fixture.data.source,
      identities: fixture.data.identities,
      target,
    });
    expect(replay.ready).toBe(true);
    expect(Object.values(replay.records).flat()).toEqual([]);
  } finally {
    await replica.stop();
  }
}, 30000);

it('preserves bigint identifiers and references exactly, converts only declared safe quantities and supports replay', () => {
  const fixture = integerFixture(),
    saved = structuredClone(fixture.data);
  const plan = planMigrationMapping(fixture.manifest, fixture.data);
  expect(plan.ready).toBe(true);
  expect(plan.records.points_ledger).toEqual([
    {
      _id: '9007199254740993',
      origin_award_id: null,
      amount: 2000,
      balance_after: 2000,
      metadata: saved.source['public.points_ledger'][0]!.metadata,
    },
    {
      _id: '9223372036854775807',
      origin_award_id: '9007199254740993',
      amount: -600,
      balance_after: 1400,
      metadata: saved.source['public.points_ledger'][1]!.metadata,
    },
  ]);
  expect(fixture.data).toEqual(saved);
  const unadapted = structuredClone(fixture.manifest);
  delete unadapted.tables.at(-1)!.bigints;
  const rawPlan = planMigrationMapping(unadapted, fixture.data);
  expect(plan.checksums).toEqual(rawPlan.checksums);
  expect(plan.digest).not.toBe(rawPlan.digest);
  fixture.data.target.points_ledger.push(...plan.records.points_ledger!);
  expect(planMigrationMapping(fixture.manifest, fixture.data).records.points_ledger).toEqual([]);
});

it('blocks noncanonical or out-of-range PostgreSQL bigint values without rounding', () => {
  for (const value of [
    '9007199254740992',
    '-9007199254740992',
    '9223372036854775808',
    '01',
    '-0',
    '+1',
    ' 1',
    '1.0',
    '1e3',
    '',
    2000,
  ]) {
    const fixture = integerFixture();
    Object.assign(fixture.data.source['public.points_ledger'][0]!, { amount: value });
    const plan = planMigrationMapping(fixture.manifest, fixture.data);
    expect(plan.issues).toContainEqual(
      expect.objectContaining({ code: 'INVALID_BIGINT', column: 'amount' }),
    );
    expect(plan.records).toEqual({});
  }
  for (const value of ['9223372036854775808', '-9223372036854775809', '1.5', 42]) {
    const fixture = integerFixture();
    Object.assign(fixture.data.source['public.points_ledger'][1]!, { origin_award_id: value });
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
  }
  const fixture = integerFixture();
  fixture.data.source['public.points_ledger'][0]!.amount = '9007199254740991';
  fixture.data.source['public.points_ledger'][1]!.amount = '-9007199254740991';
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(true);
});

it('requires reviewed bigint columns and refuses numeric key/reference conversion', () => {
  for (const column of ['unreviewed', 'id', 'origin_award_id']) {
    const fixture = integerFixture();
    fixture.manifest.tables.at(-1)!.bigints![column] = 'safe_integer';
    expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
  }
  const fixture = integerFixture();
  Object.assign(fixture.manifest.tables.at(-1)!.bigints!, { amount: 'float' });
  expect(planMigrationMapping(fixture.manifest, fixture.data).ready).toBe(false);
});

it('requires owner protection for network profiles and excludes the source owner profile', () => {
  const reviewed = structuredClone(manifest),
    data = input();
  const profiles = {
    source: 'public.network_member_profiles',
    target: 'network_member_profiles',
    key: ['staff_id'],
    columns: ['staff_id', 'mobile_no'],
    references: { staff_id: 'public.staff_users' },
    unique: [['staff_id']],
  };
  reviewed.tables.push(profiles);
  const rows = {
    source: {
      ...data.source,
      'public.network_member_profiles': [
        { staff_id: 'source-owner', mobile_no: 'SYNTHETIC-OLD' },
        { staff_id: 'staff-two', mobile_no: 'SYNTHETIC-STAFF' },
      ],
    },
    target: {
      ...data.target,
      network_member_profiles: [
        { _id: 'existing-owner-profile', staff_id: 'target-owner', mobile_no: 'SYNTHETIC-CURRENT' },
      ],
    },
  };
  expect(planMigrationMapping(reviewed, rows).issues).toContainEqual(
    expect.objectContaining({
      code: 'OWNER_PROTECTION_RULE_REQUIRED',
      table: profiles.source,
    }),
  );
  reviewed.tables.at(-1)!.ownerField = 'staff_id';
  const plan = planMigrationMapping(reviewed, rows);
  expect(plan.ready).toBe(true);
  expect(plan.records.network_member_profiles).toEqual([
    expect.objectContaining({ staff_id: 'staff-two', mobile_no: 'SYNTHETIC-STAFF' }),
  ]);
  expect(plan.excluded).toContainEqual(
    expect.objectContaining({ table: profiles.source, reason: 'PROTECTED_OWNER' }),
  );
});

it('loads the prepared business mapping only into a new disposable database while leaving the synthetic target owner intact', async () => {
  const replica = await createTestReplica();
  try {
    const fixture = integerFixture(),
      calendar = calendarFixture();
    fixture.manifest.tables.push(calendar.manifest.tables.at(-1)!);
    const data = {
      source: {
        ...fixture.data.source,
        'public.customers': calendar.data.source['public.customers'],
      },
      target: { ...fixture.data.target, customers: [] as MigrationRecord[] },
    };
    await replica.db
      .collection<MigrationRecord>('staff_users')
      .insertMany(structuredClone(data.target.staff_users));
    await replica.db
      .collection<MigrationRecord>('roles')
      .insertMany(structuredClone(data.target.roles));
    await replica.db
      .collection<MigrationRecord>('staff_role_assignments')
      .insertMany(structuredClone(data.target.staff_role_assignments));
    const plan = planMigrationMapping(fixture.manifest, data);
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
    expect(
      await replica.db.collection<MigrationRecord>('points_ledger').findOne({
        _id: '9223372036854775807',
      }),
    ).toMatchObject({
      origin_award_id: '9007199254740993',
      amount: -600,
      balance_after: 1400,
      metadata: { original_amount: '-600', original_id: '9223372036854775807' },
    });
    expect(
      await replica.db.collection('points_ledger').countDocuments({
        _id: { $type: 'string' },
        amount: { $type: 'number' },
      }),
    ).toBe(2);
    expect(
      await replica.db
        .collection<MigrationRecord>('customers')
        .findOne({ _id: 'synthetic-calendar-customer' }),
    ).toEqual({
      _id: 'synthetic-calendar-customer',
      birth_date: '1994-02-01',
      supplementary_birthday: null,
    });
  } finally {
    await replica.stop();
  }
}, 30000);
