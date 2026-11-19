import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import {
  BSON,
  type CreateCollectionOptions,
  type IndexDescription,
  type IndexSpecification,
} from 'mongodb';
import { createTestReplica } from './mongo-replica.js';
import { LocalPrivateObjectStore } from '../private-object-store.js';

type Encoded = { bytes: string; sha256: string };
type Collection = { name: string; options: string; indexes: string; documents: Encoded[] };
type Snapshot = { version: 1; collections: Collection[]; files: (Encoded & { key: string })[] };
const prefix = Buffer.from('AFHMONGO1');
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const encode = (value: object) => Buffer.from(BSON.serialize(value)).toString('base64');
const decode = (value: string) => BSON.deserialize(Buffer.from(value, 'base64'));
const maxSize = 32 * 1024 * 1024;
const checkedBytes = (value: Encoded) => {
  const bytes = Buffer.from(value.bytes, 'base64');
  if (digest(bytes) !== value.sha256) throw new Error('Recovery checksum mismatch');
  return bytes;
};
function fileAt(root: string, key: string) {
  if (!/^[A-Za-z0-9._/-]+$/.test(key) || key.split('/').some((p) => !p || p === '.' || p === '..'))
    throw new Error('Invalid recovery file key');
  const file = path.resolve(root, ...key.split('/'));
  if (!file.startsWith(path.resolve(root) + path.sep)) throw new Error('Invalid recovery file key');
  return file;
}

