import { planMigrationMapping } from './migration-mapping.js';
import { migrationFingerprint } from './migration-fingerprint.js';

export function reconcileMigrationMapping(
  manifest: Parameters<typeof planMigrationMapping>[0],
  input: Parameters<typeof planMigrationMapping>[1],
  after: Parameters<typeof planMigrationMapping>[1]['target'],
) {
  const planned = planMigrationMapping(manifest, input);
  const issues: { table: string; row: string | null; code: string }[] = [];
  const issue = (table: string, row: string | null, code: string) =>
    issues.push({ table, row, code });
  if (!planned.ready) return { ready: false, issues: planned.issues };
  const names = new Set(
    manifest.tables.filter((table) => !table.exclude).map((table) => table.target),
  );
  for (const name of names)
    if (!Array.isArray(after[name])) issue(name, null, 'TARGET_SNAPSHOT_REQUIRED');
  for (const name of Object.keys(after))
    if (!names.has(name)) issue(name, null, 'UNREVIEWED_TARGET_COLLECTION');
  if (issues.length) return { ready: false, issues };
  const replay = planMigrationMapping(manifest, { ...input, target: after });
  if (!replay.ready) return { ready: false, issues: replay.issues };
  for (const name of names) {
    const expected = new Map(
      [...input.target[name]!, ...planned.records[name]!].map((row) => [row._id, row]),
    );
    const seen = new Set<string>();
    for (const row of after[name]!) {
      if (seen.has(row._id)) issue(name, row._id, 'DUPLICATE_TARGET_RECORD');
      seen.add(row._id);
      const original = expected.get(row._id);
      if (!original) issue(name, row._id, 'UNEXPECTED_TARGET_RECORD');
      else if (migrationFingerprint(row) !== migrationFingerprint(original))
        issue(name, row._id, 'TARGET_RECORD_CHANGED');
    }
    for (const id of expected.keys()) if (!seen.has(id)) issue(name, id, 'TARGET_RECORD_MISSING');
  }
  return { ready: issues.length === 0, issues, planDigest: planned.digest };
}
