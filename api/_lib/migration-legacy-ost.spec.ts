import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import {
  reviewedLegacyOstMigrationTables,
  reconcileSourceLegacyOst,
} from './migration-legacy-ost.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoOstAccreditation } from './ost-accreditation.mongo.js';
import { createMongoOstHandler } from './ost.mongo.js';
import { makeReq, makeRes } from './testing/supabase-fake.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2024-01-01T00:00:00.123456Z';
function fixture() {
  const definitions = reviewedLegacyOstMigrationTables();
  const source: Record<string, Record<string, unknown>[]> = {
    'public.staff_users': [
      { id: id(1), email: 'owner@example.invalid', status: 'active' },
      { id: id(3), email: 'ost@example.invalid', status: 'active' },
    ],
  };
  for (const table of definitions) {
    if (table.requireEmpty) {
      source[table.source] = [];
      continue;
    }
    const row: Record<string, unknown> = Object.fromEntries(
      table.columns.map((column) => [column, null]),
    );
    for (const column of table.notNull ?? [])
      row[column] = table.uuids?.includes(column)
        ? id(1)
        : table.timestamps?.includes(column)
          ? at
          : table.dates?.includes(column)
            ? '2024-01-01'
            : table.int32?.includes(column)
              ? 1
              : table.booleans?.includes(column)
                ? true
                : 'Synthetic';
    source[table.source] = [row];
  }
  Object.assign(source['public.referral_codes']![0]!, {
    id: id(4),
    code_hash: 'a'.repeat(64),
    code_hint: 'LEGACY',
    max_uses: 10,
    use_count: 2,
  });
  Object.assign(source['public.ost_applications']![0]!, {
    id: id(5),
    referral_code_id: id(4),
    email: 'ost@example.invalid',
    first_name: 'Synthetic',
    last_name: 'OST',
    phone: '09171234567',
    birth_date: '1990-01-01',
    status: 'approved',
    address: { line1: 'Original address' },
    registration_details: { original: true },
    reviewed_by: id(1),
    reviewed_at: at,
  });
  Object.assign(source['public.ost_members']![0]!, {
    id: id(3),
    application_id: id(5),
    ost_number: 'OST-SYNTHETIC',
    full_name: 'Synthetic OST',
    email: 'ost@example.invalid',
    phone: '09171234567',
    status: 'active',
  });
  Object.assign(source['private.ost_registration_details']![0]!, {
    application_id: id(5),
    request_id: id(6),
    payload_hash: 'b'.repeat(64),
    program_category: 'non_vip',
    source: 'public',
    official_details: { original: 'value' },
    referrer_snapshot: { fullName: 'Original sponsor' },
    applicant_signature_status: 'received',
    referrer_signature_status: 'received',
  });
  Object.assign(source['private.ost_accreditation_terms']![0]!, {
    id: id(7),
    ost_id: id(3),
    application_id: id(5),
    starts_on: '2024-01-01',
    expires_on: '2025-01-01',
    status: 'active',
  });
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
        uuids: ['id'],
        ownerField: 'id',
        authIdentity: true,
      },
      ...definitions,
    ],
  };
  const target: Record<string, MigrationRecord[]> = Object.fromEntries(
    manifest.tables.map((table) => [table.target, []]),
  );
  target.staff_users = [{ _id: id(2), email: 'owner@example.invalid', protected: true }];
  const identities = {
    source: [
      { id: id(1), email: 'owner@example.invalid' },
      { id: id(3), email: 'ost@example.invalid' },
    ],
    target: [
      { id: id(2), email: 'owner@example.invalid' },
      { id: id(3), email: 'ost@example.invalid' },
    ],
  };
  return { manifest, data: { source, target, identities } };
}

