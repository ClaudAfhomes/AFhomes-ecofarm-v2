import { isExactDecimal } from '@afhomes/shared';
import { migrationFingerprint } from './migration-fingerprint.js';
import { planMigrationLedgerIds } from './migration-ledger-ids.js';
import {
  auditStaffIdentityReferences,
  approvedMigrationIdentityId,
  type MigrationIdentitySnapshots,
} from './migration-identity-references.js';
import { migrationNetworkIssues } from './migration-network-manifest.js';
import { migrationCustomerIssues } from './migration-customer-manifest.js';
import { migrationPointsIssues } from './migration-points-manifest.js';
import { migrationFinanceIssues } from './migration-finance-manifest.js';
import { migrationFormsIssues } from './migration-forms-manifest.js';
import { migrationImportIssues } from './migration-imports.js';
import { migrationLegacyOstIssues } from './migration-legacy-ost.js';
import { migrationDocumentIssues } from './migration-documents.js';
import { migrationAuditIssues } from './migration-audit.js';
import { migrationRulePolicyIssues, rulesPolicyMappingIssues, commissionRuleTargetColumn, commissionRuleOverlaps } from './migration-rules-policy.js';
import { migrationIdentifierIssues } from './migration-identifiers.js';

type SourceRow = Record<string, unknown>;
export type MigrationRecord = SourceRow & { _id: string };
export type MigrationTable = {
  source: string;
  target: string;
  key: string[];
  columns: string[];
  references?: Record<string, string>;
  requiredReferences?: string[];
  money?: string[];
  bigints?: Record<string, 'identifier' | 'safe_integer'>;
  renames?: Record<string, string>;
  timestamps?: string[];
  dates?: string[];
  notNull?: string[];
  booleans?: string[];
  stringArrays?: string[];
  uuids?: string[];
  text?: string[];
  int32?: string[];
  authIdentity?: true;
  customerIdentity?: true;
  authActor?: true;
  unique?: string[][];
  partialUnique?: { columns: string[]; when: Record<string, boolean | string | string[]> }[];
  referenceMatch?: string[];
  ownerField?: string;
  exclude?: string;
  requireEmpty?: true;
};
export type MigrationManifest = {
  version: 1;
  timestampPrecision?: 'preserve-source';
  protectedOwner: { table: string; sourceId: string; targetId: string };
  tables: MigrationTable[];
};
export type MigrationReferenceReuse = {
  table: string;
  sourceId: string;
  targetId: string;
  sourceFingerprint: string;
  targetFingerprint: string;
};
export const migrationReferenceMetadataColumns: Record<string, readonly string[]> = {
  'public.departments': ['name', 'created_at', 'updated_at'],
  'public.modules': ['name', 'group_name', 'sort_order'],
  'public.roles': ['name', 'created_at', 'updated_at'],
  'public.card_categories': ['name', 'sort_order'],
  'public.card_plans': ['created_at', 'updated_at'],
  'public.tier_points_config': ['updated_at', 'updated_by'],
};
type Issue = { table: string; row: string | null; column?: string; code: string };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const stable = (value: unknown) => migrationFingerprint(value);
const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);
const email = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const isUUID = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
function plainJSON(value: unknown, ancestors = new Set<object>(), allowNativeDates = false): boolean {
  if (allowNativeDates && value instanceof Date) return Number.isFinite(value.valueOf());
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number')
    return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (
    typeof value !== 'object' ||
    ancestors.has(value) ||
    (!Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null)
  )
    return false;
  ancestors.add(value);
  const result = Object.values(value).every((item) => plainJSON(item, ancestors, allowNativeDates));
  ancestors.delete(value);
  return result;
}
const uniqueSame = (column: string, a: unknown, b: unknown) =>
  ['email', 'ra_number'].includes(column) && typeof a === 'string' && typeof b === 'string'
    ? email(a) === email(b)
    : same(a, b);
const matchesPredicate = (value: unknown, expected: boolean | string | string[]) =>
  Array.isArray(expected) ? typeof value === 'string' && expected.includes(value) : value === expected;
const rowKey = (table: MigrationTable, row: SourceRow) =>
  table.key.length === 1 && table.key[0] === 'id'
    ? typeof row.id === 'string' && row.id
      ? row.id
      : ''
    : table.key.every((k) => row[k] != null)
      ? `migration-${stable([table.source, table.key.map((k) => row[k])])}`
      : '';
const targetColumn = (table: MigrationTable, column: string) => table.renames?.[column] ?? column;
export { rowKey as migrationSourceRowKey };
const grantFlags = ['can_view', 'can_create', 'can_update', 'can_delete'];
const denyFlags = ['deny_view', 'deny_create', 'deny_update', 'deny_delete'];
const accessFlags = (table: MigrationTable) =>
  table.source === 'public.role_permissions' || table.target === 'role_permissions'
    ? grantFlags
    : table.source === 'public.staff_permission_restrictions' ||
        table.target === 'staff_permission_restrictions'
      ? denyFlags
      : [];
const referenceCodes: Record<string, { column: string; pattern: RegExp }> = {
  'public.roles': { column: 'slug', pattern: /^[a-z][a-z0-9_]{1,63}$/ },
  'public.modules': { column: 'key', pattern: /^[a-z][a-z0-9_.]{2,79}$/ },
  'public.departments': { column: 'code', pattern: /^[A-Z][A-Z0-9_]{1,31}$/ },
  'public.card_categories': { column: 'slug', pattern: /^[a-z][a-z0-9-]{1,63}$/ },
};

