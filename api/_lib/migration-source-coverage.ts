import type { SourceArchive } from './migration-source-archive.js';
import { reviewedBusinessMigrationTables } from './migration-reviewed-manifest.js';

const dedicated: Record<string, string> = {
  'auth.users':
    'Identity eligibility, protected owner and approved explicit test-account resolution; never generic credential copy',
  'private.company_customer_id_counters': 'Dedicated nondecreasing high-water counter adapter',
  'private.sale_team_aa_counters': 'Dedicated shared IST/OST monthly high-water counter adapter',
  'storage.buckets':
    'Policy/configuration evidence only; never provision source storage policies automatically',
  'storage.objects': 'Dedicated original-byte/checksum/owner/private-metadata adapter',
};
const archived: Record<string, string> = {
  'private.mutation_requests':
    'Encrypted archive only; source replay receipts cannot authorize native mutations',
  'public.customer_onboarding_tokens':
    'Encrypted archive only; do not reactivate old activation credentials',
  'private.sale_team_search_attempts':
    'Encrypted archive only; source salted IP/cooldown state is not native authorization',
  'private.sale_team_search_contacts':
    'Encrypted archive only; do not duplicate historical contact PII into active search storage',
  'private.sale_team_search_disclosures':
    'Encrypted archive only; historical consent is not current-host privacy approval',
};

/** Every captured table must have an explicit disposition; coverage is not cutover readiness. */
export function reviewMigrationSourceCoverage(archive: SourceArchive) {
  const mapped = new Map(reviewedBusinessMigrationTables().map((table) => [table.source, table]));
  const issues: { table: string; code: string }[] = [];
  const dispositions = archive.tables.map((table) => {
    const definition = mapped.get(table.name);
    if (definition) {
      if (definition.requireEmpty && table.rows.length)
        issues.push({ table: table.name, code: 'NONEMPTY_SOURCE_REQUIRES_MAPPING_REVIEW' });
      return {
        table: table.name,
        rows: table.rows.length,
        disposition: definition.requireEmpty ? 'guarded_empty' : 'reviewed_mapping',
        target: definition.target,
      };
    }
    const reason = dedicated[table.name] ?? archived[table.name];
    if (!reason) issues.push({ table: table.name, code: 'UNACCOUNTED_SOURCE_TABLE' });
    return {
      table: table.name,
      rows: table.rows.length,
      disposition: dedicated[table.name]
        ? 'dedicated_adapter'
        : archived[table.name]
          ? 'encrypted_archive_only'
          : 'unreviewed',
      reason,
    };
  });
  for (const name of [...mapped.keys(), ...Object.keys(dedicated), ...Object.keys(archived)])
    if (!archive.tables.some((table) => table.name === name))
      issues.push({ table: name, code: 'REVIEWED_SOURCE_TABLE_MISSING' });
  return {
    allTablesAccountedFor: issues.length === 0,
    sourceTables: archive.tables.length,
    sourceRows: archive.tables.reduce((sum, table) => sum + table.rows.length, 0),
    issues,
    dispositions,
    nativeImportReady: false,
    activePrivacyOrReplayStateTransferred: false,
  };
}
