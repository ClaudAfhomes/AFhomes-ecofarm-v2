import { readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  reviewedIdentityDocumentMigrationTable,
  migrationDocumentIssues,
  reconcileSourceDocumentMetadata,
  planMigrationDocumentFiles,
  verifyMigrationDocumentLinks,
} from './migration-documents.js';
import {
  planMigrationMapping,
  type MigrationManifest,
  type MigrationRecord,
} from './migration-mapping.js';
import { planMigrationFiles, copyMigrationFiles } from './migration-files.js';
import { backupChecksum } from './local-mongo-backup.js';
import { LocalPrivateObjectStore } from './private-object-store.js';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  currentMongoIdentityDocument,
  currentMongoCustomerIdentityPaths,
} from './documents.mongo.js';
import { DOCUMENT_MAX_BYTES } from './documents.js';
import { randomUUID } from 'node:crypto';
import { rehearseMigratedDocuments } from './migration-document-rehearsal.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const at = '2026-10-31T00:00:00.123456Z';
function fixture() {
  const definition = reviewedIdentityDocumentMigrationTable();
  const document: Record<string, unknown> = Object.fromEntries(
    definition.columns.map((column) => [column, null]),
  );
  Object.assign(document, {
    id: id(5),
    subject_type: 'customer',
    customer_id: id(3),
    storage_path: `afhomes-customer-ids/customer/${id(3)}/source.png`,
    original_filename: 'synthetic.png',
    mime_type: 'image/png',
    size_bytes: String(bytes.length),
    sha256: backupChecksum(bytes),
    extracted_data: {
      fields: { governmentIdNumber: { value: 'SYNTHETIC-PRIVATE', confidence: 1 } },
    },
    reviewed_data: { fields: { firstName: 'Original', governmentIdNumber: 'SYNTHETIC-PRIVATE' } },
    reviewed_by: id(1),
    reviewed_at: at,
    created_at: at,
    uploaded_by: id(1),
    ocr_status: 'completed',
    ocr_provider: 'manual',
    verification_status: 'confirmed',
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
        ownerField: 'id',
      },
      {
        source: 'public.customers',
        target: 'customers',
        key: ['id'],
        columns: ['id', 'email'],
        referenceMatch: ['email'],
      },
      {
        source: 'public.ost_applications',
        target: 'ost_applications',
        key: ['id'],
        columns: ['id'],
      },
      definition,
    ],
  };
  const source = {
    'public.staff_users': [{ id: id(1), email: 'owner@example.invalid', status: 'active' }],
    'public.customers': [{ id: id(3), email: 'synthetic@example.invalid' }],
    'public.ost_applications': [],
    'public.identity_documents': [document],
  };
  const target = {
    staff_users: [{ _id: id(2), email: 'owner@example.invalid', protected: true }],
    customers: [{ _id: id(4), email: 'synthetic@example.invalid' }],
    ost_applications: [],
    identity_documents: [],
  };
  const mapping = [
    { table: 'public.customers', sourceId: id(3), targetId: id(4) },
    { table: 'public.identity_documents', sourceId: id(5), targetId: id(5) },
  ];
  return { definition, document, manifest, source, target, mapping };
}

it('covers exact document metadata, source keys and declared subject/reviewer/upload references', () => {
  const inventory = JSON.parse(
    readFileSync(
      new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url),
      'utf8',
    ),
  );
  const definition = reviewedIdentityDocumentMigrationTable();
  const columns = inventory.columns.filter(
    (column: { schema: string; table: string }) =>
      `${column.schema}.${column.table}` === definition.source,
  );
  expect(definition.columns).toEqual(columns.map((column: { name: string }) => column.name));
  expect(definition.notNull).toEqual(
    columns
      .filter((column: { nullable: string }) => column.nullable === 'NO')
      .map((column: { name: string }) => column.name),
  );
  for (const [type, declared] of [
    ['uuid', definition.uuids],
    ['text', definition.text],
    ['timestamp with time zone', definition.timestamps],
  ] as const)
    expect(declared).toEqual(
      columns
        .filter((column: { type: string }) => column.type === type)
        .map((column: { name: string }) => column.name),
    );
  expect(definition.bigints).toEqual({ size_bytes: 'safe_integer' });
  const constraints = inventory.constraints.filter(
    (constraint: { schema: string; table: string }) =>
      `${constraint.schema}.${constraint.table}` === definition.source,
  );
  expect(definition.key).toEqual(
    constraints.find((constraint: { kind: string }) => constraint.kind === 'p').columns,
  );
  for (const constraint of constraints.filter(
    (constraint: { kind: string }) => constraint.kind === 'f',
  ))
    expect(definition.references?.[constraint.columns[0]]).toBe(
      `${constraint.reference_schema}.${constraint.reference_table}`,
    );
});

it('preserves document evidence while marking metadata unavailable until file verification', () => {
  const f = fixture(),
    before = structuredClone(f.source);
  const plan = planMigrationMapping(f.manifest, { source: f.source, target: f.target });
  expect(plan.issues).toEqual([]);
  expect(reconcileSourceDocumentMetadata(f.source)).toMatchObject({ ready: true, documents: 1 });
  expect(plan.records.identity_documents![0]).toMatchObject({
    migration_file_transfer_required: true,
    reviewed_by: id(2),
    uploaded_by: id(2),
    customer_id: id(4),
    size_bytes: bytes.length,
    reviewed_data: f.document.reviewed_data,
  });
  expect(f.source).toEqual(before);
  for (const update of [
    { subject_type: 'unknown' },
    { customer_id: null },
    { ost_application_id: id(8) },
    { mime_type: 'text/html' },
    { size_bytes: '10485761' },
    { verification_status: 'approved' },
    { sha256: 'wrong' },
  ])
    expect(
      migrationDocumentIssues(f.definition, { ...f.document, ...update }).length,
    ).toBeGreaterThan(0);
  expect(
    JSON.stringify(
      migrationDocumentIssues(f.definition, { ...f.document, sha256: 'SYNTHETIC-PRIVATE' }),
    ),
  ).not.toContain('SYNTHETIC-PRIVATE');
});

