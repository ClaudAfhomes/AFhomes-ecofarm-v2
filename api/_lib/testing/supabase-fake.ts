/**
 * In-memory Supabase client fake for API handler tests.
 *
 * The AF Homes handlers drive supabase-js with the fluent query builder
 * (`from().select().eq().maybeSingle()`, `insert().select().single()`, …).
 * This fake implements exactly the surface those handlers use, backed by plain
 * arrays, so tests can assert on authorization outcomes and emitted queries
 * without a network, a database, or a mock of the builder itself.
 *
 * Deliberately NOT a mock of `rest.js`: tests install this through the same
 * seam production uses (`vi.mock` on `_lib/rest.js`), so the handler's real
 * code path - including its real `.from()` chains - is what runs.
 */

import { randomUUID } from 'node:crypto';

export type FakeRow = Record<string, unknown>;

export type FakeTables = Record<string, FakeRow[]>;

export type FakeAuthUser = {
  id: string;
  email: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
};

/** Recorded writes, so tests can assert on side effects (audit rows, inserts). */
export type FakeCall = { op: string; table: string; arg?: unknown };

export type FakeOptions = {
  tables?: FakeTables;
  /** token -> authenticated user. A missing token resolves an UNAUTHORIZED error. */
  tokens?: Record<string, FakeAuthUser>;
  /** Force every operation on a table to fail (missing relation, RLS, ...). */
  errors?: Record<string, { code?: string; message: string }>;
  /**
   * Errors that apply only to writes. Use this when a test needs the read path
   * (authorization resolution) to succeed but the write to fail, so a rollback
   * path can be exercised.
   */
  writeErrors?: Record<string, { code?: string; message: string }>;
  /** table -> composite unique key column groups, enforced like Postgres 23505. */
  unique?: Record<string, string[][]>;
  /**
   * table -> column defaults applied on insert, so a handler that relies on a
   * Postgres `DEFAULT` (e.g. omitting `status` and letting the column supply
   * `'pending'`) behaves the same here.
   */
  defaults?: Record<string, Record<string, unknown>>;
  /** Parent/child relationships used to resolve PostgREST embedded selects. */
  links?: { child: string; parent: string; fk: string; pk?: string }[];
  /** Scripted `rpc()` results, keyed by function name. */
  rpcs?: { fn: string; result: unknown | ((args: Record<string, unknown>) => unknown) }[];
  /** Forced `rpc()` errors, keyed by function name. */
  rpcErrors?: Record<string, { code?: string; message: string }>;
  /** Override `auth.admin.inviteUserByEmail`. */
  invite?: (email: string, options: unknown) => Promise<unknown>;
  /** Id handed back by `inviteUserByEmail`. */
  inviteUserId?: string;
};

type Op =
  | { t: 'select'; cols: string; count: boolean }
  | { t: 'insert'; rows: FakeRow[] }
  | { t: 'update'; patch: FakeRow }
  | { t: 'delete' }
  | { t: 'eq'; col: string; val: unknown }
  | { t: 'in'; col: string; vals: unknown[] }
  | { t: 'or'; filter: string }
  | { t: 'range'; from: number; to: number }
  | { t: 'order'; col: string; asc: boolean }
  | { t: 'limit'; n: number };

const authError = (message: string, code = 'PGRST301') => ({ code, message });

/** `col.op.value` triples of a PostgREST `or=` filter. */
function parseOrFilter(filter: string): { col: string; op: string; value: unknown }[] {
  return filter.split(',').map((clause) => {
    const [col, op, ...rest] = clause.split('.');
    let value: unknown = rest.join('.');
    if (typeof value === 'string' && value.startsWith('%') && value.endsWith('%')) {
      value = value.slice(1, -1);
    }
    return { col: col!, op: op!, value };
  });
}

function compareOp(op: string, actual: unknown, expected: unknown): boolean {
  if (actual === undefined || actual === null) return false;
  const a = String(actual);
  const b = String(expected);
  switch (op) {
    case 'eq':
      return a === b;
    case 'ilike': {
      const pattern = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`^${pattern}$`, 'i').test(a);
    }
    case 'is':
      return b === 'null' ? actual === null : a === b;
    default:
      return false;
  }
}

/**
 * Resolve a PostgREST embedded select such as
 * `customers!inner(a,b)` or `seller:staff_users!card_sales_seller_staff_id_fkey(name)`
 * against a single-level parent -> child link.
 */
