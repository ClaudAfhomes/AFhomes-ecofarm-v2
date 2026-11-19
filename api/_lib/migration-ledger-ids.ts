import { migrationFingerprint } from './migration-fingerprint.js';
import { planMigrationLedgerCounter } from './migration-ledger-counter.js';

/** Internal ID translation only; no business identifiers, money or nested evidence are rewritten. */
export function planMigrationLedgerIds(source: Record<string, unknown>[], target: ({ _id: string } & Record<string, unknown>)[], existingSequence: string | null) {
  const issues: { code: string }[] = [];
  const sourceIds = source.map(row => row.id);
  if (!sourceIds.every((id): id is string => typeof id === 'string') || new Set(sourceIds).size !== sourceIds.length)
    return { ready: false, issues: [{ code: 'INVALID_SOURCE_LEDGER_IDS' }], aliases: [], counter: null, digest: '' };
  const highWater = planMigrationLedgerCounter(sourceIds, target.map(row => row._id), existingSequence);
  if (!highWater.ready) return { ...highWater, aliases: [], digest: '' };
  if (new Set(target.map(row => row._id)).size !== target.length) issues.push({ code: 'DUPLICATE_NATIVE_LEDGER_IDS' });
  const fingerprints = new Map(source.map(row => [String(row.id), migrationFingerprint(row)]));
  const imported = new Map<string, typeof target[number]>();
  for (const row of target) {
    if (typeof row.migration_source_ledger_id !== 'string' || !fingerprints.has(row.migration_source_ledger_id)) continue;
    const id = row.migration_source_ledger_id;
    if (row.migration_source_ledger_checksum !== fingerprints.get(id) || imported.has(id)) issues.push({ code: 'IMPORTED_LEDGER_PROVENANCE_CONFLICT' });
    else imported.set(id, row);
  }
  const importedRows = new Set(imported.values());
  const baseline = target.filter(row => !importedRows.has(row));
  const sourceIdSet = new Set(sourceIds);
  const needsTranslation = imported.size > 0 || baseline.some(row => sourceIdSet.has(row._id));
  let sequence = BigInt(highWater.counter!.seq);
  const aliases: { sourceId: string; targetId: string; sourceFingerprint: string }[] = [];
  if (needsTranslation) {
    const sorted = [...source].sort((a,b) => BigInt(String(a.id)) < BigInt(String(b.id)) ? -1 : 1);
    let previous = -1n;
    for (const row of sorted) {
      const sourceId = String(row.id), prior = imported.get(sourceId);
      const targetId = prior?._id ?? (++sequence).toString();
      const numeric = BigInt(targetId);
      if (numeric <= previous || numeric >= 9223372036854775807n) issues.push({ code: 'LEDGER_TRANSLATION_ORDER_OR_RANGE' });
      previous = numeric;
      aliases.push({ sourceId, targetId, sourceFingerprint: fingerprints.get(sourceId)! });
    }
  }
  const digest = migrationFingerprint({ source: [...source].sort((a,b) => String(a.id).localeCompare(String(b.id))), baseline: [...baseline].sort((a,b) => a._id.localeCompare(b._id)), existingSequence, aliases });
  return { ready: issues.length === 0, issues, aliases: issues.length ? [] : aliases, counter: issues.length ? null : { _id: 'points-ledger', seq: sequence.toString() }, digest };
}
