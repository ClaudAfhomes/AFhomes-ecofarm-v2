import { expect, it } from 'vitest';
import { decodeMigrationSourceRows } from './migration-source-decode.js';
import type { SourceArchive } from './migration-source-archive.js';
import type { MigrationManifest } from './migration-mapping.js';

function fixture(
  raw = '{"id":9223372036854775807,"amount":42,"created_at":"2026-10-31T01:02:03.123456Z","metadata":{"rate":"0.1000","points":30},"enabled":false}',
) {
  const columns = [
    { name: 'id', type: 'bigint' },
    { name: 'amount', type: 'bigint' },
    { name: 'created_at', type: 'timestamp with time zone' },
    { name: 'metadata', type: 'jsonb' },
    { name: 'enabled', type: 'boolean' },
  ];
  const source: SourceArchive = {
    version: 1,
    project: 'ikaevepedpqygdlipsei',
    capturedAt: new Date().toISOString(),
    schema: {
      tables: [{ schema: 'public', name: 'points_ledger' }],
      columns: columns.map((column) => ({ ...column, schema: 'public', table: 'points_ledger' })),
      constraints: [],
      indexes: [],
    },
    tables: [{ name: 'public.points_ledger', rows: [raw] }],
    files: [],
  };
  const manifest: MigrationManifest = {
    version: 1,
    protectedOwner: {
      table: 'public.staff_users',
      sourceId: 'source-owner',
      targetId: 'native-owner',
    },
    tables: [
      {
        source: 'public.points_ledger',
        target: 'points_ledger',
        key: ['id'],
        columns: columns.map((column) => column.name),
        bigints: { id: 'identifier', amount: 'safe_integer' },
      },
    ],
  };
  return { source, manifest };
}

it('decodes bigint tokens from their original text and keeps timestamps and nested snapshots intact', () => {
  const { source, manifest } = fixture(),
    saved = structuredClone(source);
  const result = decodeMigrationSourceRows(source, manifest);
  expect(result.issues).toEqual([]);
  expect(result.source['public.points_ledger']).toEqual([
    {
      id: '9223372036854775807',
      amount: '42',
      created_at: '2026-10-31T01:02:03.123456Z',
      metadata: { rate: '0.1000', points: 30 },
      enabled: false,
    },
  ]);
  expect(source).toEqual(saved);
});

it('blocks lossy numbers inside historical JSON rather than rounding or changing their type', () => {
  for (const value of ['9223372036854775807', '0.10000000000000000001', '1e400']) {
    const { source, manifest } = fixture(
      `{"id":42,"amount":1,"created_at":null,"metadata":{"value":${value}},"enabled":true}`,
    );
    expect(decodeMigrationSourceRows(source, manifest)).toMatchObject({
      ready: false,
      source: {},
      issues: [expect.objectContaining({ column: 'metadata', code: 'UNSAFE_JSON_NUMBER' })],
    });
  }
});

it('validates SQL scalar types and rejects malformed metadata or missing source columns without partial output', () => {
  for (const mutate of [
    (source: SourceArchive) => {
      source.tables[0]!.rows[0] = source.tables[0]!.rows[0]!.replace(
        '9223372036854775807',
        '9223372036854775808',
      );
    },
    (source: SourceArchive) => {
      source.tables[0]!.rows[0] = source.tables[0]!.rows[0]!.replace('false', '"false"');
    },
    (source: SourceArchive) => {
      source.schema.columns.pop();
    },
    (source: SourceArchive) => {
      source.schema.columns.push(source.schema.columns[0]);
    },
    (source: SourceArchive) => {
      source.tables = [];
    },
  ]) {
    const { source, manifest } = fixture();
    mutate(source);
    expect(decodeMigrationSourceRows(source, manifest)).toMatchObject({ ready: false, source: {} });
  }
});

it('accepts exact JSON decimal/exponent round trips and enforces int32 bounds', () => {
  const { source, manifest } = fixture(
    '{"id":1,"amount":2,"created_at":null,"metadata":{"a":1.20,"b":1e2,"c":-0.25},"enabled":true}',
  );
  expect(
    decodeMigrationSourceRows(source, manifest).source['public.points_ledger']![0]!.metadata,
  ).toEqual({ a: 1.2, b: 100, c: -0.25 });
  (source.schema.columns[1] as { type: string }).type = 'integer';
  source.tables[0]!.rows[0] = source.tables[0]!.rows[0]!.replace(
    '"amount":2',
    '"amount":2147483648',
  );
  expect(decodeMigrationSourceRows(source, manifest).ready).toBe(false);
});

it('retains SQL text arrays while rejecting non-string elements', () => {
  const { source, manifest } = fixture(
    '{"id":1,"amount":2,"created_at":null,"metadata":["Walk-In","Referral"],"enabled":true}',
  );
  (source.schema.columns[3] as { type: string }).type = 'ARRAY';
  expect(
    decodeMigrationSourceRows(source, manifest).source['public.points_ledger']![0]!.metadata,
  ).toEqual(['Walk-In', 'Referral']);
  source.tables[0]!.rows[0] = source.tables[0]!.rows[0]!.replace('"Referral"', '1');
  expect(decodeMigrationSourceRows(source, manifest).ready).toBe(false);
});