it('covers source metadata and every declared FK including the shared staff/auth member ID', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  );
  for (const table of reviewedLegacyOstMigrationTables()) {
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
      expect(declared ?? []).toEqual(
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
    for (const fk of constraints.filter(
      (constraint: { kind: string }) => constraint.kind === 'f',
    )) {
      expect(fk.columns).toHaveLength(1);
      if (fk.reference_schema === 'auth') {
        expect(table.source).toBe('public.ost_members');
        expect(fk.columns).toEqual(['id']);
      } else
        expect(table.references?.[fk.columns[0]]).toBe(
          `${fk.reference_schema}.${fk.reference_table}`,
        );
    }
    for (const unique of constraints.filter(
      (constraint: { kind: string }) => constraint.kind === 'u',
    ))
      expect(table.unique).toContainEqual(unique.columns);
  }
});

it('preserves old accreditation and snapshots, isolates referral capabilities and blocks conflicting identities', () => {
  const { manifest, data } = fixture(),
    saved = structuredClone(data);
  const plan = planMigrationMapping(manifest, data);
  expect(plan.issues).toEqual([]);
  expect(reconcileSourceLegacyOst(data.source, data.identities.source).issues).toEqual([]);
  expect(plan.records.ost_accreditation_terms![0]!.expires_on).toBe('2025-01-01');
  expect(plan.records.ost_registration_details![0]!.referrer_snapshot).toEqual({
    fullName: 'Original sponsor',
  });
  expect(plan.records.legacy_referral_codes).toHaveLength(1);
  expect(plan.records.referral_codes).toBeUndefined();
  expect(data).toEqual(saved);
  for (const change of [
    'member_email',
    'target_email',
    'missing_identity',
    'nonempty_renewal',
    'term_owner',
    'uses',
  ] as const) {
    const test = fixture();
    if (change === 'member_email')
      test.data.source['public.ost_members']![0]!.email = 'other@example.invalid';
    if (change === 'target_email') test.data.identities.target[1]!.email = 'other@example.invalid';
    if (change === 'missing_identity') test.data.identities.target.pop();
    if (change === 'nonempty_renewal')
      test.data.source['private.ost_accreditation_renewals'] = [{ id: id(99) }];
    if (change === 'term_owner')
      test.data.source['private.ost_accreditation_terms']![0]!.ost_id = id(99);
    if (change === 'uses') test.data.source['public.referral_codes']![0]!.use_count = 1001;
    expect(planMigrationMapping(test.manifest, test.data).ready).toBe(false);
  }
});

it('loads native indexes, reconciles replay, reads legacy hints under authorization and keeps registration disabled', async () => {
  const replica = await createTestReplica();
  try {
    await setupMongoOstAccreditation(replica.db);
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
    expect(planMigrationMapping(manifest, { ...data, target: after }).records.ost_members).toEqual(
      [],
    );
    expect(after.staff_users!.find((row) => row._id === id(2))).toEqual(
      data.target.staff_users![0],
    );
    expect(await replica.db.collection('referral_codes').countDocuments()).toBe(0);
    const resolve = vi
      .fn()
      .mockResolvedValue({
        userId: id(2),
        roleSlug: 'super_admin',
        permissions: [],
        mustChangePassword: false,
        mfaRequired: false,
      });
    const handler = createMongoOstHandler(replica.db, resolve);
    const response = makeRes();
    await handler(makeReq({ method: 'GET', familyPath: `applications/${id(5)}` }), response.res);
    expect(response.state.status).toBe(200);
    expect(response.state.body).toMatchObject({ referralCodeHint: 'LEGACY', status: 'approved' });
    expect(JSON.stringify(response.state.body)).not.toContain('a'.repeat(64));
    const denied = makeRes();
    resolve.mockResolvedValue({
      userId: id(3),
      roleSlug: 'employee',
      permissions: [],
      mustChangePassword: false,
      mfaRequired: false,
    });
    await handler(makeReq({ method: 'GET', familyPath: 'applications' }), denied.res);
    expect(denied.state.status).toBe(403);
    const write = makeRes();
    await handler(makeReq({ method: 'POST', familyPath: 'applications', body: {} }), write.res);
    expect(write.state.status).toBe(501);
  } finally {
    await replica.stop();
  }
}, 15000);
