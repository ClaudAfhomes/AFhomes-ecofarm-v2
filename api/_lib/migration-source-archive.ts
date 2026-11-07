import type { Db } from 'mongodb';
import {
  backupChecksum,
  sealLocalBackup,
  openLocalBackup,
  LOCAL_BACKUP_MAX_BYTES,
} from './local-mongo-backup.js';
import { checkKey } from './private-object-store.js';

export type SourceArchive = {
  version: 1;
  project: 'ikaevepedpqygdlipsei';
  capturedAt: string;
  schema: {
    tables: { schema: string; name: string }[];
    columns: unknown[];
    constraints: unknown[];
    indexes: unknown[];
  };
  tables: { name: string; rows: string[] }[];
  files: {
    bucket: string;
    key: string;
    version: string | null;
    size: number;
    contentType: string;
    sha256: string;
    bytes: string;
  }[];
};
const fileKey = 'supabase-source/snapshot.json';
const authColumns = new Set([
  'id',
  'email',
  'encrypted_password',
  'created_at',
  'updated_at',
  'email_confirmed_at',
  'banned_until',
  'deleted_at',
  'is_anonymous',
  'is_sso_user',
  'providers',
]);

function validateSourceArchive(source: SourceArchive) {
  if (
    source?.version !== 1 ||
    source.project !== 'ikaevepedpqygdlipsei' ||
    !Number.isFinite(Date.parse(source.capturedAt)) ||
    !Array.isArray(source.schema?.tables) ||
    !Array.isArray(source.tables) ||
    !Array.isArray(source.files) ||
    !Array.isArray(source.schema.columns) ||
    !Array.isArray(source.schema.constraints) ||
    !Array.isArray(source.schema.indexes)
  )
    throw new Error('Invalid source archive');
  const names = new Set<string>();
  for (const table of source.tables) {
    if (
      !/^(public|private|storage|auth)\.[a-z][a-z0-9_]*$/.test(table.name) ||
      names.has(table.name) ||
      (table.name.startsWith('auth.') && table.name !== 'auth.users') ||
      (table.name.startsWith('storage.') &&
        !['storage.objects', 'storage.buckets'].includes(table.name)) ||
      !Array.isArray(table.rows)
    )
      throw new Error('Invalid source table');
    names.add(table.name);
    for (const raw of table.rows) {
      if (typeof raw !== 'string') throw new Error('Source rows must retain raw JSON text');
      // Parse only for shape checks; never use the parsed numbers as migration values.
      const row = JSON.parse(raw);
      if (
        !row ||
        Array.isArray(row) ||
        typeof row !== 'object' ||
        (table.name === 'auth.users' && Object.keys(row).some((column) => !authColumns.has(column)))
      )
        throw new Error('Invalid source row projection');
    }
  }
  const expected = source.schema.tables.map((table) => `${table.schema}.${table.name}`);
  if (
    new Set(expected).size !== expected.length ||
    expected.length !== names.size ||
    expected.some((name) => !names.has(name)) ||
    !names.has('auth.users') ||
    !names.has('storage.objects') ||
    !names.has('storage.buckets')
  )
    throw new Error('Source schema coverage mismatch');
  const buckets = new Map<string, boolean>();
  for (const raw of source.tables.find((table) => table.name === 'storage.buckets')!.rows) {
    const row = JSON.parse(raw);
    if (
      typeof row.id !== 'string' ||
      !/^[a-z][a-z0-9-]*$/.test(row.id) ||
      typeof row.public !== 'boolean' ||
      buckets.has(row.id)
    )
      throw new Error('Invalid source bucket');
    buckets.set(row.id, row.public);
  }
  const objects = new Map<string, { size: number; contentType: string; version: string | null }>();
  for (const raw of source.tables.find((table) => table.name === 'storage.objects')!.rows) {
    const row = JSON.parse(raw);
    if (!buckets.has(row.bucket_id) || typeof row.name !== 'string')
      throw new Error('Invalid source object');
    checkKey(row.name);
    if (buckets.get(row.bucket_id)) continue;
    const key = `${row.bucket_id}/${row.name}`;
    if (
      objects.has(key) ||
      !Number.isSafeInteger(row.metadata?.size) ||
      row.metadata.size < 0 ||
      typeof row.metadata?.mimetype !== 'string' ||
      (row.version !== null && typeof row.version !== 'string')
    )
      throw new Error('Invalid source object metadata');
    objects.set(key, {
      size: row.metadata.size,
      contentType: row.metadata.mimetype.toLowerCase(),
      version: row.version,
    });
  }
  const seen = new Set<string>();
  for (const file of source.files) {
    checkKey(file.key);
    const key = `${file.bucket}/${file.key}`,
      object = objects.get(key),
      bytes = Buffer.from(file.bytes, 'base64');
    if (
      !object ||
      seen.has(key) ||
      bytes.toString('base64') !== file.bytes ||
      bytes.length !== object.size ||
      file.size !== object.size ||
      file.version !== object.version ||
      file.contentType !== object.contentType ||
      backupChecksum(bytes) !== file.sha256
    )
      throw new Error('Source object coverage or integrity mismatch');
    seen.add(key);
  }
  if (
    seen.size !== objects.size ||
    Buffer.byteLength(JSON.stringify(source)) > LOCAL_BACKUP_MAX_BYTES / 2
  )
    throw new Error('Incomplete or oversized source archive');
}