export function migrationTimestamp(value: unknown, precision?: 'preserve-source'): { value: string } | { error: string } {
  const parts =
    typeof value === 'string'
      ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(
          value,
        )
      : null;
  if (!parts || parts[1]!.startsWith('0000-')) return { error: 'INVALID_TIMESTAMP' };
  const fraction = parts[3] ?? '';
  // Native timestamps use milliseconds; never silently discard source microseconds.
  if (precision !== 'preserve-source' && /[1-9]/.test(fraction.slice(3))) return { error: 'TIMESTAMP_PRECISION_LOSS' };
  const utc = `${parts[1]}T${parts[2]}.${fraction.slice(0, 3).padEnd(3, '0')}Z`;
  const wall = new Date(utc);
  const hours = Number(parts[6] ?? 0),
    minutes = Number(parts[7] ?? 0);
  if (!Number.isFinite(wall.getTime()) || wall.toISOString() !== utc || hours > 23 || minutes > 59)
    return { error: 'INVALID_TIMESTAMP' };
  const offset = (hours * 60 + minutes) * (parts[5] === '-' ? -1 : 1);
  const instant = new Date(wall.getTime() - offset * 60000);
  if (instant.getUTCFullYear() < 1 || instant.getUTCFullYear() > 9999)
    return { error: 'INVALID_TIMESTAMP' };
  return { value: instant.toISOString() };
}

