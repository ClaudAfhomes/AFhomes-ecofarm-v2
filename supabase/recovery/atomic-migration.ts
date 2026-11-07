/** Historical transaction envelopes cannot commit an owner-approved atomic batch early. */
export function atomicMigrationSql(file: string, source: string): string {
  const boundaries = source.match(/^\s*(?:begin|commit|rollback)\s*;\s*$/gim) ?? [];
  if (!boundaries.length) return source;
  if (
    file !== '20261112000001_afhomes_service_policy_status.sql' ||
    boundaries.length !== 2 ||
    !/^\s*begin\s*;/i.test(boundaries[0]!) ||
    !/^\s*commit\s*;/i.test(boundaries[1]!)
  ) {
    throw new Error('UNREVIEWED_MIGRATION_TRANSACTION_ENVELOPE: ' + file);
  }
  return source.replace(/^\s*(?:begin|commit)\s*;\s*$/gim, '');
}
