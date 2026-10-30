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
  bigints?: Record<string, 'identifier' | 'safe_integer'>;
  renames?: Record<string, string>;
  timestamps?: string[];
  dates?: string[];
  notNull?: string[];
  booleans?: string[];
  uuids?: string[];
  text?: string[];
  int32?: string[];
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
const isUUID = (value: unknown) =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
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
const targetColumn = (table: MigrationTable, column: string) => table.renames?.[column] ?? column;
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
};

function migrationTimestamp(value: unknown): { value: string } | { error: string } {
  const parts =
    typeof value === 'string'
      ? /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|([+-])(\d{2})(?::?(\d{2}))?)$/.exec(
          value,
        )
      : null;
  if (!parts || parts[1]!.startsWith('0000-')) return { error: 'INVALID_TIMESTAMP' };
  const fraction = parts[3] ?? '';
  // Native timestamps use milliseconds; never silently discard source microseconds.
  if (/[1-9]/.test(fraction.slice(3))) return { error: 'TIMESTAMP_PRECISION_LOSS' };
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
    for (const [column, destination] of Object.entries(table.renames ?? {}))
      if (
        !table.columns.includes(column) ||
        column === 'id' ||
        column === table.ownerField ||
        !/^[a-z][a-z0-9_]*$/.test(destination) ||
        forbidden.has(destination) ||
        ['_id', 'id', 'password', 'encrypted_password', 'secret', 'refresh_token'].includes(
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
    for (const column of [...(table.text ?? []), ...(table.int32 ?? [])]) {
      const declarations = [
        table.text,
        table.int32,
        table.timestamps,
        table.dates,
        table.booleans,
        table.uuids,
        table.money,
        Object.keys(table.bigints ?? {}),
      ];
      if (
        declarations.filter((columns) => columns?.includes(column)).length > 1 ||
        (table.int32?.includes(column) &&
          (table.references?.[column] || table.ownerField === column))
      )
        issue(table.source, null, 'INVALID_SCALAR_MAPPING', column);
    }
    for (const column of [
      ...Object.keys(table.references ?? {}),
      ...Object.keys(table.bigints ?? {}),
      ...(table.timestamps ?? []),
      ...(table.dates ?? []),
      ...(table.notNull ?? []),
      ...(table.booleans ?? []),
      ...(table.uuids ?? []),
      ...(table.text ?? []),
      ...(table.int32 ?? []),
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
      checksums,
      digest: stable({ manifest, issues }),
    };
  aliases.get(owner.table)?.set(owner.sourceId, owner.targetId);
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
      if (table.ownerField && row[table.ownerField] === owner.sourceId) {
        excluded.push({ table: table.source, row: id, reason: 'PROTECTED_OWNER' });
        continue;
      }
      for (const column of Object.keys(row))
        if (!table.columns.includes(column))
          issue(table.source, id, 'UNKNOWN_SOURCE_COLUMN', column);
      for (const column of table.columns)
        if (!Object.hasOwn(row, column)) issue(table.source, id, 'MISSING_SOURCE_COLUMN', column);
      for (const column of table.notNull ?? [])
        if (row[column] == null) issue(table.source, id, 'NOT_NULL_VIOLATION', column);
      for (const column of table.booleans ?? [])
        if (row[column] !== null && typeof row[column] !== 'boolean')
          issue(table.source, id, 'INVALID_BOOLEAN', column);
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
      const code = referenceCodes[table.source] ?? referenceCodes[`public.${table.target}`];
      const codeValue = code ? row[code.column] : undefined;
      if (code && (typeof codeValue !== 'string' || !code.pattern.test(codeValue)))
        issue(table.source, id, 'INVALID_REFERENCE_CODE', code.column);
      const flags = accessFlags(table);
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
        const normalized = migrationTimestamp(row[column]);
        if ('error' in normalized) issue(table.source, id, normalized.error, column);
        else row[column] = normalized.value;
      }
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
        if (typeof row[column] !== 'string' || !isExactDecimal(row[column]))
          issue(table.source, id, 'INVALID_MONEY', column);
      checksums.push({ table: table.source, row: id, checksum: stable(sourceRow) });
      candidates.push({ table, id, row });
      if (!table.referenceMatch) aliases.get(table.source)!.set(id, id);
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
            .some((k) => !same(resolved[k], match[targetColumn(table, k)]))
        )
          issue(table.source, id, 'REFERENCE_RECORD_CONFLICT');
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
    mapped._id = id;
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
        key.every((k) => mapped[targetColumn(table, k)] != null) &&
        [...existing, ...(records[table.target] ?? [])].some((target) =>
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
