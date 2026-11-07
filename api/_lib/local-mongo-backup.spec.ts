import { randomBytes, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { BSON, Long } from 'mongodb';
import { expect, it, vi } from 'vitest';
import { createTestReplica } from './testing/mongo-replica.js';
import {
  captureLocalBackup,
  sealLocalBackup,
  openLocalBackup,
  restoreLocalBackup,
} from './local-mongo-backup.js';

it('encrypts stored bytes, preserves BSON/schema/files and restores independently without an existing target', async () => {
  const source = await createTestReplica(),
    target = await createTestReplica();
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-local-backup-'));
  const key = randomBytes(32);
  try {
    const files = path.join(root, 'source');
    await mkdir(files);
    await writeFile(path.join(files, 'synthetic.bin'), Buffer.from('SYNTHETIC-PRIVATE-FILE'));
    await source.db.createCollection('synthetic', {
      validator: { $jsonSchema: { required: ['value'] } },
    });
    await source.db.collection('synthetic').createIndex({ value: 1 }, { unique: true });
    const owner = {
      _id: 'synthetic-owner',
      value: 'SYNTHETIC-PRIVATE-ROW',
      money: '9007199254740993.01',
      large: Long.fromString('9223372036854775807'),
      createdAt: new Date('2026-01-01T00:00:00Z'),
    };
    await source.db.collection<typeof owner>('synthetic').insertOne(owner);
    const snapshot = await captureLocalBackup(source.db, files);
    const archive = sealLocalBackup(snapshot, key);
    expect(archive.includes(Buffer.from('SYNTHETIC-PRIVATE'))).toBe(false);
    const archivePath = path.join(root, 'encrypted.afhb');
    await writeFile(archivePath, archive);
    const decoded = openLocalBackup(await readFile(archivePath), key);
    await source.stop();
    const db = target.client.db('afhomes_restore_' + randomUUID().replaceAll('-', ''));
    const summary = await restoreLocalBackup(db, path.join(root, 'restored'), decoded);
    expect(summary).toMatchObject({ collections: 1, documents: 1, files: 1 });
    const restored = await db
      .collection('synthetic')
      .findOne({}, { promoteValues: false, promoteLongs: false });
    expect(Buffer.from(BSON.serialize(restored!)).equals(Buffer.from(BSON.serialize(owner)))).toBe(
      true,
    );
    expect((await readFile(path.join(root, 'restored', 'synthetic.bin'))).toString()).toBe(
      'SYNTHETIC-PRIVATE-FILE',
    );
    await expect(
      db.collection('synthetic').insertOne({ value: owner.value }),
    ).rejects.toMatchObject({ code: 11000 });
    await expect(db.collection('synthetic').insertOne({ other: true })).rejects.toMatchObject({
      code: 121,
    });
    await expect(restoreLocalBackup(db, path.join(root, 'another'), decoded)).rejects.toThrow();
    await expect(
      restoreLocalBackup(target.db, path.join(root, 'blocked'), decoded),
    ).rejects.toThrow();
    const altered = Buffer.from(archive);
    altered[altered.length - 1]! ^= 1;
    expect(() => openLocalBackup(altered, key)).toThrow();
    expect(() => openLocalBackup(archive, randomBytes(32))).toThrow();
  } finally {
    key.fill(0);
    await source.stop().catch(() => {});
    await target.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);

it('refuses a changing file/database capture and invalid archive paths before any restore', async () => {
  const source = await createTestReplica();
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-unstable-backup-'));
  try {
    const file = path.join(root, 'synthetic.bin');
    await writeFile(file, 'before');
    const original = source.db.listCollections.bind(source.db);
    let calls = 0;
    vi.spyOn(source.db, 'listCollections').mockImplementation((filter, options) => {
      if (++calls === 1) writeFileSync(file, 'changed');
      return original(filter, options);
    });
    await expect(captureLocalBackup(source.db, root)).rejects.toThrow(
      'Backup source changed during capture',
    );
    expect(() =>
      sealLocalBackup(
        { version: 1, collections: [], files: [{ key: '../escape', bytes: '' }] },
        randomBytes(32),
      ),
    ).toThrow();
    expect(() => openLocalBackup(Buffer.alloc(5), randomBytes(32))).toThrow();
  } finally {
    await source.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 30000);
