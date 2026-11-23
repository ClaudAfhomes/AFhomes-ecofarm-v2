import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  BSON,
  type Db,
  type CreateCollectionOptions,
  type IndexDescription,
  type IndexSpecification,
} from 'mongodb';
import { checkKey } from './private-object-store.js';
import { purchaseFingerprint } from './purchase-fingerprint.js';

export type LocalBackupSnapshot = {
  version: 1;
  collections: { name: string; options: string; indexes: string; documents: string[] }[];
  files: { key: string; bytes: string }[];
};
export const LOCAL_BACKUP_MAX_BYTES = 64 * 1024 * 1024;
export const backupChecksum = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

const header = Buffer.from('AFHLOCAL1');
const encode = (value: object) => Buffer.from(BSON.serialize(value)).toString('base64');
const decode = (value: string) => {
  if (typeof value !== 'string' || Buffer.from(value, 'base64').toString('base64') !== value)
    throw new Error('Invalid backup encoding');
  return BSON.deserialize(Buffer.from(value, 'base64'), {
    promoteValues: false,
    promoteLongs: false,
  });
};
function fileAt(root: string, key: string) {
  checkKey(key);
  const destination = path.resolve(root, ...key.split('/'));
  if (!destination.startsWith(path.resolve(root) + path.sep))
    throw new Error('Invalid backup file path');
  return destination;
}
function validateSnapshot(snapshot: LocalBackupSnapshot) {
  if (
    snapshot?.version !== 1 ||
    !Array.isArray(snapshot.collections) ||
    !Array.isArray(snapshot.files)
  )
    throw new Error('Invalid backup snapshot');
  const names = new Set<string>(),
    files = new Set<string>();
  for (const collection of snapshot.collections) {
    if (
      !/^[a-z][a-z0-9_]*$/.test(collection.name) ||
      names.has(collection.name) ||
      !Array.isArray(collection.documents)
    )
      throw new Error('Invalid backup collection');
    names.add(collection.name);
    if (
      Object.keys(decode(collection.options)).some(
        (key) => !['validator', 'validationLevel', 'validationAction', 'collation'].includes(key),
      )
    )
      throw new Error('Unsupported collection options');
    const indexes = decode(collection.indexes).indexes as IndexDescription[];
    if (
      !Array.isArray(indexes) ||
      indexes.some((index) =>
        Object.keys(index).some(
          (key) =>
            ![
              'v',
              'ns',
              'background',
              'key',
              'name',
              'unique',
              'sparse',
              'partialFilterExpression',
              'expireAfterSeconds',
              'collation',
              'hidden',
              'wildcardProjection',
            ].includes(key),
        ),
      )
    )
      throw new Error('Unsupported backup index');
    for (const document of collection.documents)
      if (!Object.hasOwn(decode(document), '_id'))
        throw new Error('Backup record requires its identifier');
  }
  for (const file of snapshot.files) {
    checkKey(file.key);
    if (
      files.has(file.key) ||
      typeof file.bytes !== 'string' ||
      Buffer.from(file.bytes, 'base64').toString('base64') !== file.bytes
    )
      throw new Error('Invalid backup file');
    files.add(file.key);
  }
}
export async function captureLocalBackup(db: Db, filesRoot: string): Promise<LocalBackupSnapshot> {
  if (db.databaseName !== 'afhomes_dev') throw new Error('Backup scope must be afhomes_dev');
  async function capture() {
    const snapshot: LocalBackupSnapshot = { version: 1, collections: [], files: [] };
    let size = 0;
    const bounded = (bytes: Buffer) => {
      size += bytes.length;
      if (size > LOCAL_BACKUP_MAX_BYTES) throw new Error('Backup size limit exceeded');
      return bytes.toString('base64');
    };
    async function files(relative = '') {
      let entries;
      try {
        const folder = fileAt(filesRoot, relative || 'root-check');
        const directory = relative ? folder : path.resolve(filesRoot);
        if ((await lstat(directory)).isSymbolicLink())
          throw new Error('Linked backup directory refused');
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (
          !relative &&
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        )
          return;
        throw error;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const key = relative ? `${relative}/${entry.name}` : entry.name;
        if (entry.isSymbolicLink()) throw new Error('Linked backup file refused');
        if (entry.isDirectory()) await files(key);
        else if (entry.isFile()) {
          const file = fileAt(filesRoot, key);
          if ((await lstat(file)).size > LOCAL_BACKUP_MAX_BYTES - size)
            throw new Error('Backup size limit exceeded');
          snapshot.files.push({ key, bytes: bounded(await readFile(file)) });
        } else throw new Error('Unsupported backup file');
      }
    }
    await files();
    const metadata = (await db.listCollections({}, { nameOnly: false }).toArray()).sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const meta of metadata) {
      if (meta.type !== 'collection') throw new Error('Unsupported backup collection');
      snapshot.collections.push({
        name: meta.name,
        options: encode(meta.options ?? {}),
        indexes: encode({
          indexes: (await db.collection(meta.name).listIndexes().toArray()).sort((a, b) =>
            String(a.name).localeCompare(String(b.name)),
          ),
        }),
        documents: [],
      });
    }
    const session = db.client.startSession({ defaultTimeoutMS: 60000 });
    try {
      await session.withTransaction(
        async () => {
          for (const collection of snapshot.collections) {
            collection.documents = [];
            for await (const row of db
              .collection(collection.name)
              .find({}, { session, promoteValues: false, promoteLongs: false })
              .sort({ _id: 1 }))
              collection.documents.push(bounded(Buffer.from(BSON.serialize(row))));
          }
        },
        { readConcern: { level: 'snapshot' } },
      );
    } finally {
      await session.endSession();
    }
    validateSnapshot(snapshot);
    if (Buffer.byteLength(JSON.stringify(snapshot)) > LOCAL_BACKUP_MAX_BYTES)
      throw new Error('Backup size limit exceeded');
    return snapshot;
  }
  const first = await capture(),
    second = await capture();
  if (
    backupChecksum(Buffer.from(JSON.stringify(first))) !==
    backupChecksum(Buffer.from(JSON.stringify(second)))
  )
    throw new Error('Backup source changed during capture');
  return first;
}
export function sealLocalBackup(snapshot: LocalBackupSnapshot, key: Buffer): Buffer {
  validateSnapshot(snapshot);
  const plain = Buffer.from(JSON.stringify(snapshot));
  try {
    if (key.length !== 32 || plain.length > LOCAL_BACKUP_MAX_BYTES)
      throw new Error('Invalid backup key or size');
    const nonce = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', key, nonce);
    cipher.setAAD(header);
    const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([header, nonce, cipher.getAuthTag(), encrypted]);
  } finally {
    plain.fill(0);
  }
}
export function openLocalBackup(archive: Buffer, key: Buffer): LocalBackupSnapshot {
  let plain: Buffer | undefined;
  try {
    if (
      key.length !== 32 ||
      archive.length < header.length + 28 ||
      archive.length > LOCAL_BACKUP_MAX_BYTES + header.length + 28 ||
      !archive.subarray(0, header.length).equals(header)
    )
      throw new Error();
    const offset = header.length;
    const decipher = createDecipheriv('aes-256-gcm', key, archive.subarray(offset, offset + 12));
    decipher.setAAD(header);
    decipher.setAuthTag(archive.subarray(offset + 12, offset + 28));
    plain = Buffer.concat([decipher.update(archive.subarray(offset + 28)), decipher.final()]);
    const snapshot = JSON.parse(plain.toString('utf8')) as LocalBackupSnapshot;
    validateSnapshot(snapshot);
    return snapshot;
  } catch {
    throw new Error('Backup archive authentication or validation failed');
  } finally {
    plain?.fill(0);
  }
}
export async function restoreLocalBackup(db: Db, filesRoot: string, snapshot: LocalBackupSnapshot) {
  validateSnapshot(snapshot);
  if (
    !/^afhomes_restore_[a-f0-9]{32}$/.test(db.databaseName) ||
    !db.client.options.hosts.length ||
    db.client.options.hosts.some((host) => !['127.0.0.1', '::1'].includes(host.host ?? '')) ||
    (await db.listCollections().toArray()).length
  )
    throw new Error('Restore requires an empty isolated loopback namespace');
  await mkdir(filesRoot, { recursive: true });
  if ((await readdir(filesRoot)).length || (await lstat(filesRoot)).isSymbolicLink())
    throw new Error('Restore requires a new empty file directory');
  for (const collection of snapshot.collections) {
    await db.createCollection(
      collection.name,
      decode(collection.options) as CreateCollectionOptions,
    );
    const target = db.collection(collection.name);
    for (const document of collection.documents)
      await target.insertOne(decode(document), { bypassDocumentValidation: true });
    for (const index of decode(collection.indexes).indexes as IndexDescription[]) {
      if (index.name === '_id_') continue;
      const options = { ...index } as Record<string, unknown>;
      for (const key of ['key', 'v', 'ns', 'background']) delete options[key];
      await target.createIndex(index.key as IndexSpecification, options);
    }
    const current = (
      await target
        .find({}, { promoteValues: false, promoteLongs: false })
        .sort({ _id: 1 })
        .toArray()
    ).map((row) => encode(row));
    if (JSON.stringify(current) !== JSON.stringify(collection.documents))
      throw new Error('Restored document verification failed');
  }
  for (const file of snapshot.files) {
    const destination = fileAt(filesRoot, file.key),
      bytes = Buffer.from(file.bytes, 'base64');
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
    if (backupChecksum(await readFile(destination)) !== backupChecksum(bytes))
      throw new Error('Restored file verification failed');
  }
  const metadata = await db.listCollections({}, { nameOnly: false }).toArray();
  const normalized = (value: unknown) => JSON.parse(JSON.stringify(value));
  const indexState = (indexes: IndexDescription[]) =>
    indexes
      .map((index) => {
        const options = { ...index } as Record<string, unknown>;
        for (const key of ['v', 'ns', 'background', 'key']) delete options[key];
        return { key: Object.entries(normalized(index.key)), options: normalized(options) };
      })
      .sort((a, b) => String(a.options.name).localeCompare(String(b.options.name)));
  if (metadata.length !== snapshot.collections.length)
    throw new Error('Restored schema verification failed');
  for (const collection of snapshot.collections) {
    const restored = metadata.find((row) => row.name === collection.name);
    const indexes = await db.collection(collection.name).listIndexes().toArray();
    if (
      !restored ||
      purchaseFingerprint(normalized(restored.options ?? {})) !==
        purchaseFingerprint(normalized(decode(collection.options))) ||
      purchaseFingerprint(indexState(indexes)) !==
        purchaseFingerprint(indexState(decode(collection.indexes).indexes as IndexDescription[]))
    )
      throw new Error('Restored schema verification failed');
  }
  return {
    collections: snapshot.collections.length,
    documents: snapshot.collections.reduce(
      (sum, collection) => sum + collection.documents.length,
      0,
    ),
    files: snapshot.files.length,
  };
}
