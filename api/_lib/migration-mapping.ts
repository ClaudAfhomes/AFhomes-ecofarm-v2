import { isExactDecimal } from '@afhomes/shared';
import { purchaseFingerprint } from './purchase-fingerprint.js';

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
  unique?: string[][];
  referenceMatch?: string[];
  ownerField?: string;
  exclude?: string;
};
export type MigrationManifest = {
  version: 1;
  protectedOwner: { table: string; sourceId: string; targetId: string };
  tables: MigrationTable[];
};
type Issue = { table: string; row: string | null; column?: string; code: string };
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const stable = (value: unknown) => purchaseFingerprint(value);
const same = (a: unknown, b: unknown) => stable(a ?? null) === stable(b ?? null);
const email = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
function plainJSON(value: unknown, ancestors = new Set<object>()): boolean {
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
  const result = Object.values(value).every((item) => plainJSON(item, ancestors));
  ancestors.delete(value);
  return result;
}
const uniqueSame = (column: string, a: unknown, b: unknown) =>
  column === 'email' && typeof a === 'string' && typeof b === 'string'
    ? email(a) === email(b)
    : same(a, b);
const rowKey = (table: MigrationTable, row: SourceRow) =>
  table.key.length === 1 && table.key[0] === 'id'
    ? typeof row.id === 'string' && row.id
      ? row.id
      : ''
    : table.key.every((k) => row[k] != null)
      ? `migration-${stable([table.source, table.key.map((k) => row[k])])}`
      : '';

