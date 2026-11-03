import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';
import { PROFILE_PHOTO_MAX_BYTES } from '@afhomes/contracts';
import {
  planMigrationProfilePhotos,
  verifyMigrationProfilePhotoLinks,
} from './migration-profile-photos.js';
import { planMigrationFiles, copyMigrationFiles } from './migration-files.js';
import type { MigrationRecord } from './migration-mapping.js';
import type { SourceArchive } from './migration-source-archive.js';
import { backupChecksum } from './local-mongo-backup.js';
import { LocalPrivateObjectStore } from './private-object-store.js';
import { createTestReplica } from './testing/mongo-replica.js';
import { setupMongoProfilePhotos } from './profile-photo.mongo.js';
import type { MigrationIdentitySnapshots } from './migration-identity-references.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const jpeg = Buffer.from([
  255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 6, 1, 1, 0, 0, 255, 217,
]);
function fixture() {
  const headers = [
    { id: id(1), email: 'owner@example.invalid' },
    { id: id(3), email: 'staff@example.invalid' },
  ];
  const photo = (owner: string) => ({
    bucket: 'afhomes-profile-photos',
    key: `${owner}/profile.jpg`,
    version: null,
    size: jpeg.length,
    contentType: 'image/jpeg',
    sha256: backupChecksum(jpeg),
    bytes: jpeg.toString('base64'),
  });
  const archive: SourceArchive = {
    version: 1,
    project: 'ikaevepedpqygdlipsei',
    capturedAt: '2026-10-31T00:00:00.000Z',
    schema: { tables: [], columns: [], constraints: [], indexes: [] },
    files: [photo(id(1)), photo(id(3))],
    tables: [
      { name: 'auth.users', rows: headers.map((row) => JSON.stringify(row)) },
      { name: 'public.staff_users', rows: headers.map((row) => JSON.stringify(row)) },
      { name: 'public.customers', rows: [] },
      {
        name: 'storage.objects',
        rows: [id(1), id(3)].map((owner) =>
          JSON.stringify({
            bucket_id: 'afhomes-profile-photos',
            name: `${owner}/profile.jpg`,
            updated_at: '2026-10-31T00:00:00.123456Z',
          }),
        ),
      },
    ],
  };
  const identities = {
    source: headers,
    target: [{ id: id(2), email: 'owner@example.invalid' }, headers[1]!],
  };
  const owner = { sourceId: id(1), targetId: id(2) };
  const existing: MigrationRecord[] = [
    {
      _id: id(9),
      owner_id: id(2),
      object_key: 'existing/admin.jpg',
      size: 100,
      content_type: 'image/jpeg',
      updated_at: '2026-11-01T00:00:00.000Z',
    },
  ];
  return { archive, identities, owner, existing };
}

it('excludes the protected owner, retains source timestamp evidence and requires exact identity matching', () => {
  const f = fixture(),
    saved = structuredClone(f);
  const plan = planMigrationProfilePhotos(f.archive, f.identities, f.owner, f.existing);
  expect(plan.issues).toEqual([]);
  expect(plan.protectedPhotosExcluded).toBe(1);
  expect(plan.files).toHaveLength(1);
  expect(plan.records[0]).toMatchObject({
    owner_id: id(3),
    updated_at: '2026-10-31T00:00:00.123Z',
    migration_source_updated_at: '2026-10-31T00:00:00.123456Z',
  });
  expect(f).toEqual(saved);
  for (const change of [
    'wrong_identity',
    'business_owner',
    'existing_photo',
    'corrupt_file',
    'missing_time',
  ] as const) {
    const bad = fixture();
    if (change === 'wrong_identity') bad.identities.target[1]!.id = id(8);
    if (change === 'business_owner')
      bad.archive.tables.find((table) => table.name === 'public.staff_users')!.rows.pop();
    if (change === 'existing_photo')
      bad.existing.push({ _id: id(8), owner_id: id(3), object_key: 'existing/staff.jpg' });
    if (change === 'corrupt_file') bad.archive.files[1]!.sha256 = '0'.repeat(64);
    if (change === 'missing_time')
      bad.archive.tables.find((table) => table.name === 'storage.objects')!.rows.pop();
    const result = planMigrationProfilePhotos(bad.archive, bad.identities, bad.owner, bad.existing);
    expect(result.ready).toBe(false);
    expect(result.records).toEqual([]);
    expect(result.files).toEqual([]);
  }
});

