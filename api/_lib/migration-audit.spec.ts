import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { reviewedAuditMigrationTable, reviewSourceAuditHistory } from './migration-audit.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { reconcileMigrationMapping } from './migration-reconciliation.js';
import { createTestReplica } from './testing/mongo-replica.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function fixture() {
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
      reviewedAuditMigrationTable(),
    ],
  };
  const event = (number: string, actor: string | null) => ({
    id: number,
    actor_id: actor,
    action: 'HISTORICAL_EVENT',
    entity_type: 'customer',
    entity_id: id(4),
    reason: null,
    before_data: { name: 'Original name', actor_id: id(1) },
    after_data: {
      status: 'active',
      must_change_password: true,
      token_hash: 'nonreusable-historical-hash',
    },
    request_id: 'original-request',
    ip_hash: null,
    created_at: '2026-10-31T00:00:00.123456Z',
  });
  const data = {
    source: {
      'public.staff_users': [{ id: id(1), email: 'owner@example.invalid', status: 'active' }],
      'public.audit_events': [
        event('9007199254740993', id(1)),
        event('9007199254740994', id(3)),
        event('9007199254740995', null),
      ],
    },
    target: {
      staff_users: [{ _id: id(2), email: 'owner@example.invalid', protected: true }],
      audit_events: [{ _id: id(9), action: 'NATIVE_EVENT' }],
    },
    identities: {
      source: [
        { id: id(1), email: 'owner@example.invalid' },
        { id: id(3), email: 'customer@example.invalid' },
      ],
      target: [
        { id: id(2), email: 'owner@example.invalid' },
        { id: id(3), email: 'customer@example.invalid' },
      ],
    },
  };
  return { manifest, data };
}

it('declares every audit column and the auth.users actor FK rather than inventing staff ownership', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  );
  const table = reviewedAuditMigrationTable();
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
  expect(table.bigints).toEqual({ id: 'identifier' });
  expect(table.authActor).toBe(true);
  const actorFK = inventory.constraints.find(
    (constraint: { schema: string; table: string; kind: string }) =>
      constraint.schema === 'public' &&
      constraint.table === 'audit_events' &&
      constraint.kind === 'f',
  );
  expect(actorFK).toMatchObject({
    columns: ['actor_id'],
    reference_schema: 'auth',
    reference_table: 'users',
  });
});

it('preserves bigint IDs, raw payloads and exact timestamps while remapping only the protected top-level actor', () => {
  const { manifest, data } = fixture(),
    saved = structuredClone(data);
  const plan = planMigrationMapping(manifest, data);
  expect(plan.issues).toEqual([]);
  expect(plan.records.audit_events).toHaveLength(3);
  expect(plan.records.audit_events![0]).toMatchObject({
    _id: '9007199254740993',
    actor_id: id(2),
    before_data: { name: 'Original name', actor_id: id(1) },
    created_at: '2026-10-31T00:00:00.123Z',
    migration_source_timestamps: { created_at: '2026-10-31T00:00:00.123456Z' },
  });
  expect(plan.records.audit_events![1]!.actor_id).toBe(id(3));
  expect(reviewSourceAuditHistory(data.source, data.identities.source)).toMatchObject({
    ready: true,
    events: 3,
    payloadsRewritten: false,
  });
  expect(data).toEqual(saved);
  data.identities.target.pop();
  expect(planMigrationMapping(manifest, data).ready).toBe(false);
});

it('blocks private audit evidence without rewriting or returning its values', () => {
  for (const payload of [
    { temporaryPassword: 'SYNTHETIC-PRIVATE' },
    { nested: [{ government_id_number: 'SYNTHETIC-PRIVATE' }] },
    { token: 'SYNTHETIC-PRIVATE' },
    { secret: 'SYNTHETIC-PRIVATE' },
  ]) {
    const { manifest, data } = fixture();
    Object.assign(data.source['public.audit_events'][0]!, { after_data: payload });
    const saved = structuredClone(data);
    const plan = planMigrationMapping(manifest, data);
    expect(plan.ready).toBe(false);
    expect(plan.records).toEqual({});
    expect(JSON.stringify(plan.issues)).not.toContain('SYNTHETIC-PRIVATE');
    expect(reviewSourceAuditHistory(data.source, data.identities.source).ready).toBe(false);
    expect(data).toEqual(saved);
  }
});

it('appends native historical audit rows and reconciles an identical replay without altering existing audit or owner records', async () => {
  const replica = await createTestReplica();
  try {
    const { manifest, data } = fixture(),
      plan = planMigrationMapping(manifest, data);
    expect(plan.issues).toEqual([]);
    for (const [name, records] of Object.entries(data.target))
      if (records.length) await replica.db.collection<MigrationRecord>(name).insertMany(records);
    for (const [name, records] of Object.entries(plan.records))
      if (records.length) await replica.db.collection<MigrationRecord>(name).insertMany(records);
    const after: Record<string, MigrationRecord[]> = {};
    for (const table of manifest.tables)
      after[table.target] = await replica.db
        .collection<MigrationRecord>(table.target)
        .find()
        .toArray();
    expect(reconcileMigrationMapping(manifest, data, after).issues).toEqual([]);
    expect(planMigrationMapping(manifest, { ...data, target: after }).records.audit_events).toEqual(
      [],
    );
    expect(after.staff_users).toEqual(data.target.staff_users);
    expect(after.audit_events!.find((row) => row._id === id(9))).toEqual(
      data.target.audit_events[0],
    );
  } finally {
    await replica.stop();
  }
}, 15000);
