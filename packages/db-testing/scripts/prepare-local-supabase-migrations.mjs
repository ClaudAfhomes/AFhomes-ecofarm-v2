import assert from 'node:assert/strict';
import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const repairs = new Map([
  ['20261130000001', {
    originals: ['20261130000001_afhomes_membership_company_fields.sql', '20261130000001_afhomes_sale_team_accreditation.sql'],
    repair: '20261130000003_afhomes_reconcile_membership_sale_team.sql',
  }],
  ['20261206000003', {
    originals: ['20261206000003_afhomes_company_customer_workbook.sql', '20261206000003_afhomes_network_members_link_reconcile.sql'],
    repair: '20261206000006_afhomes_reconcile_workbook_network_version.sql',
  }],
  ['20261215000001', {
    originals: ['20261215000001_afhomes_company_customer_id_format.sql', '20261215000001_afhomes_search_path_canonical.sql'],
    repair: '20261215000002_afhomes_reconcile_customer_id_search_path.sql',
  }],
]);

// Match the repository's version-keyed runner; forward repairs restore either skipped feature.
export function localMigrationManifest(files) {
  const groups = new Map();
  for (const file of [...files].sort()) {
    assert.match(file, /^\d{14}_afhomes_.*\.sql$/);
    const version = file.split('_')[0];
    groups.set(version, [...(groups.get(version) ?? []), file]);
  }
  for (const [version, group] of groups) {
    if (group.length === 1) continue;
    const recovery = repairs.get(version);
    assert(recovery, `Unreconciled duplicate migration version: ${version}`);
    assert.deepEqual(group, recovery.originals, `Unexpected files for historical version ${version}`);
    assert(files.includes(recovery.repair), `Missing forward repair: ${recovery.repair}`);
  }
  return [...groups.values()].map(group => group[0]);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const destination = path.resolve(root, process.argv[2] ?? '.tmp-bin/local-supabase');
  const relative = path.relative(path.resolve(root, '.tmp-bin'), destination);
  assert(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Destination must be a dedicated project under .tmp-bin');
  const source = path.join(root, 'supabase/migrations');
  const files = readdirSync(source).filter(file => file.endsWith('.sql'));
  const selected = localMigrationManifest(files);
  const target = path.join(destination, 'supabase/migrations');
  mkdirSync(target, { recursive: true });
  assert(readdirSync(target).every(file => selected.includes(file)), 'Destination has unexpected migrations; use a fresh dedicated directory');
  for (const file of selected) {
    const bytes = readFileSync(path.join(source, file));
    const output = path.join(target, file);
    if (existsSync(output)) assert(readFileSync(output).equals(bytes), `Existing local migration differs: ${file}`);
    else writeFileSync(output, bytes);
  }
  console.log(`Prepared ${selected.length} unique-version local migrations from ${files.length} source files in ${target}`);
}
