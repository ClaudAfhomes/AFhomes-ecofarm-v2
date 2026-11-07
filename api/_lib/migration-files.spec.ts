import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it, vi } from 'vitest';
import { LocalPrivateObjectStore } from './private-object-store.js';
import {
  verifyMigrationFiles,
  planMigrationFiles,
  copyMigrationFiles,
  type MigrationFile,
} from './migration-files.js';

const bytes = Buffer.from('SYNTHETIC FILE ONLY');
const file = (): MigrationFile => ({
  bucket: 'afhomes-customer-ids',
  sourceKey: 'synthetic-owner/id.png',
  targetKey: 'customer-ids/synthetic-target/id.png',
  ownerTable: 'public.customers',
  sourceOwnerId: 'synthetic-owner',
  targetOwnerId: 'synthetic-target',
  size: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex'),
  contentType: 'image/png',
});
const mapping = [
  { table: 'public.customers', sourceId: 'synthetic-owner', targetId: 'synthetic-target' },
];
const source = async () => ({ bytes: Buffer.from(bytes), contentType: 'image/png' });

it('verifies actual local private bytes read-only with explicit owner mapping and repeatable checks', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-file-migration-'));
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    await store.put(file().targetKey, bytes, 'image/png');
    const put = vi.spyOn(store, 'put');
    const remove = vi.spyOn(store, 'remove');
    const input = [file()],
      before = structuredClone(input);
    const result = await verifyMigrationFiles(input, mapping, 1024, source, store);
    expect(result).toMatchObject({ ready: true, issues: [] });
    expect(await verifyMigrationFiles(input, mapping, 1024, source, store)).toEqual(result);
    expect(input).toEqual(before);
    expect(put).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('blocks unsafe paths, public buckets, owner ambiguity, duplicates and invalid metadata before reading', async () => {
  for (const change of [
    { sourceKey: '../private' },
    { targetKey: '/absolute' },
    { targetKey: 'private.metadata' },
    { targetKey: 'https://example.invalid/file' },
    { bucket: 'afhomes-cms-media' },
    { targetOwnerId: 'other-owner' },
    { size: 0 },
    { size: 1025 },
    { sha256: 'bad' },
    { contentType: 'image/png\r\nPRIVATE' },
  ]) {
    const read = vi.fn(source);
    const result = await verifyMigrationFiles([{ ...file(), ...change }], mapping, 1024, read, {
      read,
    });
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(read).not.toHaveBeenCalled();
  }
  for (const owners of [[], [...mapping, ...mapping]])
    expect(
      (await verifyMigrationFiles([file()], owners, 1024, source, { read: source })).ready,
    ).toBe(false);
  expect(
    (await verifyMigrationFiles([file(), file()], mapping, 1024, source, { read: source })).ready,
  ).toBe(false);
});

it('rejects missing, changed and unreadable bytes without echoing paths, payloads or raw errors', async () => {
  for (const read of [
    async () => null,
    async () => ({ bytes: Buffer.from('CHANGED'), contentType: 'image/png' }),
    async () => ({ bytes, contentType: 'application/pdf' }),
    async () => {
      throw new Error('PRIVATE-READ-ERROR');
    },
  ]) {
    for (const side of ['source', 'target']) {
      const result = await verifyMigrationFiles(
        [file()],
        mapping,
        1024,
        side === 'source' ? read : source,
        { read: side === 'target' ? read : source },
      );
      expect(result.ready).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(JSON.stringify(result)).not.toContain('PRIVATE-READ-ERROR');
      expect(JSON.stringify(result)).not.toContain('synthetic-owner');
      expect(JSON.stringify(result)).not.toContain('SYNTHETIC FILE ONLY');
    }
  }
});

it('requires the reviewed file digest and copies exclusively with verified replay, never ordinary overwrite', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-file-copy-'));
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    const files = [
      file(),
      {
        ...file(),
        sourceKey: 'synthetic-owner/second.png',
        targetKey: 'customer-ids/synthetic-target/second.png',
      },
    ];
    const plan = planMigrationFiles(files, mapping, 1024);
    expect(plan.ready).toBe(true);
    const read = vi.fn(source),
      put = vi.spyOn(store, 'put');
    expect(
      (await copyMigrationFiles(files, mapping, 1024, read, store, 'wrong-digest')).ready,
    ).toBe(false);
    expect(read).not.toHaveBeenCalled();
    const result = await copyMigrationFiles(files, mapping, 1024, read, store, plan.manifestDigest);
    expect(result).toMatchObject({
      ready: true,
      issues: [],
      receipts: [
        { file: 0, status: 'created' },
        { file: 1, status: 'created' },
      ],
    });
    expect(
      (await copyMigrationFiles(files, mapping, 1024, read, store, plan.manifestDigest)).receipts,
    ).toEqual([
      { file: 0, status: 'reused' },
      { file: 1, status: 'reused' },
    ]);
    expect(await verifyMigrationFiles(files, mapping, 1024, source, store)).toMatchObject({
      ready: true,
      issues: [],
    });
    expect(put).not.toHaveBeenCalled();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('preflights the complete file batch before creating anything and preserves conflicting existing bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-file-conflict-'));
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    const files = [
      file(),
      {
        ...file(),
        sourceKey: 'synthetic-owner/second.png',
        targetKey: 'customer-ids/synthetic-target/second.png',
      },
    ];
    await store.put(files[1]!.targetKey, Buffer.from('PRESERVE-EXISTING'), 'image/png');
    const create = vi.spyOn(store, 'createIfAbsent');
    const result = await copyMigrationFiles(
      files,
      mapping,
      1024,
      source,
      store,
      planMigrationFiles(files, mapping, 1024).manifestDigest,
    );
    expect(result.ready).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(create).not.toHaveBeenCalled();
    expect((await store.read(files[1]!.targetKey, 1024))!.bytes.toString()).toBe(
      'PRESERVE-EXISTING',
    );
    expect(await store.exists(files[0]!.targetKey)).toBe(false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('resumes verified files after interruption and prevents competing exclusive writes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-file-resume-'));
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    const files = [
      file(),
      {
        ...file(),
        sourceKey: 'synthetic-owner/second.png',
        targetKey: 'customer-ids/synthetic-target/second.png',
      },
    ];
    const digest = planMigrationFiles(files, mapping, 1024).manifestDigest;
    let writes = 0;
    const interrupted = {
      read: store.read.bind(store),
      createIfAbsent: async (key: string, data: Uint8Array, type: string) => {
        if (++writes === 2) throw new Error('PRIVATE-WRITE-ERROR');
        return store.createIfAbsent(key, data, type);
      },
    };
    const failed = await copyMigrationFiles(files, mapping, 1024, source, interrupted, digest);
    expect(failed.ready).toBe(false);
    expect(failed.receipts).toEqual([{ file: 0, status: 'created' }]);
    expect(JSON.stringify(failed)).not.toContain('PRIVATE-WRITE-ERROR');
    expect(
      (await copyMigrationFiles(files, mapping, 1024, source, store, digest)).receipts,
    ).toEqual([
      { file: 0, status: 'reused' },
      { file: 1, status: 'created' },
    ]);
    const winners = await Promise.all([
      store.createIfAbsent('exclusive/probe.png', bytes, 'image/png'),
      store.createIfAbsent('exclusive/probe.png', Buffer.from('OTHER'), 'image/png'),
    ]);
    expect(winners.sort()).toEqual([false, true]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('leaves an interrupted data/metadata pair blocked instead of overwriting existing bytes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-file-orphan-'));
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    const input = file(),
      destination = path.join(root, ...input.targetKey.split('/'));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, 'PRESERVE-ORPHAN');
    const result = await copyMigrationFiles(
      [input],
      mapping,
      1024,
      source,
      store,
      planMigrationFiles([input], mapping, 1024).manifestDigest,
    );
    expect(result.ready).toBe(false);
    expect((await readFile(destination)).toString()).toBe('PRESERVE-ORPHAN');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