export function sealSourceArchive(source: SourceArchive, key: Buffer) {
  validateSourceArchive(source);
  const plain = Buffer.from(JSON.stringify(source));
  try {
    return sealLocalBackup(
      { version: 1, collections: [], files: [{ key: fileKey, bytes: plain.toString('base64') }] },
      key,
    );
  } finally {
    plain.fill(0);
  }
}

export function openSourceArchive(archive: Buffer, key: Buffer): SourceArchive {
  const envelope = openLocalBackup(archive, key);
  if (
    envelope.collections.length ||
    envelope.files.length !== 1 ||
    envelope.files[0]?.key !== fileKey
  )
    throw new Error('Not a source archive');
  const plain = Buffer.from(envelope.files[0].bytes, 'base64');
  try {
    const source = JSON.parse(plain.toString('utf8')) as SourceArchive;
    validateSourceArchive(source);
    return source;
  } finally {
    plain.fill(0);
  }
}

/** Staging proof only: raw rows never become active native identities or business records. */
export async function verifySourceArchiveLocally(db: Db, source: SourceArchive) {
  validateSourceArchive(source);
  if (
    !/^afhomes_source_rehearsal_[a-f0-9]{32}$/.test(db.databaseName) ||
    !db.client.options.hosts.length ||
    db.client.options.hosts.some((host) => !['127.0.0.1', '::1'].includes(host.host ?? '')) ||
    (await db.listCollections().toArray()).length
  )
    throw new Error('New disposable loopback namespace required');
  let rows = 0;
  for (const table of source.tables) {
    const collection = db.collection<{ _id: string; raw: string }>(
      'source_' + table.name.replace('.', '_'),
    );
    await db.createCollection(collection.collectionName);
    if (table.rows.length)
      await collection.insertMany(table.rows.map((raw, index) => ({ _id: String(index), raw })));
    const stored = await collection.find().toArray();
    if (
      stored.length !== table.rows.length ||
      stored.some((row) => row.raw !== table.rows[Number(row._id)])
    )
      throw new Error('Source staging record verification failed');
    rows += stored.length;
  }
  const files = db.collection<{ _id: string; bytes: Buffer }>('source_private_files');
  await db.createCollection(files.collectionName);
  for (const [index, file] of source.files.entries()) {
    await files.insertOne({ _id: String(index), bytes: Buffer.from(file.bytes, 'base64') });
    const stored = await files.findOne({ _id: String(index) }, { promoteBuffers: true });
    if (!stored || backupChecksum(stored.bytes) !== file.sha256)
      throw new Error('Source staging file verification failed');
  }
  return {
    tables: source.tables.length,
    rows,
    files: source.files.length,
    sourceConnectionUsed: false,
    nativeWorkflowsVerified: false,
  };
}
