export type MigrationIdentitySnapshots = {
  source: { id: string; email: string }[];
  target: { id: string; email: string }[];
  approvedAliases?: {
    sourceId: string;
    targetId: string;
    email: string;
    reason: 'owner-approved-test-account';
  }[];
};

export const approvedMigrationIdentityId = (
  id: string,
  owner: { sourceId: string; targetId: string },
  snapshots?: MigrationIdentitySnapshots,
) =>
  id === owner.sourceId
    ? owner.targetId
    : ((Array.isArray(snapshots?.approvedAliases)
        ? snapshots.approvedAliases.find((alias) => alias?.sourceId === id)?.targetId
        : undefined) ?? id);

export function auditStaffIdentityReferences(
  staff: Record<string, unknown>[],
  owner: { sourceId: string; targetId: string },
  snapshots?: MigrationIdentitySnapshots,
): { table: string; row: string | null; code: string }[] {
  const issues: { table: string; row: string | null; code: string }[] = [];
  const issue = (code: string, row: string | null = null) =>
    issues.push({ table: 'public.staff_users', row, code });
  if (!snapshots || !Array.isArray(snapshots.source) || !Array.isArray(snapshots.target)) {
    issue('IDENTITY_SNAPSHOTS_REQUIRED');
    return issues;
  }
  const normalizedEmail = (value: unknown) =>
    typeof value === 'string' ? value.trim().toLowerCase() : '';
  const indexes = { source: new Map<string, string>(), target: new Map<string, string>() };
  const targetEmails = new Map<string, string>();
  for (const side of ['source', 'target'] as const) {
    const emails = new Set<string>();
    for (const header of snapshots[side]) {
      if (
        !header ||
        typeof header !== 'object' ||
        Array.isArray(header) ||
        Object.keys(header).some((key) => key !== 'id' && key !== 'email') ||
        typeof header.id !== 'string' ||
        !header.id.trim() ||
        !normalizedEmail(header.email)
      ) {
        issue('INVALID_IDENTITY_SNAPSHOT');
        continue;
      }
      const email = normalizedEmail(header.email);
      if (indexes[side].has(header.id) || emails.has(email)) issue('AMBIGUOUS_IDENTITY_SNAPSHOT');
      indexes[side].set(header.id, email);
      emails.add(email);
      if (side === 'target') targetEmails.set(email, header.id);
    }
  }
  const approved = snapshots.approvedAliases ?? [];
  const reviewedEmails = new Set(['john@gmail.com', 'bartolo@gmail.com', 'paulo@gmail.com']);
  const aliasSources = new Set<string>(),
    aliasTargets = new Set<string>();
  if (!Array.isArray(approved) || approved.length > 3) {
    issue('INVALID_APPROVED_TEST_ALIASES');
    return issues;
  }
  for (const alias of approved) {
    if (!alias) {
      issue('INVALID_APPROVED_TEST_ALIASES');
      continue;
    }
    if (
      Object.keys(alias).some(
        (key) => !['sourceId', 'targetId', 'email', 'reason'].includes(key),
      ) ||
      alias.reason !== 'owner-approved-test-account' ||
      ![alias.sourceId, alias.targetId].every(
        (value) =>
          typeof value === 'string' &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value),
      ) ||
      !reviewedEmails.has(alias.email) ||
      indexes.source.get(alias.sourceId) !== alias.email ||
      indexes.target.get(alias.targetId) !== alias.email ||
      alias.sourceId === alias.targetId ||
      alias.sourceId === owner.sourceId ||
      alias.targetId === owner.targetId ||
      aliasSources.has(alias.sourceId) ||
      aliasTargets.has(alias.targetId)
    )
      issue('INVALID_APPROVED_TEST_ALIASES');
    aliasSources.add(alias.sourceId);
    aliasTargets.add(alias.targetId);
  }
  for (const row of staff) {
    if (typeof row.id !== 'string' || !row.id.trim() || !normalizedEmail(row.email)) {
      issue('INVALID_STAFF_IDENTITY');
      continue;
    }
    const email = normalizedEmail(row.email);
    const targetId = approvedMigrationIdentityId(row.id, owner, snapshots);
    for (const side of ['source', 'target'] as const) {
      const id = side === 'source' ? row.id : targetId;
      if (!indexes[side].has(id)) issue(`${side.toUpperCase()}_IDENTITY_MISSING`, row.id);
      else if (indexes[side].get(id) !== email)
        issue(`${side.toUpperCase()}_IDENTITY_EMAIL_MISMATCH`, row.id);
    }
    if (targetEmails.has(email) && targetEmails.get(email) !== targetId)
      issue('TARGET_IDENTITY_EMAIL_COLLISION', row.id);
  }
  return issues;
}
