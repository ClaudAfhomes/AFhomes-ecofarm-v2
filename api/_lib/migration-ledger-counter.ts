/** Pure int64 high-water plan; decimal strings never pass through JavaScript Number. */
export function planMigrationLedgerCounter(sourceIds: string[], targetIds: string[], existingSequence: string | null) {
  const issues: { code: string }[] = [];
  let highWater = 0n;
  for (const value of [...sourceIds, ...targetIds, ...(existingSequence === null ? [] : [existingSequence])]) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value) || value.length > 19) {
      issues.push({ code: 'INVALID_LEDGER_COUNTER_EVIDENCE' });
      continue;
    }
    const parsed = BigInt(value);
    if (parsed > 9223372036854775807n) issues.push({ code: 'LEDGER_COUNTER_OUT_OF_INT64_RANGE' });
    else if (parsed > highWater) highWater = parsed;
  }
  if (highWater === 9223372036854775807n) issues.push({ code: 'LEDGER_COUNTER_EXHAUSTED' });
  return { ready: issues.length === 0, issues, counter: issues.length ? null : { _id: 'points-ledger', seq: highWater.toString() }, nextId: issues.length ? null : (highWater + 1n).toString() };
}