/** Pure business-data dry-run planner. No DB, filesystem, credentials, import execution or auth conversion. */
export function planMigrationMapping(
  manifest: MigrationManifest,
  input: {
    source: Record<string, SourceRow[]>;
    target: Record<string, MigrationRecord[]>;
    identities?: MigrationIdentitySnapshots;
    referenceReuse?: MigrationReferenceReuse[];
    ledgerIdPlan?: { existingSequence: string | null; digest: string };
  },
) {
  const issues: Issue[] = [],
    excluded: { table: string; row: string; reason: string }[] = [];
  const records: Record<string, MigrationRecord[]> = {};
  const referenceEvidence: MigrationRecord[] = [];
  const reusableReferenceTables = new Set(['public.departments', 'public.modules', 'public.roles', 'public.card_categories', 'public.card_plans', 'public.tier_points_config']);
  const referenceReuse = input.referenceReuse ?? [];
  if (input.referenceReuse !== undefined && !Array.isArray(input.referenceReuse)) issues.push({ table: '_input', row: null, code: 'INVALID_REFERENCE_REUSE_PLAN' });
  const usedReferenceReuse = new Set<MigrationReferenceReuse>();
  if (!Array.isArray(referenceReuse) || referenceReuse.some(item => !item || Object.keys(item).length !== 5 || !['table', 'sourceId', 'targetId', 'sourceFingerprint', 'targetFingerprint'].every(key => Object.hasOwn(item, key)) || !reusableReferenceTables.has(item.table) || typeof item.sourceId !== 'string' || typeof item.targetId !== 'string' || !/^[a-f0-9]{64}$/.test(item.sourceFingerprint) || !/^[a-f0-9]{64}$/.test(item.targetFingerprint)) || new Set(Array.isArray(referenceReuse) ? referenceReuse.map(item => `${item?.table}:${item?.sourceId}`) : []).size !== referenceReuse.length)
    issues.push({ table: '_input', row: null, code: 'INVALID_REFERENCE_REUSE_PLAN' });
  const checksums: { table: string; row: string; checksum: string }[] = [];
  const tables = new Map<string, MigrationTable>(),
    aliases = new Map<string, Map<string, string>>();
  const issue = (table: string, row: string | null, code: string, column?: string) =>
    issues.push({ table, row, code, ...(column ? { column } : {}) });
  if (manifest.version !== 1) issue('_manifest', null, 'UNSUPPORTED_VERSION');
  if (input.identities?.approvedAliases !== undefined && !Array.isArray(input.identities.approvedAliases)) issue('_input', null, 'INVALID_APPROVED_TEST_ALIASES');
  if (manifest.timestampPrecision !== undefined && manifest.timestampPrecision !== 'preserve-source')
    issue('_manifest', null, 'INVALID_TIMESTAMP_POLICY');
  if (!plainJSON(input, new Set(), true) || !plainJSON(input.source) || !plainJSON(input.identities ?? null)) issue('_input', null, 'CANONICAL_JSON_REQUIRED');
  const targets = new Set<string>();
  for (const table of manifest.tables) {
    if (table.requireEmpty && (input.source[table.source]?.length ?? 0) > 0)
      issue(table.source, null, 'NONEMPTY_SOURCE_REQUIRES_MAPPING_REVIEW');
    if (
      tables.has(table.source) ||
      !/^(public|private|auth|storage)\.[a-z][a-z0-9_]*$/.test(table.source)
    )
      issue(table.source, null, 'INVALID_TABLE_MAPPING');
    tables.set(table.source, table);
    aliases.set(table.source, new Map());
    if (table.exclude) continue;
    for (const code of rulesPolicyMappingIssues(table)) issue(table.source, null, code);
    if (table.source === 'public.redemption_items' && table.target !== 'migration_source_redemption_items') issue(table.source, null, 'DISABLED_CATALOG_REQUIRES_HISTORY_TARGET');
    if (table.source === 'public.audit_events' && table.columns.includes('actor_id') && !table.authActor)
      issue(table.source, null, 'AUDIT_AUTH_ACTOR_REQUIRED');
    if (table.authActor) {
      if (table.source !== 'public.audit_events' || table.target !== 'audit_events' || table.key.length !== 1 || table.key[0] !== 'id' || table.bigints?.id !== 'identifier' || !table.uuids?.includes('actor_id') || table.references?.actor_id)
        issue(table.source, null, 'INVALID_AUDIT_ACTOR_MAPPING');
      const actors = [...new Set((input.source[table.source] ?? []).map(row => row.actor_id).filter(id => id != null))];
      for (const actor of actors) {
        const header = Array.isArray(input.identities?.source) ? input.identities.source.filter(row => row?.id === actor) : undefined;
        if (header?.length !== 1) { issue(table.source, null, 'AUDIT_SOURCE_ACTOR_MISSING'); continue; }
        issues.push(...auditStaffIdentityReferences([{ id: actor, email: header[0]!.email }], manifest.protectedOwner, input.identities).map(problem => ({ ...problem, table: table.source })));
      }
    }
    if (table.source === 'public.ost_members' && table.columns.includes('email')) {
      if (table.target !== 'ost_members' || table.references?.id !== 'public.staff_users' || table.key.length !== 1 || table.key[0] !== 'id' || table.ownerField !== 'id' || !table.uuids?.includes('id') || !manifest.tables.some(parent => parent.source === 'public.staff_users' && parent.authIdentity))
        issue(table.source, null, 'OST_AUTH_IDENTITY_REFERENCE_REQUIRED');
      const members = input.source[table.source] ?? [];
      for (const member of members)
        if (!input.source['public.staff_users']?.some(staff => staff.id === member.id && staff.email === member.email))
          issue(table.source, typeof member.id === 'string' ? member.id : null, 'OST_STAFF_IDENTITY_MISMATCH');
      issues.push(...auditStaffIdentityReferences(members, manifest.protectedOwner, input.identities).map(problem => ({ ...problem, table: table.source })));
    }
    if (
      table.source === 'public.staff_users' &&
      table.columns.includes('must_change_password') &&
      !table.authIdentity
    )
      issue(table.source, null, 'AUTH_IDENTITY_REFERENCE_REQUIRED');
    if (table.authIdentity) {
      if (
        table.source !== 'public.staff_users' ||
        table.target !== 'staff_users' ||
        table.key.length !== 1 ||
        table.key[0] !== 'id' ||
        table.ownerField !== 'id' ||
        !table.uuids?.includes('id') ||
        !table.columns.includes('email')
      )
        issue(table.source, null, 'INVALID_AUTH_IDENTITY_MAPPING');
      issues.push(
        ...auditStaffIdentityReferences(
          input.source[table.source] ?? [],
          manifest.protectedOwner,
          input.identities,
        ),
      );
    }
    if (
      table.source === 'public.customers' &&
      table.columns.includes('auth_user_id') &&
      !table.customerIdentity
    )
      issue(table.source, null, 'CUSTOMER_IDENTITY_REFERENCE_REQUIRED');
    if (table.customerIdentity) {
      if (
        table.source !== 'public.customers' ||
        table.target !== 'customers' ||
        table.key.length !== 1 ||
        table.key[0] !== 'id' ||
        !['id', 'auth_user_id'].every((column) => table.uuids?.includes(column)) ||
        !table.columns.includes('email') ||
        table.references?.auth_user_id
      )
        issue(table.source, null, 'INVALID_CUSTOMER_IDENTITY_MAPPING');
      const linked = (input.source[table.source] ?? []).filter((row) => row.auth_user_id != null);
      for (const row of linked)
        if (row.auth_user_id === manifest.protectedOwner.sourceId)
          issue(
            table.source,
            typeof row.id === 'string' ? row.id : null,
            'OWNER_CUSTOMER_LINK_REQUIRES_REVIEW',
          );
      if (linked.length)
        for (const problem of auditStaffIdentityReferences(
          linked.map((row) => ({ id: row.auth_user_id, email: row.email })),
          manifest.protectedOwner,
          input.identities,
        )) {
          const related = linked.find((row) => row.auth_user_id === problem.row);
          issue(table.source, typeof related?.id === 'string' ? related.id : null, problem.code);
        }
    }
    if (
      /^(auth|storage)\./.test(table.source) ||
      table.target.startsWith('auth_') ||
      ['mutation_requests', 'customer_onboarding_tokens', 'private_upload_grants'].includes(
        table.target,
      ) ||
      table.columns.some((k) =>
        ['password', 'encrypted_password', 'secret', 'refresh_token'].includes(k),
      )
    )
      issue(table.source, null, 'AUTH_MAPPING_NOT_APPROVED');
    if (
      !/^[a-z][a-z0-9_]*$/.test(table.target) ||
      forbidden.has(table.target) ||
      targets.has(table.target)
    )
      issue(table.source, null, 'INVALID_TARGET');
    targets.add(table.target);
    records[table.target] = [];
    const existingIds = new Set<string>();
    for (const row of input.target[table.target] ?? []) {
      if (typeof row._id !== 'string' || !row._id || existingIds.has(row._id))
        issue(table.source, null, 'INVALID_TARGET_KEY');
      existingIds.add(row._id);
    }
    if (
      !table.key.length ||
      table.key.some((k) => !table.columns.includes(k)) ||
      new Set(table.columns).size !== table.columns.length ||
      table.columns.some((k) => forbidden.has(k) || k === '_id' || k === 'migration_source_timestamps')
    )
      issue(table.source, null, 'INVALID_COLUMN_MANIFEST');
    if (
      table.target === 'staff_users' &&
      (table.ownerField !== 'id' || table.source !== manifest.protectedOwner.table)
    )
      issue(table.source, null, 'OWNER_PROTECTION_RULE_REQUIRED');
    if (
      [
        'staff_role_assignments',
        'staff_permission_restrictions',
        'ist_profiles',
        'network_member_profiles',
      ].includes(table.target) &&
      (table.ownerField !== 'staff_id' ||
        table.references?.staff_id !== manifest.protectedOwner.table)
    )
      issue(table.source, null, 'OWNER_PROTECTION_RULE_REQUIRED');
    if (table.requiredReferences?.some((k) => !table.references?.[k]))
      issue(table.source, null, 'INVALID_REQUIRED_REFERENCE');
    for (const rule of table.partialUnique ?? [])
      if (
        !rule.columns.length ||
        !Object.keys(rule.when).length ||
        Object.entries(rule.when).some(
          ([column, value]) => !(typeof value === 'boolean' && table.booleans?.includes(column)) &&
            !(typeof value === 'string' && table.text?.includes(column)) &&
            !(Array.isArray(value) && value.length > 0 && new Set(value).size === value.length && value.every((item) => typeof item === 'string') && table.text?.includes(column)),
        )
      )
        issue(table.source, null, 'INVALID_PARTIAL_UNIQUE_MAPPING');
    for (const [column, destination] of Object.entries(table.renames ?? {}))
      if (
        !table.columns.includes(column) ||
        column === 'id' ||
        column === table.ownerField ||
        !/^[a-z][a-z0-9_]*$/.test(destination) ||
        forbidden.has(destination) ||
        ['_id', 'id', 'password', 'encrypted_password', 'secret', 'refresh_token', 'migration_source_timestamps'].includes(
          destination,
        )
      )
        issue(table.source, null, 'INVALID_RENAME_MAPPING', column);
    const outputColumns = table.columns
      .filter((k) => k !== 'id')
      .map((k) => targetColumn(table, k));
    if (new Set(outputColumns).size !== outputColumns.length)
      issue(table.source, null, 'INVALID_RENAME_MAPPING');
    for (const column of table.timestamps ?? [])
      if (
        table.bigints?.[column] ||
        table.money?.includes(column) ||
        table.references?.[column] ||
        table.key.includes(column) ||
        table.ownerField === column
      )
        issue(table.source, null, 'INVALID_TIMESTAMP_MAPPING', column);
    for (const column of table.dates ?? [])
      if (
        table.timestamps?.includes(column) ||
        table.bigints?.[column] ||
        table.money?.includes(column) ||
        table.references?.[column] ||
        table.ownerField === column
      )
        issue(table.source, null, 'INVALID_DATE_MAPPING', column);
    for (const [column, kind] of Object.entries(table.bigints ?? {}))
      if (
        !['identifier', 'safe_integer'].includes(kind) ||
        table.money?.includes(column) ||
        (kind === 'safe_integer' &&
          (table.key.includes(column) || table.references?.[column] || table.ownerField === column))
      )
        issue(table.source, null, 'INVALID_BIGINT_MAPPING', column);
    for (const column of table.booleans ?? [])
      if (
        table.timestamps?.includes(column) ||
        table.dates?.includes(column) ||
        table.bigints?.[column] ||
        table.money?.includes(column) ||
        table.references?.[column] ||
        table.ownerField === column
      )
        issue(table.source, null, 'INVALID_BOOLEAN_MAPPING', column);
    if (
      accessFlags(table).some(
        (column) =>
          !table.columns.includes(column) ||
          !table.booleans?.includes(column) ||
          !table.notNull?.includes(column) ||
          targetColumn(table, column) !== column,
      )
    )
      issue(table.source, null, 'ACCESS_CONSTRAINT_DECLARATION_REQUIRED');
    for (const column of table.uuids ?? [])
      if (
        table.timestamps?.includes(column) ||
        table.dates?.includes(column) ||
        table.bigints?.[column] ||
        table.money?.includes(column) ||
        table.booleans?.includes(column)
      )
        issue(table.source, null, 'INVALID_UUID_MAPPING', column);
    for (const column of [...(table.text ?? []), ...(table.int32 ?? []), ...(table.stringArrays ?? [])]) {
      const declarations = [
        table.text,
        table.int32,
        table.timestamps,
        table.dates,
        table.booleans,
        table.uuids,
        table.money,
        table.stringArrays,
        Object.keys(table.bigints ?? {}),
      ];
      if (
        declarations.filter((columns) => columns?.includes(column)).length > 1 ||
        (table.int32?.includes(column) &&
          (table.references?.[column] || table.ownerField === column))
      )
        issue(table.source, null, 'INVALID_SCALAR_MAPPING', column);
      if(table.stringArrays?.includes(column)&&(table.key.includes(column)||table.references?.[column]||table.ownerField===column))
        issue(table.source,null,'INVALID_STRING_ARRAY_MAPPING',column);
    }
    for (const column of [
      ...Object.keys(table.references ?? {}),
      ...Object.keys(table.bigints ?? {}),
      ...(table.timestamps ?? []),
      ...(table.dates ?? []),
      ...(table.notNull ?? []),
      ...(table.booleans ?? []),
      ...(table.stringArrays ?? []),
      ...(table.uuids ?? []),
      ...(table.text ?? []),
      ...(table.int32 ?? []),
      ...(table.money ?? []),
      ...(table.referenceMatch ?? []),
      ...(table.requiredReferences ?? []),
      ...(table.unique ?? []).flat(),
      ...(table.partialUnique ?? []).flatMap((rule) => [
        ...rule.columns,
        ...Object.keys(rule.when),
      ]),
      ...(table.ownerField ? [table.ownerField] : []),
    ])
      if (!table.columns.includes(column))
        issue(table.source, null, 'UNDECLARED_MANIFEST_COLUMN', column);
    if (!Object.hasOwn(input.source, table.source))
      issue(table.source, null, 'MISSING_SOURCE_TABLE');
    if (!Object.hasOwn(input.target, table.target))
      issue(table.source, null, 'MISSING_TARGET_TABLE');
  }
  for (const source of Object.keys(input.source).sort())
    if (!tables.has(source)) issue(source, null, 'UNKNOWN_SOURCE_TABLE');
  for (const table of manifest.tables) {
    if (table.requireEmpty && !(input.source[table.source]?.length)) continue;
    for (const parent of Object.values(table.references ?? {}))
      if (
        !tables.has(parent) ||
        tables.get(parent)!.exclude ||
        tables.get(parent)!.key.length !== 1 ||
        tables.get(parent)!.key[0] !== 'id'
      )
        issue(table.source, null, 'UNREVIEWED_REFERENCE_TABLE');
  }
  const owner = manifest.protectedOwner,
    ownerTable = tables.get(owner.table);
  const ledgerProposal = input.ledgerIdPlan;
  let ledgerIds: ReturnType<typeof planMigrationLedgerIds> | undefined;
  if (ledgerProposal !== undefined) {
    const table = tables.get('public.points_ledger');
    if (!ledgerProposal || Object.keys(ledgerProposal).length !== 2 || !Object.hasOwn(ledgerProposal, 'existingSequence') || !Object.hasOwn(ledgerProposal, 'digest') || !/^[a-f0-9]{64}$/.test(ledgerProposal.digest) || (ledgerProposal.existingSequence !== null && typeof ledgerProposal.existingSequence !== 'string') || table?.target !== 'points_ledger' || table.key.join() !== 'id' || table.bigints?.id !== 'identifier') issue('_input', null, 'INVALID_LEDGER_ID_PLAN');
    else {
      ledgerIds = planMigrationLedgerIds(input.source['public.points_ledger'] ?? [], input.target.points_ledger ?? [], ledgerProposal.existingSequence);
      if (!ledgerIds.ready || ledgerIds.digest !== ledgerProposal.digest) issue('public.points_ledger', null, 'STALE_OR_INVALID_LEDGER_ID_PLAN');
    }
  }
  const sourceOwner = input.source[owner.table]?.find((row) => row.id === owner.sourceId);
  const targetOwner =
    ownerTable && input.target[ownerTable.target]?.find((row) => row._id === owner.targetId);
  if (
    !sourceOwner ||
    !targetOwner ||
    ownerTable?.target !== 'staff_users' ||
    !email(sourceOwner.email) ||
    email(sourceOwner.email) !== email(targetOwner.email)
  )
    issue(owner.table, null, 'OWNER_IDENTITY_MISMATCH');
  if (ownerTable?.uuids?.includes('id')) {
    if (!isUUID(owner.sourceId)) issue(owner.table, null, 'INVALID_UUID', 'id');
    if (!isUUID(owner.targetId)) issue(owner.table, null, 'INVALID_TARGET_UUID', 'id');
  }
  if (issues.length)
    return {
      ready: false,
      records: {} as Record<string, MigrationRecord[]>,
      issues,
      excluded,
      mapping: [] as { table: string; sourceId: string; targetId: string }[],
      referenceEvidence: [] as MigrationRecord[],
      checksums,
      digest: stable({ manifest, issues }),
    };
  const ledgerAliasBySource = new Map((ledgerIds?.aliases ?? []).map(alias => [alias.sourceId, alias]));
  aliases.get(owner.table)?.set(owner.sourceId, owner.targetId);
  const approvedAliases = (input.identities?.approvedAliases ?? []).filter(alias => alias && typeof alias.sourceId === 'string' && typeof alias.targetId === 'string');
  if (approvedAliases.length) {
    issues.push(...auditStaffIdentityReferences(input.source[owner.table] ?? [], owner, input.identities));
    for (const alias of approvedAliases) {
      const native = input.target.staff_users?.find(row => row._id === alias.targetId);
      if (!native || email(native.email) !== alias.email) issue(owner.table, null, 'PRESERVED_TEST_PROFILE_REQUIRED');
      aliases.get(owner.table)?.set(alias.sourceId, alias.targetId);
    }
  }
  const candidates: { table: MigrationTable; id: string; row: SourceRow }[] = [];
  for (const table of [...manifest.tables].sort((a, b) => a.source.localeCompare(b.source))) {
    const seen = new Set<string>();
    for (const sourceRow of [...(input.source[table.source] ?? [])].sort((a, b) =>
      rowKey(table, a).localeCompare(rowKey(table, b)),
    )) {
      const row = { ...sourceRow };
      const id = rowKey(table, row);
      if (table.exclude) {
        excluded.push({ table: table.source, row: id, reason: table.exclude });
        continue;
      }
      if (!id || seen.has(id)) {
        issue(table.source, id, 'DUPLICATE_OR_INVALID_SOURCE_KEY');
        continue;
      }
      seen.add(id);
      if (table.ownerField && (row[table.ownerField] === owner.sourceId || approvedAliases.some(alias => row[table.ownerField!] === alias.sourceId))) {
        if (table.source === 'public.ost_members' && row[table.ownerField] !== owner.sourceId) {
          const targetId = approvedMigrationIdentityId(String(row.id), owner, input.identities);
          if (!input.target[table.target]?.some(native => native._id === targetId && email(native.email) === email(row.email))) issue(table.source, id, 'PRESERVED_TEST_OST_PROFILE_REQUIRED');
          else aliases.get(table.source)?.set(id, targetId);
        }
        excluded.push({ table: table.source, row: id, reason: row[table.ownerField] === owner.sourceId ? 'PROTECTED_OWNER' : 'OWNER_APPROVED_TEST_PROFILE_PRESERVED' });
        continue;
      }
      if (table.source === 'public.staff_users' || table.target === 'staff_users') {
        if (typeof row.email !== 'string' || row.email !== email(row.email))
          issue(table.source, id, 'INVALID_STAFF_EMAIL', 'email');
        if (!['invited', 'active', 'inactive', 'suspended'].includes(String(row.status)))
          issue(table.source, id, 'INVALID_STAFF_STATUS', 'status');
      }
      for (const column of Object.keys(row))
        if (!table.columns.includes(column))
          issue(table.source, id, 'UNKNOWN_SOURCE_COLUMN', column);
      for (const column of table.columns)
        if (!Object.hasOwn(row, column)) issue(table.source, id, 'MISSING_SOURCE_COLUMN', column);
      for (const column of table.notNull ?? [])
        if (row[column] == null) issue(table.source, id, 'NOT_NULL_VIOLATION', column);
      for (const problem of migrationNetworkIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationCustomerIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationPointsIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationFinanceIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationFormsIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationImportIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationLegacyOstIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationDocumentIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationAuditIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationRulePolicyIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      for (const problem of migrationIdentifierIssues(table, row))
        issue(table.source, id, problem.code, problem.column);
      if (table.authActor && typeof row.actor_id === 'string')
        row.actor_id = approvedMigrationIdentityId(row.actor_id, manifest.protectedOwner, input.identities);
      if (table.customerIdentity && typeof row.auth_user_id === 'string')
        row.auth_user_id = approvedMigrationIdentityId(row.auth_user_id, manifest.protectedOwner, input.identities);
      for (const column of table.booleans ?? [])
        if (row[column] !== null && typeof row[column] !== 'boolean')
          issue(table.source, id, 'INVALID_BOOLEAN', column);
      for (const column of table.stringArrays ?? [])
        if(row[column]!==null&&(!Array.isArray(row[column])||!(row[column] as unknown[]).every((value)=>typeof value==='string')))
          issue(table.source,id,'INVALID_STRING_ARRAY',column);
      for (const column of table.uuids ?? [])
        if (row[column] !== null && !isUUID(row[column]))
          issue(table.source, id, 'INVALID_UUID', column);
      for (const column of table.text ?? [])
        if (row[column] !== null && typeof row[column] !== 'string')
          issue(table.source, id, 'INVALID_TEXT', column);
      for (const column of table.int32 ?? [])
        if (
          row[column] !== null &&
          (typeof row[column] !== 'number' ||
            !Number.isInteger(row[column]) ||
            row[column] < -2147483648 ||
            row[column] > 2147483647)
        )
          issue(table.source, id, 'INVALID_INT32', column);
      if (
        table.source === 'public.network_member_profiles' ||
        table.target === 'network_member_profiles'
      ) {
        for (const [column, options] of [
          ['sex', ['Male', 'Female']],
          ['civil_status', ['Single', 'Married', 'Widowed', 'Separated']],
        ] as const)
          if (table.columns.includes(column) && !options.some((value) => value === row[column]))
            issue(table.source, id, 'INVALID_NETWORK_PROFILE_VALUE', column);
        for (const column of ['province_code', 'city_municipality_code'])
          if (
            table.columns.includes(column) &&
            row[column] !== null &&
            (typeof row[column] !== 'string' || !/^\d{10}$/.test(row[column]))
          )
            issue(table.source, id, 'INVALID_NETWORK_PROFILE_VALUE', column);
      }
      const code = referenceCodes[table.source] ?? referenceCodes[`public.${table.target}`];
      const codeValue = code ? row[code.column] : undefined;
      if (code && (typeof codeValue !== 'string' || !code.pattern.test(codeValue)))
        issue(table.source, id, 'INVALID_REFERENCE_CODE', code.column);
      const flags = accessFlags(table);
      if (table.source === 'public.card_plans' || table.target === 'card_plans') {
        for (const column of [
          'yearly_points',
          'annual_points_tranches',
          'base_validity_years',
          'spot_cash_days',
          'standard_installment_months',
          'validity_years',
          'validity_extension_years',
          'cardholder_limit',
          'discount_percent',
        ]) {
          const minimum = ['validity_extension_years', 'discount_percent'].includes(column) ? 0 : 1;
          const maximum =
            column === 'cardholder_limit' ? 2 : column === 'discount_percent' ? 100 : 2147483647;
          const value = row[column];
          if (
            table.columns.includes(column) &&
            (typeof value !== 'number' || value < minimum || value > maximum)
          )
            issue(table.source, id, 'INVALID_CATALOG_VALUE', column);
        }
        if (
          table.columns.includes('commission_rate') &&
          (typeof row.commission_rate !== 'string' ||
            !/^(0(\.[0-9]{1,4})?|1(\.0{1,4})?)$/.test(row.commission_rate))
        )
          issue(table.source, id, 'INVALID_CATALOG_VALUE', 'commission_rate');
      }
      if (
        flags === grantFlags &&
        row.can_view !== true &&
        grantFlags.slice(1).some((column) => row[column] === true)
      )
        issue(table.source, id, 'PERMISSION_VIEW_REQUIRED');
      if (flags === denyFlags && denyFlags.every((column) => row[column] === false))
        issue(table.source, id, 'EMPTY_PERMISSION_RESTRICTION');
      for (const column of table.dates ?? []) {
        const value = row[column];
        if (value === null) continue;
        if (
          typeof value !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          'error' in migrationTimestamp(`${value}T00:00:00Z`)
        )
          issue(table.source, id, 'INVALID_DATE', column);
      }
      for (const column of table.timestamps ?? []) {
        if (row[column] === null) continue;
        const normalized = migrationTimestamp(row[column], manifest.timestampPrecision);
        if ('error' in normalized) issue(table.source, id, normalized.error, column);
        else row[column] = normalized.value;
      }
      if (manifest.timestampPrecision === 'preserve-source' && table.timestamps?.length)
        row.migration_source_timestamps = Object.fromEntries(
          table.timestamps.map((column) => [column, sourceRow[column]]),
        );
      for (const [column, kind] of Object.entries(table.bigints ?? {})) {
        const value = row[column];
        if (value === null) continue;
        // PostgreSQL bigint must arrive as text, before any lossy Number conversion.
        if (typeof value !== 'string' || !/^(0|-?[1-9]\d{0,18})$/.test(value)) {
          issue(table.source, id, 'INVALID_BIGINT', column);
          continue;
        }
        const integer = BigInt(value);
        if (
          integer < -9223372036854775808n ||
          integer > 9223372036854775807n ||
          (kind === 'safe_integer' &&
            (integer < BigInt(Number.MIN_SAFE_INTEGER) ||
              integer > BigInt(Number.MAX_SAFE_INTEGER)))
        )
          issue(table.source, id, 'INVALID_BIGINT', column);
        else if (kind === 'safe_integer') row[column] = Number(integer);
      }
      for (const column of table.money ?? [])
        if (
          row[column] !== null && (typeof row[column] !== 'string' ||
          !isExactDecimal(row[column]) ||
          ((table.source === 'public.card_plans' || table.target === 'card_plans') &&
            !/^(0|[1-9][0-9]*)(\.[0-9]{1,2})?$/.test(row[column])))
        )
          issue(table.source, id, 'INVALID_MONEY', column);
      if (table.source === 'public.tier_points_config' || table.target === 'tier_points_config') {
        if (!['BRONZE', 'SILVER', 'GOLD'].some((tier) => tier === row.tier))
          issue(table.source, id, 'INVALID_POINTS_TIER', 'tier');
        if (
          typeof row.annual_points_cap !== 'number' ||
          !Number.isSafeInteger(row.annual_points_cap) ||
          row.annual_points_cap <= 0
        )
          issue(table.source, id, 'INVALID_POINTS_CAP', 'annual_points_cap');
      }
      checksums.push({ table: table.source, row: id, checksum: stable(sourceRow) });
      if (table.source === 'public.customer_import_jobs' && table.target === 'customer_import_jobs' && table.columns.includes('status'))
        row.migration_revalidation_required = true;
      if (table.source === 'public.identity_documents' && table.target === 'identity_documents' && table.columns.includes('storage_path'))
        row.migration_file_transfer_required = true;
      candidates.push({ table, id, row });
      if (!table.referenceMatch) aliases.get(table.source)!.set(id, table.source === 'public.points_ledger' ? (ledgerAliasBySource.get(id)?.targetId ?? id) : id);
    }
  }
  const resolveReferences = (table: MigrationTable, id: string, row: SourceRow) => {
    const mapped = { ...row };
    for (const [column, parent] of Object.entries(table.references ?? {})) {
      const value = row[column];
      if (value == null && !(table.requiredReferences ?? []).includes(column)) continue;
      const parentTable = tables.get(parent),
        known = typeof value === 'string' ? aliases.get(parent)?.get(value) : undefined;
      const existing =
        parentTable &&
        (input.target[parentTable.target] ?? []).some((target) => target._id === value);
      if (!known && !existing) issue(table.source, id, 'DANGLING_REFERENCE', column);
      else mapped[column] = known ?? value;
    }
    if (table.source === 'public.commission_rules' && table.target === 'commission_rules' && table.columns.includes('target_type')) {
      const column = commissionRuleTargetColumn(mapped.target_type);
      if (column) mapped.target_id = mapped[column];
    }
    for (const column of table.uuids ?? [])
      if (mapped[column] !== null && !isUUID(mapped[column]))
        issue(table.source, id, 'INVALID_TARGET_UUID', column);
    return mapped;
  };
  const pending = candidates.filter(({ table }) => !table.referenceMatch);
  let matching = candidates.filter(({ table }) => table.referenceMatch);
  const unresolved = new Map<string, Set<string>>();
  for (const { table, id } of matching) {
    if (!unresolved.has(table.source)) unresolved.set(table.source, new Set());
    unresolved.get(table.source)!.add(id);
  }
  while (matching.length) {
    const deferred: typeof matching = [];
    for (const candidate of matching) {
      const { table, id, row } = candidate;
      // Resolve parent aliases before comparing target natural keys or grant flags.
      if (
        Object.entries(table.references ?? {}).some(
          ([column, parent]) =>
            typeof row[column] === 'string' && unresolved.get(parent)?.has(row[column]),
        )
      ) {
        deferred.push(candidate);
        continue;
      }
      const resolved = resolveReferences(table, id, row);
      const matches = (input.target[table.target] ?? []).filter((target) =>
        table.referenceMatch!.every((k) => same(resolved[k], target[targetColumn(table, k)])),
      );
      unresolved.get(table.source)!.delete(id);
      if (matches.length > 1) {
        issue(table.source, id, 'AMBIGUOUS_REFERENCE_MATCH');
        continue;
      }
      if (matches.length) {
        const match = matches[0]!;
        if (table.uuids?.includes('id') && !isUUID(match._id))
          issue(table.source, id, 'INVALID_TARGET_UUID', 'id');
        if (
          table.columns
            .filter((k) => !(table.key.length === 1 && table.key[0] === 'id' && k === 'id'))
            .some((k) => !same(resolved[k], match[targetColumn(table, k)])) ||
          (Object.hasOwn(resolved, 'migration_source_timestamps') &&
            !same(resolved.migration_source_timestamps, match.migration_source_timestamps))
        ) {
          const original = input.source[table.source]!.find(source => rowKey(table, source) === id)!;
          const reuse = Array.isArray(referenceReuse) ? referenceReuse.find(item => item?.table === table.source && item.sourceId === id && item.targetId === match._id) : undefined;
          const preservesBehavior = table.columns.filter(k => k !== 'id' && !same(resolved[k], match[targetColumn(table, k)])).every(k => migrationReferenceMetadataColumns[table.source]?.includes(k));
          if (reuse && reusableReferenceTables.has(table.source) && table.target === table.source.slice(7) && preservesBehavior && reuse.sourceFingerprint === stable(original) && reuse.targetFingerprint === stable(match)) {
            usedReferenceReuse.add(reuse);
            referenceEvidence.push({ _id: 'source-reference-' + stable(reuse), source_table: table.source, source_id: id, target_id: match._id, source_values: structuredClone(original), source_checksum: reuse.sourceFingerprint, retained_native_checksum: reuse.targetFingerprint });
          } else issue(table.source, id, 'REFERENCE_RECORD_CONFLICT');
        }
        aliases.get(table.source)!.set(id, match._id);
        excluded.push({ table: table.source, row: id, reason: 'REFERENCE_REUSED' });
      } else {
        aliases.get(table.source)!.set(id, id);
        pending.push(candidate);
      }
    }
    if (deferred.length === matching.length) {
      for (const { table, id } of deferred)
        issue(table.source, id, 'REFERENCE_MATCH_DEPENDENCY_CYCLE');
      break;
    }
    matching = deferred;
  }
  for (const { table, id, row } of pending) {
    const mapped = Object.fromEntries(
      Object.entries(structuredClone(resolveReferences(table, id, row)))
        .filter(([k]) => k !== 'id')
        .map(([k, value]) => [targetColumn(table, k), value]),
    ) as MigrationRecord;
    mapped._id = aliases.get(table.source)?.get(id) ?? id;
    const ledgerAlias = table.source === 'public.points_ledger' ? ledgerAliasBySource.get(id) : undefined;
    if (ledgerAlias) {
      mapped.migration_source_ledger_id = id;
      mapped.migration_source_ledger_checksum = ledgerAlias.sourceFingerprint;
    }
    const existing = input.target[table.target] ?? [],
      sameId = existing.find((target) => target._id === mapped._id);
    if (table.source === 'public.commission_rules' && table.target === 'commission_rules' && table.columns.includes('target_type') && commissionRuleOverlaps(mapped, [...existing, ...(records[table.target] ?? [])]))
      issue(table.source, id, 'COMMISSION_RULE_RANGE_CONFLICT');
    if (sameId) {
      if (Object.entries(mapped).some(([k, v]) => !same(v, sameId[k])))
        issue(table.source, id, 'TARGET_RECORD_CONFLICT');
      else excluded.push({ table: table.source, row: id, reason: 'ALREADY_PRESENT' });
      continue;
    }
    for (const { columns: key, when } of [
      ...(table.unique ?? []).map((columns) => ({ columns, when: {} as Record<string, boolean> })),
      ...(table.partialUnique ?? []),
    ])
      if (
        Object.entries(when).every(
          ([column, value]) => matchesPredicate(mapped[targetColumn(table, column)], value),
        ) &&
        key.every((k) => mapped[targetColumn(table, k)] != null) &&
        [...existing, ...(records[table.target] ?? [])].some(
          (target) =>
            Object.entries(when).every(
              ([column, value]) => matchesPredicate(target[targetColumn(table, column)], value),
            ) &&
            key.every((k) =>
              uniqueSame(
                targetColumn(table, k),
                mapped[targetColumn(table, k)],
                target[targetColumn(table, k)],
              ),
            ),
        )
      )
        issue(table.source, id, 'UNIQUE_CONFLICT');
    records[table.target]?.push(mapped);
  }
  const mapping = [...aliases]
    .flatMap(([table, values]) =>
      [...values].map(([sourceId, targetId]) => ({ table, sourceId, targetId })),
    )
    .sort((a, b) => `${a.table}:${a.sourceId}`.localeCompare(`${b.table}:${b.sourceId}`));
  if (Array.isArray(referenceReuse) && referenceReuse.some(item => !usedReferenceReuse.has(item))) issue('_input', null, 'UNUSED_OR_STALE_REFERENCE_REUSE');
  const ready = issues.length === 0;
  return {
    ready,
    records: ready ? records : {},
    issues,
    excluded,
    mapping,
    checksums,
    referenceEvidence: ready ? referenceEvidence : [],
    digest: stable({
      manifest,
      ...(input.identities ? { identities: input.identities } : {}),
      ...(input.referenceReuse ? { referenceReuse: input.referenceReuse } : {}),
      ...(input.ledgerIdPlan ? { ledgerIdPlan: input.ledgerIdPlan } : {}),
      records,
      issues,
      excluded,
      mapping,
      checksums,
      target: Object.fromEntries(
        [...targets]
          .sort()
          .map((name) => [
            name,
            [...(input.target[name] ?? [])].sort((a, b) => a._id.localeCompare(b._id)),
          ]),
      ),
    }),
  };
}
