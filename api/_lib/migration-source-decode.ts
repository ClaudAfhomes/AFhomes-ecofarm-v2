import type { MigrationManifest } from './migration-mapping.js';
import type { SourceArchive } from './migration-source-archive.js';

class NumericToken {
  constructor(readonly source: string) {}
}
function canonicalDecimal(text: string) {
  const parts = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(text);
  if (!parts) throw new Error('UNSAFE_JSON_NUMBER');
  let digits = (parts[2]! + (parts[3] ?? '')).replace(/^0+/, '');
  let exponent = Number(parts[4] ?? 0) - (parts[3]?.length ?? 0);
  if (!Number.isSafeInteger(exponent)) throw new Error('UNSAFE_JSON_NUMBER');
  if (!digits) return '0';
  const zeros = /0*$/.exec(digits)![0].length;
  digits = digits.slice(0, digits.length - zeros);
  exponent += zeros;
  return `${parts[1]}${digits}e${exponent}`;
}
function jsonValue(value: unknown): unknown {
  if (value instanceof NumericToken) {
    const numeric = Number(value.source);
    if (
      !Number.isFinite(numeric) ||
      (Number.isInteger(numeric) && !Number.isSafeInteger(numeric)) ||
      canonicalDecimal(value.source) !== canonicalDecimal(JSON.stringify(numeric))
    )
      throw new Error('UNSAFE_JSON_NUMBER');
    return numeric;
  }
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonValue(item)]));
  return value;
}
function scalar(value: unknown, type: string): unknown {
  if (value === null) return null;
  if (['jsonb', 'json'].includes(type)) return jsonValue(value);
  if(type==='ARRAY'&&Array.isArray(value)&&value.every((item)=>typeof item==='string'))return [...value];
  if (['bigint', 'integer', 'smallint'].includes(type)) {
    if (!(value instanceof NumericToken) || !/^(0|-?[1-9]\d*)$/.test(value.source))
      throw new Error('INVALID_SQL_INTEGER');
    const integer = BigInt(value.source);
    if (type === 'bigint') {
      if (integer < -(2n ** 63n) || integer >= 2n ** 63n) throw new Error('INVALID_SQL_INTEGER');
      return value.source;
    }
    const limit = type === 'smallint' ? 32768n : 2147483648n;
    if (integer < -limit || integer >= limit) throw new Error('INVALID_SQL_INTEGER');
    return Number(integer);
  }
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (
    ['text', 'character varying', 'uuid', 'date', 'timestamp with time zone'].includes(type) &&
    typeof value === 'string'
  )
    return value;
  throw new Error('UNSUPPORTED_OR_INVALID_SQL_SCALAR');
}

/** Decode only reviewed tables, retaining PostgreSQL bigint text before any numeric conversion. */
export function decodeMigrationSourceRows(
  archive: SourceArchive,
  manifest: Pick<MigrationManifest, 'tables'>,
) {
  const issues: { table: string; row: number | null; column?: string; code: string }[] = [];
  const source: Record<string, Record<string, unknown>[]> = {};
  for (const table of manifest.tables) {
    if (table.exclude) {
      source[table.source] = [];
      continue;
    }
    const matches = archive.tables.filter((candidate) => candidate.name === table.source);
    const columns = archive.schema.columns.filter(
      (value): value is { schema: string; table: string; name: string; type: string } =>
        !!value &&
        typeof value === 'object' &&
        'schema' in value &&
        'table' in value &&
        `${value.schema}.${value.table}` === table.source &&
        'name' in value &&
        typeof value.name === 'string' &&
        'type' in value &&
        typeof value.type === 'string',
    );
    const names = columns.map((column) => column.name);
    if (
      matches.length !== 1 ||
      new Set(names).size !== names.length ||
      names.length !== table.columns.length ||
      table.columns.some((name) => !names.includes(name))
    ) {
      issues.push({ table: table.source, row: null, code: 'SOURCE_SCHEMA_MISMATCH' });
      continue;
    }
    source[table.source] = [];
    for (const [index, raw] of matches[0]!.rows.entries()) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw, (_key, value: unknown, context?: { source?: string }) => {
          if (typeof value !== 'number') return value;
          if (!context?.source) throw new Error();
          return new NumericToken(context.source);
        });
        if (
          !parsed ||
          Array.isArray(parsed) ||
          typeof parsed !== 'object' ||
          parsed instanceof NumericToken ||
          Object.keys(parsed).length !== names.length ||
          names.some((name) => !Object.hasOwn(parsed, name))
        )
          throw new Error();
      } catch {
        issues.push({
          table: table.source,
          row: index,
          code: 'INVALID_OR_UNSUPPORTED_SOURCE_JSON',
        });
        continue;
      }
      const row: Record<string, unknown> = {};
      for (const column of columns) {
        try {
          row[column.name] = scalar(parsed[column.name], column.type);
        } catch (error) {
          const code =
            error instanceof Error &&
            [
              'UNSAFE_JSON_NUMBER',
              'INVALID_SQL_INTEGER',
              'UNSUPPORTED_OR_INVALID_SQL_SCALAR',
            ].includes(error.message)
              ? error.message
              : 'INVALID_SOURCE_VALUE';
          issues.push({ table: table.source, row: index, column: column.name, code });
        }
      }
      source[table.source].push(row);
    }
  }
  return { ready: issues.length === 0, source: issues.length ? {} : source, issues };
}