/** Synthetic rehearsal ONLY: provisions its own loopback servers; accepts no URI, env or existing target. */
export async function createRecoveryRehearsal() {
  const source = await createTestReplica();
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-recovery-'));
  const key = randomBytes(32),
    sourceRoot = path.join(root, 'source-files');
  const targets: Awaited<ReturnType<typeof createTestReplica>>[] = [];
  let stopped = false;
  const store = (folder: string) =>
    new LocalPrivateObjectStore({
      root: folder,
      baseURL: 'http://localhost:52761',
      secret: 'synthetic-file-recovery-only'.repeat(3),
    });
  await mkdir(sourceRoot, { recursive: true });
  async function files(folder: string, relative = ''): Promise<Snapshot['files']> {
    const result: Snapshot['files'] = [];
    for (const entry of await readdir(path.join(folder, relative), { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('Recovery refuses linked private files');
      const name = relative ? relative + '/' + entry.name : entry.name;
      if (entry.isDirectory()) result.push(...(await files(folder, name)));
      else if (entry.isFile()) {
        const bytes = await readFile(fileAt(folder, name));
        result.push({ key: name, bytes: bytes.toString('base64'), sha256: digest(bytes) });
      } else throw new Error('Unsupported recovery file');
    }
    return result.sort((a, b) => a.key.localeCompare(b.key));
  }
  return {
    source: { db: source.db, client: source.client, files: store(sourceRoot) },
    targetCount: () => targets.length,
    async stopSource() {
      if (!stopped) {
        await source.stop();
        stopped = true;
      }
    },
    async capture() {
      if (stopped) throw new Error('Disposable source is stopped');
      const snapshot: Snapshot = { version: 1, collections: [], files: await files(sourceRoot) };
      const metadata = await source.db.listCollections({}, { nameOnly: false }).toArray();
      for (const meta of metadata) {
        const collectionOptions = meta.options ?? {};
        if (meta.type !== 'collection' || meta.name.startsWith('system.'))
          throw new Error('Unsupported recovery collection');
        if (
          Object.keys(collectionOptions).some(
            (k) => !['validator', 'validationLevel', 'validationAction', 'collation'].includes(k),
          )
        )
          throw new Error('Unsupported recovery collection options');
        const indexes = await source.db.collection(meta.name).listIndexes().toArray();
        if (
          indexes.some((index) =>
            Object.keys(index).some(
              (k) =>
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
                ].includes(k),
            ),
          )
        )
          throw new Error('Unsupported recovery index');
        snapshot.collections.push({
          name: meta.name,
          options: encode(collectionOptions),
          indexes: encode({ indexes }),
          documents: [],
        });
      }
      const session = source.client.startSession({ defaultTimeoutMS: 45_000 });
      try {
        await session.withTransaction(
          async () => {
            for (const collection of snapshot.collections) {
              collection.documents = [];
              for await (const document of source.db
                .collection(collection.name)
                .find({}, { session, promoteValues: false, promoteLongs: false })) {
                const bytes = BSON.serialize(document);
                collection.documents.push({
                  bytes: Buffer.from(bytes).toString('base64'),
                  sha256: digest(bytes),
                });
              }
            }
          },
          { readConcern: { level: 'snapshot' } },
        );
      } finally {
        await session.endSession();
      }
      const plain = Buffer.from(JSON.stringify(snapshot));
      if (plain.length > maxSize) throw new Error('Recovery rehearsal size limit exceeded');
      const nonce = randomBytes(12),
        cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(prefix);
      const encrypted = Buffer.concat([cipher.update(plain), cipher.final()]);
      const bundle = Buffer.concat([prefix, nonce, cipher.getAuthTag(), encrypted]);
      const archive = path.join(root, `snapshot-${randomUUID()}.afhb`);
      await writeFile(archive, bundle, { flag: 'wx', mode: 0o600 });
      return readFile(archive);
    },
    async restore(bundle: Buffer, options: { runtimeCompatibility?: boolean } = {}) {
      let snapshot: Snapshot;
      try {
        if (
          bundle.length < prefix.length + 28 ||
          bundle.length > maxSize + 1024 ||
          !bundle.subarray(0, prefix.length).equals(prefix)
        )
          throw new Error();
        const start = prefix.length,
          decipher = createDecipheriv('aes-256-gcm', key, bundle.subarray(start, start + 12));
        decipher.setAAD(prefix);
        decipher.setAuthTag(bundle.subarray(start + 12, start + 28));
        snapshot = JSON.parse(
          Buffer.concat([decipher.update(bundle.subarray(start + 28)), decipher.final()]).toString(
            'utf8',
          ),
        ) as Snapshot;
      } catch {
        throw new Error('Recovery archive authentication failed');
      }
      if (
        snapshot.version !== 1 ||
        !Array.isArray(snapshot.collections) ||
        !Array.isArray(snapshot.files)
      )
        throw new Error('Unsupported recovery archive');
      for (const collection of snapshot.collections)
        for (const document of collection.documents) checkedBytes(document);
      for (const file of snapshot.files) {
        fileAt(root, file.key);
        checkedBytes(file);
      }
      // Every invocation gets a new server AND namespace; existing targets cannot be selected or overwritten.
      const target = await createTestReplica();
      targets.push(target);
      const db = target.client.db(
        options.runtimeCompatibility
          ? 'afhomes_dev'
          : 'afhomes_restore_' + randomUUID().replaceAll('-', ''),
      );
      if ((await db.listCollections().toArray()).length)
        throw new Error('Recovery requires an empty new target');
      for (const collection of snapshot.collections) {
        await db.createCollection(
          collection.name,
          decode(collection.options) as CreateCollectionOptions,
        );
        const restored = db.collection(collection.name);
        for (const document of collection.documents)
          await restored.insertOne(
            BSON.deserialize(checkedBytes(document), { promoteValues: false, promoteLongs: false }),
            { bypassDocumentValidation: true },
          );
        for (const index of decode(collection.indexes).indexes as IndexDescription[]) {
          if (index.name === '_id_') continue;
          const { key: indexKey, ...options } = index as IndexDescription & {
            v?: number;
            ns?: string;
            background?: boolean;
          };
          delete options.v;
          delete options.ns;
          delete options.background;
          await restored.createIndex(indexKey as IndexSpecification, options);
        }
        const current = await restored
          .find({}, { promoteValues: false, promoteLongs: false })
          .toArray();
        if (
          current.length !== collection.documents.length ||
          current.some((doc, i) => digest(BSON.serialize(doc)) !== collection.documents[i]!.sha256)
        )
          throw new Error('Restored document verification failed');
      }
      const folder = path.join(root, db.databaseName);
      await mkdir(folder);
      for (const file of snapshot.files) {
        const destination = fileAt(folder, file.key),
          bytes = checkedBytes(file);
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, bytes, { flag: 'wx', mode: 0o600 });
        if (digest(await readFile(destination)) !== file.sha256)
          throw new Error('Restored file verification failed');
      }
      return {
        db,
        client: target.client,
        files: store(folder),
        summary: {
          collections: snapshot.collections.length,
          documents: snapshot.collections.reduce((sum, c) => sum + c.documents.length, 0),
          files: snapshot.files.length,
        },
      };
    },
    async close() {
      const resolved = path.resolve(root);
      if (
        path.dirname(resolved) !== path.resolve(tmpdir()) ||
        !path.basename(resolved).startsWith('afhomes-recovery-')
      )
        throw new Error('Unsafe recovery cleanup target');
      try {
        await Promise.all([...targets.map((t) => t.stop()), ...(!stopped ? [source.stop()] : [])]);
      } finally {
        key.fill(0);
        await rm(resolved, { recursive: true, force: true });
      }
    },
  };
}
