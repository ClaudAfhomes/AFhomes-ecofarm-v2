import { expect, it } from 'vitest';
import { planMigrationLedgerIds } from './migration-ledger-ids.js';

it('reserves exact monotonic IDs beyond existing history/counters and resumes identical provenance', () => {
  const source = [{ id: '1', origin_award_id: null }, { id: '2', origin_award_id: '1' }];
  const native = [{ _id: '1', amount: 12 }];
  const saved = structuredClone({ source, native });
  const plan = planMigrationLedgerIds(source, native, '9007199254740993');
  expect(plan.ready).toBe(true);
  expect(plan.aliases.map(row => row.targetId)).toEqual(['9007199254740994', '9007199254740995']);
  const imported = plan.aliases.map(alias => ({ _id: alias.targetId, migration_source_ledger_id: alias.sourceId, migration_source_ledger_checksum: alias.sourceFingerprint }));
  const replay = planMigrationLedgerIds(source, [...native, ...imported], '9007199254740993');
  expect(replay.aliases).toEqual(plan.aliases);
  expect(replay.digest).toBe(plan.digest);
  expect({ source, native }).toEqual(saved);
  expect(planMigrationLedgerIds([{ id: '1', changed: true }, source[1]!], [...native, ...imported], null).ready).toBe(false);
});

it('keeps collision-free IDs and blocks ambiguous, noncanonical and exhausted ranges', () => {
  expect(planMigrationLedgerIds([{ id: '2' }], [{ _id: '1' }], null)).toMatchObject({ ready: true, aliases: [], counter: { seq: '2' } });
  for (const ids of [['1', '1'], ['01'], ['-1'], ['9223372036854775808']]) expect(planMigrationLedgerIds(ids.map(id => ({ id })), [], null).ready).toBe(false);
  expect(planMigrationLedgerIds([{ id: '1' }], [{ _id: '1' }], '9223372036854775806').ready).toBe(false);
});