/** Pure business-data dry-run planner. No DB, filesystem, credentials, import execution or auth conversion. */
export function planMigrationMapping(
  manifest: MigrationManifest,
  input: { source: Record<string, SourceRow[]>; target: Record<string, MigrationRecord[]> },
) {
  const issues: Issue[] = [],
    excluded: { table: string; row: string; reason: string }[] = [];
  const records: Record<string, MigrationRecord[]> = {};
  const checksums: { table: string; row: string; checksum: string }[] = [];
  const tables = new Map<string, MigrationTable>(),
    aliases = new Map<string, Map<string, string>>();
  const issue = (table: string, row: string | null, code: string, column?: string) =>
    issues.push({ table, row, code, ...(column ? { column } : {}) });
  if (manifest.version !== 1) issue('_manifest', null, 'UNSUPPORTED_VERSION');
  if (!plainJSON(input)) issue('_input', null, 'CANONICAL_JSON_REQUIRED');
  const targets = new Set<string>();
  for (const table of manifest.tables) {
    if (
      tables.has(table.source) ||
      !/^(public|private|auth|storage)\.[a-z][a-z0-9_]*$/.test(table.source)
    )
      issue(table.source, null, 'INVALID_TABLE_MAPPING');
    tables.set(table.source, table);
    aliases.set(table.source, new Map());
    if (table.exclude) continue;
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
      table.columns.some((k) => forbidden.has(k) || k === '_id')
    )
      issue(table.source, null, 'INVALID_COLUMN_MANIFEST');
    if (
      table.target === 'staff_users' &&
      (table.ownerField !== 'id' || table.source !== manifest.protectedOwner.table)
    )
      issue(table.source, null, 'OWNER_PROTECTION_RULE_REQUIRED');
    if (
      ['staff_role_assignments', 'staff_permission_restrictions', 'ist_profiles'].includes(
        table.target,
      ) &&
      (table.ownerField !== 'staff_id' ||
        table.references?.staff_id !== manifest.protectedOwner.table)
    )
      issue(table.source, null, 'OWNER_PROTECTION_RULE_REQUIRED');
    if (table.requiredReferences?.some((k) => !table.references?.[k]))
      issue(table.source, null, 'INVALID_REQUIRED_REFERENCE');
    if (table.referenceMatch?.some((k) => table.references?.[k]))
      issue(table.source, null, 'REFERENCE_MATCH_REQUIRES_ADAPTER');
    for (const column of [
      ...Object.keys(table.references ?? {}),
      ...(table.money ?? []),
      ...(table.referenceMatch ?? []),
      ...(table.requiredReferences ?? []),
      ...(table.unique ?? []).flat(),
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
  for (const table of manifest.tables)
    for (const parent of Object.values(table.references ?? {}))
      if (
        !tables.has(parent) ||
        tables.get(parent)!.exclude ||
        tables.get(parent)!.key.length !== 1 ||
        tables.get(parent)!.key[0] !== 'id'
      )
        issue(table.source, null, 'UNREVIEWED_REFERENCE_TABLE');
  const owner = manifest.protectedOwner,
    ownerTable = tables.get(owner.table);
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
  if (issues.length)
    return {
      ready: false,
      records: {} as Record<string, MigrationRecord[]>,
      issues,
      excluded,
      mapping: [] as { table: string; sourceId: string; targetId: string }[],
      checksums,
      digest: stable({ manifest, issues }),
    };
  aliases.get(owner.table)?.set(owner.sourceId, owner.targetId);
  const pending: { table: MigrationTable; id: string; row: SourceRow }[] = [];
  for (const table of [...manifest.tables].sort((a, b) => a.source.localeCompare(b.source))) {
    const seen = new Set<string>();
    for (const row of [...(input.source[table.source] ?? [])].sort((a, b) =>
      rowKey(table, a).localeCompare(rowKey(table, b)),
    )) {
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
      if (table.ownerField && row[table.ownerField] === owner.sourceId) {
        excluded.push({ table: table.source, row: id, reason: 'PROTECTED_OWNER' });
        continue;
      }
      for (const column of Object.keys(row))
        if (!table.columns.includes(column))
          issue(table.source, id, 'UNKNOWN_SOURCE_COLUMN', column);
      for (const column of table.columns)
        if (!Object.hasOwn(row, column)) issue(table.source, id, 'MISSING_SOURCE_COLUMN', column);
      for (const column of table.money ?? [])
        if (typeof row[column] !== 'string' || !isExactDecimal(row[column]))
          issue(table.source, id, 'INVALID_MONEY', column);
      checksums.push({ table: table.source, row: id, checksum: stable(row) });
      const matches = table.referenceMatch
        ? (input.target[table.target] ?? []).filter((target) =>
            table.referenceMatch!.every((k) => same(row[k], target[k])),
          )
        : [];
      if (matches.length > 1) {
        issue(table.source, id, 'AMBIGUOUS_REFERENCE_MATCH');
        continue;
      }
      if (matches.length) {
        const match = matches[0]!;
        if (
          table.columns.filter((k) => !table.key.includes(k)).some((k) => !same(row[k], match[k]))
        )
          issue(table.source, id, 'REFERENCE_RECORD_CONFLICT');
        aliases.get(table.source)!.set(id, match._id);
        excluded.push({ table: table.source, row: id, reason: 'REFERENCE_REUSED' });
      } else {
        aliases.get(table.source)!.set(id, id);
        pending.push({ table, id, row });
      }
    }
  }
  for (const { table, id, row } of pending) {
    const mapped = Object.fromEntries(
      Object.entries(structuredClone(row)).filter(([k]) => k !== 'id'),
    ) as MigrationRecord;
    mapped._id = id;
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
    const existing = input.target[table.target] ?? [],
      sameId = existing.find((target) => target._id === id);
    if (sameId) {
      if (Object.entries(mapped).some(([k, v]) => !same(v, sameId[k])))
        issue(table.source, id, 'TARGET_RECORD_CONFLICT');
      else excluded.push({ table: table.source, row: id, reason: 'ALREADY_PRESENT' });
      continue;
    }
    for (const key of table.unique ?? [])
      if (
        key.every((k) => mapped[k] != null) &&
        [...existing, ...(records[table.target] ?? [])].some((target) =>
          key.every((k) => uniqueSame(k, mapped[k], target[k])),
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
  const ready = issues.length === 0;
  return {
    ready,
    records: ready ? records : {},
    issues,
    excluded,
    mapping,
    checksums,
    digest: stable({
      manifest,
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
