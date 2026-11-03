import type { MigrationTable } from './migration-mapping.js';
import { reviewedLegacyOstMigrationTables } from './migration-legacy-ost-tables.js';
export { reviewedLegacyOstMigrationTables } from './migration-legacy-ost-tables.js';

const definitions = new Map(
  reviewedLegacyOstMigrationTables().map((table) => [table.source, table]),
);
const object = (value: unknown) =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = (value: unknown) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export function migrationLegacyOstIssues(table: MigrationTable, row: Record<string, unknown>) {
  const issues: { column: string; code: string }[] = [];
  if (definitions.get(table.source)?.target !== table.target || table.requireEmpty) return issues;
  const fail = (column: string) => {
    if (table.columns.includes(column)) issues.push({ column, code: 'INVALID_LEGACY_OST_HISTORY' });
  };
  if (table.source === 'public.referral_codes') {
    if (!Number.isInteger(row.max_uses) || Number(row.max_uses) < 1 || Number(row.max_uses) > 1000)
      fail('max_uses');
    if (
      !Number.isInteger(row.use_count) ||
      Number(row.use_count) < 0 ||
      Number(row.use_count) > Number(row.max_uses)
    )
      fail('use_count');
    if (!hash(row.code_hash)) fail('code_hash');
  }
  if (table.source === 'public.ost_applications') {
    for (const column of ['address', 'registration_details'])
      if (row[column] !== null && !object(row[column])) fail(column);
    if (
      ![
        'submitted',
        'under_review',
        'changes_requested',
        'approved',
        'rejected',
        'withdrawn',
      ].includes(String(row.status))
    )
      fail('status');
  }
  if (table.source === 'public.ost_members') {
    if (typeof row.email !== 'string' || row.email !== row.email.trim().toLowerCase())
      fail('email');
    if (row.application_id == null && row.conversion_id == null) fail('application_id');
    if (!['active', 'inactive', 'suspended'].includes(String(row.status))) fail('status');
  }
  if (table.source === 'private.ost_registration_details') {
    if (!hash(row.payload_hash)) fail('payload_hash');
    for (const column of ['official_details', 'referrer_snapshot'])
      if (!object(row[column])) fail(column);
    for (const column of ['applicant_signature_status', 'referrer_signature_status'])
      if (!['pending', 'received'].includes(String(row[column]))) fail(column);
    if (!['vip_holder', 'non_vip', 'future_vip'].includes(String(row.program_category)))
      fail('program_category');
    if (
      row.vip_card_type !== null &&
      !['BRONZE', 'SILVER', 'GOLD'].includes(String(row.vip_card_type))
    )
      fail('vip_card_type');
    if (!['public', 'manual', 'import'].includes(String(row.source))) fail('source');
    if ((row.endorsed_by == null) !== (row.endorsed_at == null)) fail('endorsed_by');
  }
  if (table.source === 'private.ost_accreditation_terms') {
    if (!['active', 'superseded', 'revoked'].includes(String(row.status))) fail('status');
    if (
      ['application_id', 'renewal_id', 'conversion_id'].filter((column) => row[column] != null)
        .length !== 1
    )
      fail('application_id');
    if (
      typeof row.starts_on !== 'string' ||
      typeof row.expires_on !== 'string' ||
      row.expires_on < row.starts_on
    )
      fail('expires_on');
  }
  return issues;
}

/** Source consistency only: no current ancestry, accreditation dates or auth identities are invented. */
export function reconcileSourceLegacyOst(
  source: Record<string, Record<string, unknown>[]>,
  identities: { id: string; email: string }[],
) {
  const issues: { table: string; code: string }[] = [];
  for (const table of definitions.values()) {
    if (!source[table.source]) {
      issues.push({ table: table.source, code: 'MISSING_OST_TABLE' });
      continue;
    }
    if (table.requireEmpty && source[table.source]!.length)
      issues.push({ table: table.source, code: 'NONEMPTY_SOURCE_REQUIRES_MAPPING_REVIEW' });
    for (const row of source[table.source]!)
      for (const issue of migrationLegacyOstIssues(table, row))
        issues.push({ table: table.source, code: issue.code });
  }
  const applications = source['public.ost_applications'] ?? [],
    members = source['public.ost_members'] ?? [];
  for (const member of members) {
    const staff = source['public.staff_users']?.find((row) => row.id === member.id);
    const auth = identities.filter((row) => row.id === member.id);
    if (
      !staff ||
      staff.email !== member.email ||
      auth.length !== 1 ||
      auth[0]!.email !== member.email
    )
      issues.push({ table: 'public.ost_members', code: 'OST_IDENTITY_MISMATCH' });
  }
  for (const table of definitions.values())
    for (const row of source[table.source] ?? [])
      for (const [column, parent] of Object.entries(table.references ?? {}))
        if (
          row[column] != null &&
          !source[parent]?.some((candidate) => candidate.id === row[column])
        )
          issues.push({ table: table.source, code: 'MISSING_OST_SOURCE_REFERENCE' });
  for (const term of source['private.ost_accreditation_terms'] ?? []) {
    const member = members.find((row) => row.id === term.ost_id);
    if (term.application_id != null && member?.application_id !== term.application_id)
      issues.push({
        table: 'private.ost_accreditation_terms',
        code: 'OST_TERM_APPLICATION_MISMATCH',
      });
  }
  return {
    ready: issues.length === 0,
    issues,
    applications: applications.length,
    members: members.length,
    publicRegistrationEnabled: false,
    referralCapabilitiesMigrated: false,
  };
}
