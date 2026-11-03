import type { MigrationTable } from './migration-mapping.js';

export function reviewedAuditMigrationTable(): MigrationTable {
  return {
    source: 'public.audit_events',
    target: 'audit_events',
    key: ['id'],
    columns: [
      'id',
      'actor_id',
      'action',
      'entity_type',
      'entity_id',
      'reason',
      'before_data',
      'after_data',
      'request_id',
      'ip_hash',
      'created_at',
    ],
    notNull: ['id', 'action', 'entity_type', 'created_at'],
    uuids: ['actor_id'],
    text: ['action', 'entity_type', 'entity_id', 'reason', 'request_id', 'ip_hash'],
    bigints: { id: 'identifier' },
    timestamps: ['created_at'],
    authActor: true,
  };
}
const privateKeys = new Set([
  'password',
  'encryptedpassword',
  'temporarypassword',
  'currentpassword',
  'newpassword',
  'accesstoken',
  'refreshtoken',
  'token',
  'authorization',
  'cookie',
  'mongodburi',
  'governmentidnumber',
  'governmentid',
  'idnumber',
  'documentnumber',
  'tinnumber',
  'taxid',
  'tin',
  'secret',
  'clientsecret',
  'apikey',
  'servicerolekey',
  'supabaseservicerolekey',
  'sessiontoken',
  'betterauthsecret',
]);
function containsPrivateEvidence(value: unknown, depth = 0): boolean {
  if (depth > 64) return true;
  if (typeof value === 'string')
    return /mongodb(?:\+srv)?:\/\/|\$2[aby]\$\d{2}\$|(?:access_token|refresh_token|password|token)=[^\s&]+/i.test(
      value,
    );
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, item]) =>
      (privateKeys.has(key.replace(/[^a-z0-9]/gi, '').toLowerCase()) &&
        item !== null &&
        item !== '') ||
      containsPrivateEvidence(item, depth + 1),
  );
}

export function migrationAuditIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  if (table.source !== 'public.audit_events' || table.target !== 'audit_events') return issues;
  for (const column of ['before_data', 'after_data', 'reason'])
    if (table.columns.includes(column) && containsPrivateEvidence(row[column]))
      issues.push({ column, code: 'AUDIT_PRIVATE_EVIDENCE_REQUIRES_REVIEW' });
  return issues;
}

/** Safe source aggregates only. Flagged events stay unchanged in the encrypted archive. */
export function reviewSourceAuditHistory(
  source: Record<string, Record<string, unknown>[]>,
  identities: { id: string; email: string }[],
) {
  const events = source['public.audit_events'],
    issues: { row: number; code: string }[] = [];
  if (!events)
    return { ready: false, issues: [{ row: -1, code: 'AUDIT_SOURCE_TABLE_REQUIRED' }], events: 0 };
  for (const [index, row] of events.entries()) {
    if (
      row.actor_id != null &&
      identities.filter((identity) => identity.id === row.actor_id).length !== 1
    )
      issues.push({ row: index, code: 'AUDIT_SOURCE_ACTOR_MISSING' });
    for (const issue of migrationAuditIssues(reviewedAuditMigrationTable(), row))
      issues.push({ row: index, code: issue.code });
  }
  return { ready: issues.length === 0, issues, events: events.length, payloadsRewritten: false };
}
