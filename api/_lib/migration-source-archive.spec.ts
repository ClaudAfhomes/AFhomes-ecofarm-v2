import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import { backupChecksum } from './local-mongo-backup.js';
import {
  sealSourceArchive,
  openSourceArchive,
  verifySourceArchiveLocally,
  type SourceArchive,
} from './migration-source-archive.js';

function fixture(): SourceArchive {
  const bytes = Buffer.from('LABELLED SYNTHETIC PRIVATE DOCUMENT');
  return {
    version: 1,
    project: 'ikaevepedpqygdlipsei',
    capturedAt: new Date().toISOString(),
    schema: {
      tables: [
        { schema: 'public', name: 'customers' },
        { schema: 'storage', name: 'objects' },
        { schema: 'storage', name: 'buckets' },
        { schema: 'auth', name: 'users' },
      ],
      columns: [],
      constraints: [],
      indexes: [],
    },
    tables: [
      {
        name: 'public.customers',
        rows: ['{"id":"synthetic","long":9223372036854775807,"at":"2026-10-31T01:02:03.123456Z"}'],
      },
      { name: 'storage.buckets', rows: ['{"id":"afhomes-customer-ids","public":false}'] },
      {
        name: 'storage.objects',
        rows: [
          '{"bucket_id":"afhomes-customer-ids","name":"synthetic/id.png","version":"v1","metadata":{"size":35,"mimetype":"image/png"}}',
        ],
      },
      { name: 'auth.users', rows: ['{"id":"synthetic","encrypted_password":"FICTIONAL-HASH"}'] },
    ],
    files: [
      {
        bucket: 'afhomes-customer-ids',
        key: 'synthetic/id.png',
        version: 'v1',
        size: bytes.length,
        contentType: 'image/png',
        sha256: backupChecksum(bytes),
        bytes: bytes.toString('base64'),
      },
    ],
  };
}

it('authenticates encrypted source archives without parsing or rounding original row values', () => {
  const source = fixture(),
    key = randomBytes(32),
    saved = structuredClone(source);
  const archive = sealSourceArchive(source, key);
  expect(archive.includes(Buffer.from('FICTIONAL-HASH'))).toBe(false);
  expect(openSourceArchive(archive, key)).toEqual(source);
  expect(source).toEqual(saved);
  expect(openSourceArchive(archive, key).tables[0]!.rows[0]).toContain('9223372036854775807');
  archive[archive.length - 1] ^= 1;
  expect(() => openSourceArchive(archive, key)).toThrow();
  expect(() => openSourceArchive(sealSourceArchive(source, key), randomBytes(32))).toThrow();
});

it('requires complete private-object coverage, correct hashes, schema coverage and safe paths', () => {
  for (const mutate of [
    (source: SourceArchive) => {
      source.files = [];
    },
    (source: SourceArchive) => {
      source.files[0]!.key = '../outside';
    },
    (source: SourceArchive) => {
      source.files[0]!.sha256 = '0'.repeat(64);
    },
    (source: SourceArchive) => {
      source.files.push(...source.files);
    },
    (source: SourceArchive) => {
      source.tables.pop();
    },
    (source: SourceArchive) => {
      source.files[0]!.version = 'changed';
    },
    (source: SourceArchive) => {
      source.files[0]!.contentType = 'text/html';
    },
  ]) {
    const source = fixture();
    mutate(source);
    expect(() => sealSourceArchive(source, randomBytes(32))).toThrow();
  }
});

it('verifies every raw row and private file in a new disposable namespace without mounting identities', async () => {
  const replica = await createTestReplica();
  try {
    const source = fixture();
    const db = replica.client.db('afhomes_source_rehearsal_' + randomUUID().replaceAll('-', ''));
    expect(await verifySourceArchiveLocally(db, source)).toEqual({
      tables: 4,
      rows: 4,
      files: 1,
      sourceConnectionUsed: false,
      nativeWorkflowsVerified: false,
    });
    expect(await db.collection('auth_users').countDocuments()).toBe(0);
    await expect(verifySourceArchiveLocally(db, source)).rejects.toThrow();
    await expect(verifySourceArchiveLocally(replica.db, source)).rejects.toThrow();
  } finally {
    await replica.stop();
  }
}, 15000);
