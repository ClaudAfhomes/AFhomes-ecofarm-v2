import { expect, it } from 'vitest';
import type { SourceArchive } from './migration-source-archive.js';
import { backupChecksum } from './local-mongo-backup.js';
import { reviewSourceFileBindings } from './migration-file-bindings.js';

const owner = '00000000-0000-4000-8000-000000000001';
function fixture(): SourceArchive {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const jpeg = Buffer.from([
    255, 216, 255, 192, 0, 11, 8, 0, 1, 0, 1, 1, 1, 17, 0, 255, 218, 0, 6, 1, 1, 0, 0, 255, 217,
  ]);
  return {
    version: 1,
    project: 'ikaevepedpqygdlipsei',
    capturedAt: new Date().toISOString(),
    schema: { tables: [], columns: [], constraints: [], indexes: [] },
    tables: [
      { name: 'auth.users', rows: [JSON.stringify({ id: owner })] },
      { name: 'public.customers', rows: [JSON.stringify({ id: 'customer' })] },
      { name: 'public.ost_applications', rows: [] },
      { name: 'public.payments', rows: [] },
      {
        name: 'public.identity_documents',
        rows: [
          JSON.stringify({
            id: 'document',
            subject_type: 'customer',
            customer_id: 'customer',
            ost_application_id: null,
            storage_path: 'afhomes-customer-ids/customer/id.png',
            mime_type: 'image/png',
            size_bytes: png.length,
            sha256: backupChecksum(png),
          }),
        ],
      },
    ],
    files: [
      {
        bucket: 'afhomes-customer-ids',
        key: 'customer/id.png',
        version: null,
        size: png.length,
        contentType: 'image/png',
        sha256: backupChecksum(png),
        bytes: png.toString('base64'),
      },
      {
        bucket: 'afhomes-profile-photos',
        key: `${owner}/profile.jpg`,
        version: null,
        size: jpeg.length,
        contentType: 'image/jpeg',
        sha256: backupChecksum(jpeg),
        bytes: jpeg.toString('base64'),
      },
    ],
  };
}
it('joins original ID documents and profile photos to explicit source subjects without modifying them', () => {
  const source = fixture(),
    saved = structuredClone(source);
  expect(reviewSourceFileBindings(source)).toMatchObject({
    ready: true,
    issues: [],
    files: 2,
    boundFiles: 2,
    documents: 1,
    profilePhotos: 1,
    nativeMetadataLinked: false,
  });
  expect(source).toEqual(saved);
});
it('blocks wrong owners, missing files, checksum mismatches and unexplained orphans without exposing paths or private fields', () => {
  for (const mutate of [
    (source: SourceArchive) => {
      source.tables.find((table) => table.name === 'auth.users')!.rows = [];
    },
    (source: SourceArchive) => {
      source.files.shift();
    },
    (source: SourceArchive) => {
      source.files[0]!.sha256 = '0'.repeat(64);
    },
    (source: SourceArchive) => {
      source.files[0]!.size = 999;
    },
    (source: SourceArchive) => {
      source.tables.find((table) => table.name === 'public.identity_documents')!.rows = [];
    },
  ]) {
    const source = fixture();
    mutate(source);
    const result = reviewSourceFileBindings(source);
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain('customer/id.png');
  }
});
