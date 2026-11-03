import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { reviewedEmptySourceGuards } from './migration-empty-source.js';
import { reviewedBusinessMigrationTables } from './migration-reviewed-manifest.js';
import { reviewMigrationSourceCoverage } from './migration-source-coverage.js';
import { planMigrationMapping } from './migration-mapping.js';
import type { SourceArchive } from './migration-source-archive.js';

it('covers every empty captured table with exact column/key/nullability declarations and blocks any unexpected rows', () => {
  const inventory = JSON.parse(readFileSync(new URL('../../docs/mongodb/SOURCE-SCHEMA-INVENTORY-2026-10-30.json', import.meta.url), 'utf8'));
  const guards = reviewedEmptySourceGuards(); expect(guards).toHaveLength(37);
  for (const table of guards) {
    const columns = inventory.columns.filter((column: {schema:string;table:string}) => `${column.schema}.${column.table}` === table.source);
    expect(table.requireEmpty).toBe(true); expect(table.columns).toEqual(columns.map((column: {name:string}) => column.name));
    expect(table.notNull).toEqual(columns.filter((column: {nullable:string}) => column.nullable === 'NO').map((column: {name:string}) => column.name));
    expect(table.key).toEqual(inventory.constraints.find((constraint: {schema:string;table:string;kind:string}) => `${constraint.schema}.${constraint.table}` === table.source && constraint.kind === 'p').columns);
  }
  const owner = { source: 'public.staff_users', target: 'staff_users', key: ['id'], columns: ['id','email'], ownerField: 'id' };
  const manifest = { version: 1 as const, protectedOwner: { table: 'public.staff_users', sourceId: 'source-owner', targetId: 'native-owner' }, tables: [owner, ...guards] };
  const source = Object.fromEntries(manifest.tables.map(table => [table.source, [] as Record<string, unknown>[]]));
  const target = Object.fromEntries(manifest.tables.map(table => [table.target, [] as {_id:string;email?:string}[]]));
  source['public.staff_users'] = [{ id: 'source-owner', email: 'owner@example.invalid' }]; target.staff_users = [{ _id: 'native-owner', email: 'owner@example.invalid' }];
  expect(planMigrationMapping(manifest, { source, target }).issues).toEqual([]);
  source[guards[0]!.source] = [{}];
  expect(planMigrationMapping(manifest, { source, target }).issues).toContainEqual(expect.objectContaining({ code: 'NONEMPTY_SOURCE_REQUIRES_MAPPING_REVIEW' }));
});

it('accounts for all 93 selected source tables without copying old tokens, IP state or private contacts into runtime storage', () => {
  const mapped = reviewedBusinessMigrationTables();
  const dedicated = ['auth.users','private.company_customer_id_counters','private.sale_team_aa_counters','storage.buckets','storage.objects','private.mutation_requests','public.customer_onboarding_tokens','private.sale_team_search_attempts','private.sale_team_search_contacts','private.sale_team_search_disclosures'];
  const archive: SourceArchive = { version: 1, project: 'ikaevepedpqygdlipsei', capturedAt: '2026-10-31T00:00:00.000Z', schema: { tables: [], columns: [], constraints: [], indexes: [] }, files: [], tables: [...mapped.map(table => ({ name: table.source, rows: [] })), ...dedicated.map(name => ({ name, rows: [] }))] };
  expect(reviewMigrationSourceCoverage(archive)).toMatchObject({ allTablesAccountedFor: true, sourceTables: 93, nativeImportReady: false, activePrivacyOrReplayStateTransferred: false });
  archive.tables.push({ name: 'private.unknown_new_table', rows: [] });
  expect(reviewMigrationSourceCoverage(archive).allTablesAccountedFor).toBe(false);
});