function splitTopLevel(spec: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  for (const ch of spec) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

const hasWrite = (ops: Op[]) =>
  ops.some((o) => o.t === 'insert' || o.t === 'update' || o.t === 'delete');

function matches(row: FakeRow, ops: Op[]): boolean {  return ops.every((op) => {
    switch (op.t) {
      case 'eq':
        return row[op.col] === op.val;
      case 'in':
        return op.vals.includes(row[op.col]);
      default:
        return true;
    }
  });
}

export class FakeSupabase {
  tables: FakeTables;
  tokens: Record<string, FakeAuthUser>;
  errors: Record<string, { code?: string; message: string }>;
  writeErrors: Record<string, { code?: string; message: string }>;
  unique: Record<string, string[][]>;
  defaults: Record<string, Record<string, unknown>>;
  links: { child: string; parent: string; fk: string; pk?: string }[];
  rpcs: { fn: string; result: unknown | ((args: Record<string, unknown>) => unknown) }[];
  rpcErrors: Record<string, { code?: string; message: string }>;
  calls: FakeCall[] = [];
  deletedAuthUsers: string[] = [];
  inviteUserId: string;
  private inviteImpl?: FakeOptions['invite'];

  constructor(options: FakeOptions = {}) {
    this.tables = options.tables ? structuredClone(options.tables) : {};
    this.tokens = options.tokens ?? {};
    this.errors = options.errors ?? {};
    this.writeErrors = options.writeErrors ?? {};
    this.unique = options.unique ?? {};
    this.defaults = options.defaults ?? {};
    this.links = (options.links ?? []).map((l) => ({ ...l, pk: l.pk ?? 'id' }));
    this.rpcs = options.rpcs ?? [];
    this.rpcErrors = options.rpcErrors ?? {};
    this.inviteImpl = options.invite;
    this.inviteUserId = options.inviteUserId ?? 'invited-user-0001';
  }

  /** Every row currently in a table (live reference - mutate via helpers). */
  rows(table: string): FakeRow[] {
    return (this.tables[table] ??= []);
  }

  auth = {
    getUser: async (token: string) => {
      const user = this.tokens[token];
      if (!user) return { data: { user: null }, error: authError('Invalid JWT') };
      return { data: { user }, error: null };
    },
    admin: {
      inviteUserByEmail: async (email: string, opts: unknown) => {
        this.calls.push({ op: 'inviteUserByEmail', table: 'auth', arg: { email, opts } });
        if (this.inviteImpl) return this.inviteImpl(email, opts);
        return {
          data: { user: { id: this.inviteUserId, email, email_confirmed_at: null } },
          error: null,
        };
      },
      deleteUser: async (id: string) => {
        this.deletedAuthUsers.push(id);
        this.calls.push({ op: 'deleteUser', table: 'auth', arg: id });
        return { data: {}, error: null };
      },
    },
  };

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    const ops: Op[] = [];
    const self = this;

    const builder = {
      select(cols?: string, opts?: { count?: string }) {
        ops.push({ t: 'select', cols: cols ?? '*', count: opts?.count === 'exact' });
        return this;
      },
      insert(rows: FakeRow | FakeRow[]) {
        const list = Array.isArray(rows) ? rows : [rows];
        ops.push({ t: 'insert', rows: list });
        self.calls.push({ op: 'insert', table, arg: list });
        return this;
      },
      update(patch: FakeRow) {
        ops.push({ t: 'update', patch });
        self.calls.push({ op: 'update', table, arg: patch });
        return this;
      },
      delete() {
        ops.push({ t: 'delete' });
        self.calls.push({ op: 'delete', table });
        return this;
      },
      upsert(rows: FakeRow | FakeRow[]) {
        const list = Array.isArray(rows) ? rows : [rows];
        self.calls.push({ op: 'upsert', table, arg: list });
        for (const row of list) {
          const idx = self.tables[table]!.findIndex((r) => r.id === row.id);
          if (idx >= 0) self.tables[table]![idx] = { ...self.tables[table]![idx], ...row };
          else self.tables[table]!.push(row);
        }
        return this;
      },
      eq(col: string, val: unknown) {
        ops.push({ t: 'eq', col, val });
        return this;
      },
      in(col: string, vals: unknown[]) {
        ops.push({ t: 'in', col, vals });
        return this;
      },
      or(filter: string) {
        ops.push({ t: 'or', filter });
        return this;
      },
      range(from: number, to: number) {
        ops.push({ t: 'range', from, to });
        return this;
      },
      order(col: string, opts?: { ascending?: boolean }) {
        ops.push({ t: 'order', col, asc: opts?.ascending !== false });
        return this;
      },
      limit(n: number) {
        ops.push({ t: 'limit', n });
        return this;
      },
      async maybeSingle() {
        // `insert().select().single()` is a write: the write error must surface,
        // not just the read result.
        const kind = hasWrite(ops) ? 'write' : 'select';
        const { data, error } = await run(kind);
        if (error) return { data: null, error };
        const rows = data ?? [];
        if (rows.length > 1) {
          return { data: null, error: authError('multiple rows returned for maybeSingle') };
        }
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const kind = hasWrite(ops) ? 'write' : 'select';
        const { data, error } = await run(kind);
        if (error) return { data: null, error };
        const rows = data ?? [];
        if (rows.length !== 1) {
          return { data: null, error: authError('expected exactly one row') };
        }
        return { data: rows[0]!, error: null };
      },
      then(
        onFulfilled?: (v: { data: FakeRow[] | null; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        return run(hasWrite(ops) ? 'write' : 'select').then(onFulfilled, onRejected);
      },
    };

    async function run(kind: 'select' | 'write'): Promise<{
      data: FakeRow[] | null;
      error: unknown;
    }> {
      const write = ops.find((o) => o.t === 'insert' || o.t === 'update' || o.t === 'delete');
      if (kind === 'write') {
        const werr = self.writeErrors[table];
        if (werr) return { data: null, error: { ...werr } };
      } else if (write === undefined) {
        const rerr = self.errors[table];
        if (rerr) return { data: null, error: { ...rerr } };
      }
      const store = self.tables[table]!;

      /**
       * Enforce declared composite unique keys the way Postgres does (23505).
       * `exclude` is the row being updated (skipped by reference so a row never
       * collides with its own new value); `next` is the value being written.
       */
      const uniqueViolation = (exclude: FakeRow | null, next: FakeRow) => {
        for (const key of self.unique[table] ?? []) {
          const clash = store.some(
            (row) => row !== exclude && key.every((col) => row[col] === next[col]),
          );
          if (clash) {
            return {
              code: '23505',
              message: `duplicate key value violates unique constraint on ${table}(${key.join(',')})`,
            };
          }
        }
        return null;
      };

      if (ops.some((o) => o.t === 'insert')) {
        const op = ops.find((o) => o.t === 'insert') as { t: 'insert'; rows: FakeRow[] };
        const defaults = self.defaults[table] ?? {};
        const withDefaults = op.rows.map((row) => {
          const filled: FakeRow = { ...row };
          for (const [col, value] of Object.entries(defaults)) {
            if (filled[col] === undefined) filled[col] = value;
          }
          // Every AF Homes business table declares `default gen_random_uuid()`.
          // Mirroring it keeps a row inserted without an explicit `id` readable
          // straight back, exactly as it is against Postgres.
          if (filled.id === undefined) filled.id = randomUUID();
          return filled;
        });
        for (const row of withDefaults) {
          const clash = uniqueViolation(null, row);
          if (clash) return { data: null, error: clash };
        }
        store.push(...withDefaults);
        return { data: withDefaults, error: null };
      }
      if (ops.some((o) => o.t === 'update')) {
        const op = ops.find((o) => o.t === 'update') as { t: 'update'; patch: FakeRow };
        const hit = store.filter((r) => matches(r, ops));
        for (const row of hit) {
          const clash = uniqueViolation(row, { ...row, ...op.patch });
          if (clash) return { data: null, error: clash };
        }
        for (const row of hit) Object.assign(row, op.patch);
        return { data: hit, error: null };
      }
      if (ops.some((o) => o.t === 'delete')) {
        const keep = store.filter((r) => !matches(r, ops));
        const removed = store.filter((r) => matches(r, ops));
        self.tables[table] = keep;
        return { data: removed, error: null };
      }

      let out = store.filter((r) => matches(r, ops));

      // `or=` : comma-separated `col.op.value` clauses, ANY of which may match.
      const orOp = ops.find((o) => o.t === 'or') as { t: 'or'; filter: string } | undefined;
      if (orOp) {
        const clauses = parseOrFilter(orOp.filter);
        out = out.filter((row) => clauses.some((c) => compareOp(c.op, row[c.col], c.value)));
      }

      // PostgREST order() clauses form ONE comparator, most significant first
      // (`ORDER BY a, b`), not a chain of independent sorts.
      const orders = ops.filter((o) => o.t === 'order') as { t: 'order'; col: string; asc: boolean }[];
      if (orders.length > 0) {
        out = [...out].sort((a, b) => {
          for (const order of orders) {
            const av = a[order.col];
            const bv = b[order.col];
            if (av === bv) continue;
            const cmp = av! > bv! ? 1 : -1;
            return order.asc ? cmp : -cmp;
          }
          return 0;
        });
      }
      const range = [...ops].reverse().find((o) => o.t === 'range') as
        | { t: 'range'; from: number; to: number }
        | undefined;
      const limit = [...ops].reverse().find((o) => o.t === 'limit') as
        | { t: 'limit'; n: number }
        | undefined;
      if (range) out = out.slice(range.from, range.to + 1);
      if (limit) out = out.slice(0, limit.n);

      // Resolve `!`-separated embedded selects against the configured links.
      const selectOp = ops.find((o) => o.t === 'select') as
        | { t: 'select'; cols: string; count: boolean }
        | undefined;
      if (selectOp && selectOp.cols.includes('!')) {
        out = out.map((row) => ({ ...row, ...self.embed(table, row, selectOp.cols) }));
      }
      return { data: out, error: null };
    }

    return builder;
  }

  /**
   * Attach embedded relations to a parent row. Supports one level of
   * `alias:child!constraint(cols)` / `child!constraint(cols)` / `child(cols)`.
   */
  private embed(parent: string, row: FakeRow, cols: string): FakeRow {
    const attached: FakeRow = {};
    for (const spec of splitTopLevel(cols)) {
      if (!spec.includes('!') && !/\w+\(/.test(spec)) continue;
      const inner = spec.includes('(') ? spec.slice(0, spec.indexOf('(')) : spec;
      const [aliasRaw, targetRaw] = inner.split(':');
      const alias = aliasRaw ?? inner;
      const target = (targetRaw ?? aliasRaw ?? inner) as string;
      // `child!inner` / `child!fk(cols)`. Without a constraint name, the
      // embedded table is the PARENT side and the current table holds the FK.
      const [embedTable, constraint] = target.split('!');
      const link = this.links.find((l) =>
        constraint && constraint !== 'inner'
          ? `${embedTable}_${l.fk}_fkey` === constraint
          : l.parent === embedTable && row[l.fk] !== undefined,
      );
      if (!link) continue;
      const pk = link.pk ?? 'id';
      const match = (this.tables[link.parent] ?? []).find((r) => r[pk] === row[link.fk]);
      if (match) attached[alias] = match;
    }
    return attached;
  }

  /**
   * `rpc(name, args)`. Each entry is `{ match: (args) => boolean, result }` so a
   * test can script a transactional function's return value and its side
   * effects.
   */
  async rpc(fn: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const entry = (this.rpcs ?? []).find((r) => r.fn === fn);
    this.calls.push({ op: 'rpc', table: fn, arg: args });
    if (this.rpcErrors[fn]) return { data: null, error: { ...this.rpcErrors[fn] } };
    if (!entry) return { data: null, error: { code: '42883', message: `${fn} does not exist` } };
    return { data: typeof entry.result === 'function' ? entry.result(args) : entry.result, error: null };
  }
}

/* ------------------------------------------------------------------ */
/* Vercel request/response adapters                                      */
/* ------------------------------------------------------------------ */

export function makeRes() {
  const state = {
    status: 200,
    body: undefined as unknown,
    headers: {} as Record<string, string>,
    ended: false,
  };
  const res = {
    setHeader(name: string, value: string) {
      state.headers[name.toLowerCase()] = value;
    },
    status(code: number) {
      state.status = code;
      return res;
    },
    json(body: unknown) {
      state.body = body;
      state.ended = true;
      return res;
    },
    end() {
      state.ended = true;
      return res;
    },
  };
  return { res, state };
}

export function makeReq(options: {
  method?: string;
  afPath?: string;
  /** Sub-path for a business-family handler (see handler-kit `subPath`). */
  familyPath?: string;
  body?: unknown;
  token?: string;
  query?: Record<string, string | string[] | undefined>;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = { ...options.headers };
  if (options.token) headers.authorization = `Bearer ${options.token}`;
    return {
    method: options.method ?? 'GET',
    query: {
      afPath: options.afPath ?? '',
      familyPath: options.familyPath ?? '',
      ...options.query,
    },
    headers,
    body: options.body,
  };
}
