import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Db } from 'mongodb';
import type { SourceArchive } from './migration-source-archive.js';
import {
  planMigrationMapping,
  type MigrationRecord,
  type MigrationManifest,
} from './migration-mapping.js';
import {
  reviewedIdentityDocumentMigrationTable,
  planMigrationDocumentFiles,
  verifyMigrationDocumentLinks,
} from './migration-documents.js';
import { planMigrationFiles, copyMigrationFiles } from './migration-files.js';
import { LocalPrivateObjectStore } from './private-object-store.js';
import { DOCUMENT_MAX_BYTES } from './documents.js';
import { currentMongoIdentityDocument, createMongoDocumentHandlers } from './documents.mongo.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';
import { identityDocumentSchema } from '@afhomes/contracts';
import type { authorizeAfHomes } from './afhomes-access.js';
import { makeReq, makeRes } from './testing/supabase-fake.js';

/** Approved source rehearsal only: fresh loopback database and self-created temporary file store. */
export async function rehearseMigratedDocuments(
  db: Db,
  decoded: Record<string, Record<string, unknown>[]>,
  files: SourceArchive['files'],
) {
  if (
    !/^afhomes_document_rehearsal_[a-f0-9]{32}$/.test(db.databaseName) ||
    !db.client.options.hosts.length ||
    db.client.options.hosts.some((host) => !['127.0.0.1', '::1'].includes(host.host ?? '')) ||
    (await db.listCollections().toArray()).length
  )
    throw new Error('New disposable loopback namespace required');
  const staff = decoded['public.staff_users'],
    documents = decoded['public.identity_documents'];
  if (
    !staff?.length ||
    !documents?.length ||
    !decoded['public.customers'] ||
    !decoded['public.ost_applications']
  )
    throw new Error('Document source tables required');
  const originalFingerprint = purchaseFingerprint({ decoded, files });
  const owner = staff[0]!,
    targetOwner = randomUUID();
  const manifest: MigrationManifest = {
    version: 1,
    timestampPrecision: 'preserve-source',
    protectedOwner: {
      table: 'public.staff_users',
      sourceId: String(owner.id),
      targetId: targetOwner,
    },
    tables: [
      {
        source: 'public.staff_users',
        target: 'staff_users',
        key: ['id'],
        columns: ['id', 'email', 'status'],
        ownerField: 'id',
      },
      ...['customers', 'ost_applications'].map((name) => ({
        source: `public.${name}`,
        target: name,
        key: ['id'],
        columns: ['id'],
      })),
      reviewedIdentityDocumentMigrationTable(),
    ],
  };
  const source = {
    'public.staff_users': staff.map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status,
    })),
    'public.customers': decoded['public.customers'].map((row) => ({ id: row.id })),
    'public.ost_applications': decoded['public.ost_applications'].map((row) => ({ id: row.id })),
    'public.identity_documents': documents,
  };
  const target: Record<string, MigrationRecord[]> = {
    staff_users: [{ _id: targetOwner, email: owner.email, synthetic_reference_owner: true }],
    customers: [],
    ost_applications: [],
    identity_documents: [],
  };
  const planned = planMigrationMapping(manifest, { source, target });
  if (!planned.ready) throw new Error('Document mapping rehearsal blocked');
  const mapped = planned.records.identity_documents!;
  const documentPlan = planMigrationDocumentFiles(documents, mapped, planned.mapping);
  if (!documentPlan.ready) throw new Error('Document transfer rehearsal blocked');
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-document-rehearsal-'));
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: randomBytes(32).toString('hex'),
    });
    const readSource = async (bucket: string, key: string, maxBytes: number) => {
      const matches = files.filter((file) => file.bucket === bucket && file.key === key);
      if (matches.length !== 1 || matches[0]!.size > maxBytes) return null;
      return {
        bytes: Buffer.from(matches[0]!.bytes, 'base64'),
        contentType: matches[0]!.contentType,
      };
    };
    for (const [name, records] of Object.entries(target))
      if (records.length) await db.collection<MigrationRecord>(name).insertMany(records);
    for (const [name, records] of Object.entries(planned.records))
      if (records.length) await db.collection<MigrationRecord>(name).insertMany(records);
    for (const row of mapped)
      if (await currentMongoIdentityDocument(db, { _id: row._id }))
        throw new Error('Staged document became active before file verification');
    const filePlan = planMigrationFiles(documentPlan.files, planned.mapping, DOCUMENT_MAX_BYTES);
    const copied = await copyMigrationFiles(
      documentPlan.files,
      planned.mapping,
      DOCUMENT_MAX_BYTES,
      readSource,
      store,
      filePlan.manifestDigest,
    );
    if (!copied.ready) throw new Error('Document byte copy rehearsal failed');
    const verified = await verifyMigrationDocumentLinks(
      documents,
      mapped,
      planned.mapping,
      documentPlan.manifestDigest,
      readSource,
      store,
    );
    if (!verified.ready) throw new Error('Document byte readback rehearsal failed');
    const session = db.client.startSession();
    try {
      await session.withTransaction(async () => {
        for (const link of verified.links) {
          const current = await db
            .collection<MigrationRecord>('identity_documents')
            .findOne({ _id: link.documentId }, { session });
          if (!current || purchaseFingerprint(current) !== link.expectedFingerprint)
            throw new Error('Document metadata changed during rehearsal');
          await db
            .collection<MigrationRecord>('identity_documents')
            .replaceOne({ _id: link.documentId }, link.record, { session });
          await db.collection('audit_events').insertOne(
            {
              action: 'DOCUMENT_FILE_MIGRATION_REHEARSED',
              entity_id: link.documentId,
              source_evidence_hash: link.expectedFingerprint,
            },
            { session },
          );
        }
      });
    } finally {
      await session.endSession();
    }
    for (const link of verified.links) {
      const stored = await db
        .collection<MigrationRecord>('identity_documents')
        .findOne({ _id: link.documentId });
      if (purchaseFingerprint(stored) !== purchaseFingerprint(link.record))
        throw new Error('Linked document metadata readback failed');
    }
    const authorize: typeof authorizeAfHomes = async () => ({
      userId: targetOwner,
      email: String(owner.email),
      fullName: 'Synthetic reference reviewer',
      status: 'active',
      roleId: targetOwner,
      roleSlug: 'super_admin',
      roleName: 'Synthetic reference reviewer',
      mustChangePassword: false,
      permissions: [],
    });
    const reader = createMongoDocumentHandlers(
      db,
      db.client,
      authorize,
      { BETTER_AUTH_SECRET: randomBytes(32).toString('hex') },
      store,
    );
    for (const link of verified.links) {
      const response = makeRes();
      await reader.handler(makeReq({ method: 'GET', familyPath: link.documentId }), response.res);
      if (
        response.state.status !== 200 ||
        !identityDocumentSchema.safeParse(response.state.body).success
      )
        throw new Error('Native historical document read contract failed');
    }
    if (
      purchaseFingerprint(
        await db.collection<MigrationRecord>('staff_users').findOne({ _id: targetOwner }),
      ) !== purchaseFingerprint(target.staff_users![0]) ||
      (await db.collection('auth_users').countDocuments()) ||
      (await db.collection('auth_accounts').countDocuments()) ||
      originalFingerprint !== purchaseFingerprint({ decoded, files })
    )
      throw new Error('Document rehearsal isolation failed');
    const replay = await copyMigrationFiles(
      documentPlan.files,
      planned.mapping,
      DOCUMENT_MAX_BYTES,
      readSource,
      store,
      filePlan.manifestDigest,
    );
    if (!replay.ready || replay.receipts.some((receipt) => receipt.status !== 'reused'))
      throw new Error('Document file replay failed');
    return {
      ready: true,
      documents: documents.length,
      copied: copied.receipts.length,
      linked: verified.links.length,
      identicalFileReplay: true,
      originalEvidenceUnchanged: true,
      authIdentitiesCreated: 0,
      sharedDatabaseUsed: false,
      nativeReadContractsVerified: true,
      authenticationAcceptance: false,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