it('preserves the native photo for an approved test identity alias and rejects an unapproved collision', () => {
  const f = fixture();
  for (const table of f.archive.tables.filter(table => ['auth.users', 'public.staff_users'].includes(table.name)))
    table.rows[1] = JSON.stringify({ id: id(3), email: 'john@gmail.com' });
  const identities: MigrationIdentitySnapshots = {
    source: [f.identities.source[0]!, { id: id(3), email: 'john@gmail.com' }],
    target: [f.identities.target[0]!, { id: id(4), email: 'john@gmail.com' }],
    approvedAliases: [{ sourceId: id(3), targetId: id(4), email: 'john@gmail.com', reason: 'owner-approved-test-account' }],
  };
  const native = [...f.existing, { _id: id(10), owner_id: id(4), object_key: 'existing/john.jpg' }];
  const plan = planMigrationProfilePhotos(f.archive, identities, f.owner, native);
  expect(plan).toMatchObject({ ready: true, records: [], files: [], protectedPhotosExcluded: 1, preservedTestAccountPhotos: 1 });
  expect(planMigrationProfilePhotos(f.archive, { ...identities, approvedAliases: [] }, f.owner, native).ready).toBe(false);
});

it('links only readback-verified original JPEGs and produces no replacement on an identical native replay', async () => {
  const f = fixture(),
    plan = planMigrationProfilePhotos(f.archive, f.identities, f.owner, f.existing);
  const root = await mkdtemp(path.join(tmpdir(), 'afhomes-photo-migration-'));
  const replica = await createTestReplica();
  try {
    const store = new LocalPrivateObjectStore({
      root,
      baseURL: 'http://127.0.0.1:3000',
      secret: 'synthetic'.repeat(8),
    });
    expect(
      (
        await verifyMigrationProfilePhotoLinks(
          f.archive,
          f.identities,
          f.owner,
          f.existing,
          plan.manifestDigest,
          store,
        )
      ).ready,
    ).toBe(false);
    const filePlan = planMigrationFiles(plan.files, plan.mapping, PROFILE_PHOTO_MAX_BYTES);
    const source = async () => ({ bytes: jpeg, contentType: 'image/jpeg' });
    expect(
      (
        await copyMigrationFiles(
          plan.files,
          plan.mapping,
          PROFILE_PHOTO_MAX_BYTES,
          source,
          store,
          filePlan.manifestDigest,
        )
      ).ready,
    ).toBe(true);
    const checked = await verifyMigrationProfilePhotoLinks(
      f.archive,
      f.identities,
      f.owner,
      f.existing,
      plan.manifestDigest,
      store,
    );
    expect(checked.ready).toBe(true);
    expect(checked.records).toEqual(plan.records);
    await setupMongoProfilePhotos(replica.db);
    await replica.db
      .collection<MigrationRecord>('profile_photos')
      .insertMany([...f.existing, ...checked.records]);
    const after = await replica.db.collection<MigrationRecord>('profile_photos').find().toArray();
    expect(after.find((row) => row.owner_id === id(2))).toEqual(f.existing[0]);
    const replay = planMigrationProfilePhotos(f.archive, f.identities, f.owner, after);
    expect(replay.ready).toBe(true);
    expect(replay.records).toEqual([]);
    expect(
      (
        await verifyMigrationProfilePhotoLinks(
          f.archive,
          f.identities,
          f.owner,
          after,
          replay.manifestDigest,
          store,
        )
      ).ready,
    ).toBe(true);
    expect(
      (
        await verifyMigrationProfilePhotoLinks(
          f.archive,
          f.identities,
          f.owner,
          after,
          plan.manifestDigest,
          store,
        )
      ).ready,
    ).toBe(false);
  } finally {
    await replica.stop();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