it('copies original bytes exclusively, verifies ownership/readback and proposes links without database writes', async () => {
  const f = fixture(),
    mapped = planMigrationMapping(f.manifest, { source: f.source, target: f.target }).records
      .identity_documents!;
  const plan = planMigrationDocumentFiles([f.document], mapped, f.mapping);
  expect(plan.issues).toEqual([]);
  expect(plan.files[0]!.targetKey).toContain(`/customer/${id(4)}/${id(5)}.png`);
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-document-migration-'));
  const replica = await createTestReplica();
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    const readSource = vi.fn().mockResolvedValue({ bytes, contentType: 'image/png' });
    await replica.db.collection<MigrationRecord>('identity_documents').insertMany(mapped);
    expect(await currentMongoIdentityDocument(replica.db, { customer_id: id(4) })).toBeNull();
    expect(await currentMongoCustomerIdentityPaths(replica.db, [id(4)])).toEqual(new Map());
    expect(
      (
        await verifyMigrationDocumentLinks(
          [f.document],
          mapped,
          f.mapping,
          plan.manifestDigest,
          readSource,
          store,
        )
      ).ready,
    ).toBe(false);
    const filePlan = planMigrationFiles(plan.files, f.mapping, DOCUMENT_MAX_BYTES);
    expect(
      (
        await copyMigrationFiles(
          plan.files,
          f.mapping,
          DOCUMENT_MAX_BYTES,
          readSource,
          store,
          filePlan.manifestDigest,
        )
      ).ready,
    ).toBe(true);
    const result = await verifyMigrationDocumentLinks(
      [f.document],
      mapped,
      f.mapping,
      plan.manifestDigest,
      readSource,
      store,
    );
    expect(result.ready).toBe(true);
    expect(result.links[0]!.record).toMatchObject({
      migration_file_transfer_required: false,
      upload_state: 'uploaded',
      migration_source_storage_path: f.document.storage_path,
      storage_path: plan.files[0]!.targetKey,
    });
    expect(
      await replica.db.collection<MigrationRecord>('identity_documents').findOne({ _id: id(5) }),
    ).toMatchObject({
      migration_file_transfer_required: true,
      storage_path: f.document.storage_path,
    });
    expect((await store.read(plan.files[0]!.targetKey, DOCUMENT_MAX_BYTES))!.bytes).toEqual(bytes);
    expect(
      await verifyMigrationDocumentLinks(
        [f.document],
        mapped,
        f.mapping,
        plan.manifestDigest,
        readSource,
        store,
      ),
    ).toEqual(result);
    readSource.mockClear();
    expect(
      (
        await verifyMigrationDocumentLinks(
          [f.document],
          mapped,
          f.mapping,
          'wrong',
          readSource,
          store,
        )
      ).ready,
    ).toBe(false);
    expect(readSource).not.toHaveBeenCalled();
    readSource.mockResolvedValueOnce({ bytes: Buffer.from('tampered'), contentType: 'image/png' });
    const mismatch = await verifyMigrationDocumentLinks([f.document], mapped, f.mapping, plan.manifestDigest, readSource, store);
    expect(mismatch.ready).toBe(false);
    expect(mismatch.links).toEqual([]);
    expect(planMigrationDocumentFiles([f.document], mapped, []).ready).toBe(false);
    expect(
      planMigrationDocumentFiles([f.document], [{ ...mapped[0]!, customer_id: id(99) }], f.mapping)
        .ready,
    ).toBe(false);
    expect(
      planMigrationDocumentFiles(
        [f.document],
        [{ ...mapped[0]!, sha256: 'c'.repeat(64) }],
        f.mapping,
      ).ready,
    ).toBe(false);
  } finally {
    await replica.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);

it('rehearses native document linking only in a fresh disposable namespace and leaves authentication empty', async () => {
  const f = fixture(),
    replica = await createTestReplica();
  const files = [
    {
      bucket: 'afhomes-customer-ids',
      key: String(f.document.storage_path).slice('afhomes-customer-ids/'.length),
      version: null,
      size: bytes.length,
      contentType: 'image/png',
      sha256: backupChecksum(bytes),
      bytes: bytes.toString('base64'),
    },
  ];
  try {
    await expect(rehearseMigratedDocuments(replica.db, f.source, files)).rejects.toThrow(
      'New disposable',
    );
    const db = replica.client.db('afhomes_document_rehearsal_' + randomUUID().replaceAll('-', ''));
    expect(await rehearseMigratedDocuments(db, f.source, files)).toMatchObject({
      ready: true,
      documents: 1,
      copied: 1,
      linked: 1,
      identicalFileReplay: true,
      authIdentitiesCreated: 0,
      sharedDatabaseUsed: false,
    });
    await expect(rehearseMigratedDocuments(db, f.source, files)).rejects.toThrow('New disposable');
  } finally {
    await replica.stop();
  }
}, 15000);
