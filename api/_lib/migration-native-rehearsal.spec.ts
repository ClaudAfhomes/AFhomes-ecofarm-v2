import { expect, it } from 'vitest';
import type { Db } from 'mongodb';
import type { SourceArchive } from './migration-source-archive.js';
import { rehearseNativeMigration } from './migration-native-rehearsal.js';

it.each([
  { databaseName: 'afhomes_dev' },
  { databaseName: 'afhomes_native_rehearsal_' + 'a'.repeat(32), client: { options: { hosts: [{ host: 'example.mongodb.net' }] } } },
  { databaseName: 'afhomes_native_rehearsal_' + 'b'.repeat(32), client: { options: { hosts: [{ host: '127.0.0.1' }] } }, listCollections: () => ({ toArray: async () => [{ name: 'existing' }] }) },
])('refuses shared, remote and nonempty targets before reading source credentials', async (db) => {
  await expect(rehearseNativeMigration(db as unknown as Db, {} as SourceArchive)).rejects.toThrow('New disposable loopback namespace required');
});
