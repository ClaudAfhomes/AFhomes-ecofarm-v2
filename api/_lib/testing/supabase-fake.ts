import { z } from 'zod';
import { resolveCustomerCategory } from '@jad/contracts';
import { addMoney } from '@jad/shared';
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
  /** Verified JWT authentication method(s); active fixtures default to password. */
  amr?: (string | { method: string; timestamp: number })[];
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
  /** Override `auth.admin.createUser`, e.g. to inject a GoTrue failure. */
  createUser?: (attrs: {
    email: string;
    password?: string;
    email_confirm?: boolean;
    user_metadata?: unknown;
  }) => Promise<unknown>;
  /** Id handed back by `createUser`. */
  createUserId?: string;
  /** Override `auth.admin.updateUserById`, e.g. to inject a GoTrue failure. */
  updateUser?: (
    id: string,
    attrs: { password?: string; user_metadata?: unknown },
  ) => Promise<unknown>;
  /**
   * Override `auth.signInWithPassword` (the current-password re-verification
   * used by the staff password-change endpoint). Defaults to success; a test
   * that needs a wrong-password rejection supplies an impl that returns
   * `{ data: { user: null }, error }` unless the password matches.
   */
  signIn?: (creds: { email: string; password: string }) => Promise<unknown>;
  /** Addresses that already exist in GoTrue, to exercise duplicate conflicts. */
  existingAuthEmails?: string[];
  /**
   * Pre-existing GoTrue users, to exercise safe-link recovery of an Auth
   * account that already holds the customer email. Each entry is `{ id,
   * email }`; `createUser` refuses these addresses exactly like GoTrue, and
   * `auth.admin.listUsers` returns them alongside users created in-test.
   */
  authUsers?: { id: string; email: string }[];
};

type Op =
  | { t: 'select'; cols: string; count: boolean }
  | { t: 'insert'; rows: FakeRow[] }
  | { t: 'update'; patch: FakeRow }
  | { t: 'delete' }
  | { t: 'eq'; col: string; val: unknown }
  | { t: 'neq'; col: string; val: unknown }
  | { t: 'in'; col: string; vals: unknown[] }
  | { t: 'or'; filter: string }
  | { t: 'ilike'; col: string; pattern: string }
  | { t: 'gte'; col: string; val: unknown }
  | { t: 'lte'; col: string; val: unknown }
  | { t: 'range'; from: number; to: number }
  | { t: 'order'; col: string; asc: boolean; reference?: string }
  | { t: 'limit'; n: number; reference?: string };

/** A declared relation between two fixture tables. */
type FakeLink = { child: string; parent: string; fk: string; pk?: string };

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
  // TRIM every spec. Without this, `"a, customers!inner(status)"` yields
  // `" customers!inner(status)"` with a leading space, so the embed key becomes
  // `" customers"` and the table name `" customers"` matches no declared link.
  // The embed then resolves to `undefined` IN SILENCE, and any caller reading
  // `row.customers` gets a `?? {}` fallback rather than an error. That is how an
  // entire embed can be untested and still be green.
  return out.map((s) => s.trim());
}

const hasWrite = (ops: Op[]) =>
  ops.some((o) => o.t === 'insert' || o.t === 'update' || o.t === 'delete');

function matches(row: FakeRow, ops: Op[]): boolean {
  return ops.every((op) => {
    if ('col' in op && op.col.includes('.')) return true;
    switch (op.t) {
      case 'eq':
        return row[op.col] === op.val;
      case 'neq':
        return row[op.col] !== null && row[op.col] !== undefined && row[op.col] !== op.val;
      case 'in':
        return op.vals.includes(row[op.col]);
      case 'ilike': {
        // `%` is any run, `_` any single character. The only patterns the
        // handlers build are `%term%`, so a case-insensitive `includes` of the
        // wildcard-stripped needle is exact for them.
        const needle = op.pattern.replace(/[%_]/g, '').toLowerCase();
        return String(row[op.col] ?? '')
          .toLowerCase()
          .includes(needle);
      }
      case 'gte': {
        const a = row[op.col];
        if (a === undefined || a === null) return false;
        return String(a) >= String(op.val);
      }
      case 'lte': {
        const a = row[op.col];
        if (a === undefined || a === null) return false;
        return String(a) <= String(op.val);
      }
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
  /** Auth users this fake created via `auth.admin.createUser`. */
  createdAuthUsers: { id: string; email: string }[] = [];
  /** Emails that already "exist" in GoTrue, for duplicate-address conflicts. */
  createdAuthEmails = new Set<string>();
  /**
   * Passwords handed to `createUser`, captured ONLY so a test can assert the
   * value was passed through and is nowhere else. Nothing in production code
   * ever reads this.
   */
  passwordsSeen: string[] = [];
  inviteUserId: string;
  createUserId?: string;
  private inviteImpl?: FakeOptions['invite'];
  private createUserImpl?: FakeOptions['createUser'];
  private updateUserImpl?: FakeOptions['updateUser'];
  private signInImpl?: FakeOptions['signIn'];
  /** Pre-existing GoTrue users (see `FakeOptions.authUsers`). Never logged. */
  private seededAuthUsers: { id: string; email: string }[];

  constructor(options: FakeOptions = {}) {
    this.tables = options.tables ? structuredClone(options.tables) : {};
    // Mirror the new database default on synthetic operational-sale fixtures.
    for (const row of this.tables.card_sales ?? []) row.origin ??= 'normal';
    this.tokens = options.tokens ?? {};
    this.errors = options.errors ?? {};
    this.writeErrors = options.writeErrors ?? {};
    this.unique = options.unique ?? {};
    this.defaults = {
      ...options.defaults,
      card_sales: { origin: 'normal', ...options.defaults?.card_sales },
    };
    this.links = (options.links ?? []).map((l) => ({ ...l, pk: l.pk ?? 'id' }));
    this.rpcs = options.rpcs ?? [];
    this.rpcErrors = options.rpcErrors ?? {};
    this.inviteImpl = options.invite;
    this.inviteUserId = options.inviteUserId ?? 'invited-user-0001';
    this.createUserImpl = options.createUser;
    this.createUserId = options.createUserId;
    this.updateUserImpl = options.updateUser;
    this.signInImpl = options.signIn;
    this.seededAuthUsers = (options.authUsers ?? []).map((u) => ({ ...u }));
    for (const email of options.existingAuthEmails ?? []) this.createdAuthEmails.add(email);
  }

  /**
   * Every GoTrue user this fake knows: seeded pre-existing accounts plus
   * users created in-test. Emails only - no secret ever lives here.
   */
  authUsers(): { id: string; email: string }[] {
    return [
      ...this.seededAuthUsers.map((u) => ({ ...u })),
      ...this.createdAuthUsers.map((u) => ({ ...u })),
    ];
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
    getClaims: async (token: string) => {
      const user = this.tokens[token];
      if (!user) return { data: null, error: authError('Invalid JWT') };
      return {
        data: {
          claims: {
            sub: user.id,
            amr: user.amr ?? [{ method: 'password', timestamp: 1 }],
          },
          header: { alg: 'RS256' },
          signature: new Uint8Array(),
        },
        error: null,
      };
    },
    /**
     * Password re-verification for the staff password-change endpoint. The
     * password itself is never recorded in the call log (only the email), so
     * a test asserting "no secret in any recorded call" stays meaningful;
     * `passwordsSeen` remains the single capture point.
     */
    signInWithPassword: async (creds: { email: string; password: string }) => {
      this.calls.push({ op: 'signInWithPassword', table: 'auth', arg: { email: creds.email } });
      if (this.signInImpl) return this.signInImpl(creds);
      return {
        data: { user: { id: 'signed-in', email: creds.email }, session: { access_token: 'x' } },
        error: null,
      };
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
      /**
       * GoTrue's admin create. `createUserImpl` lets a test inject a failure, and
       * a duplicate email is refused the way Supabase refuses it, so the handler's
       * conflict branch can be exercised. The password is NEVER recorded: only
       * that a user was created.
       */
      createUser: async (attrs: {
        email: string;
        password?: string;
        email_confirm?: boolean;
        user_metadata?: unknown;
      }) => {
        this.calls.push({
          op: 'createUser',
          table: 'auth',
          arg: { email: attrs.email, email_confirm: attrs.email_confirm },
        });
        if (attrs.password !== undefined) this.passwordsSeen.push(attrs.password);
        if (this.createUserImpl) return this.createUserImpl(attrs);
        // GoTrue matches addresses case-insensitively; seeded pre-existing
        // accounts refuse exactly like live ones.
        const wanted = attrs.email.trim().toLowerCase();
        const taken =
          this.createdAuthEmails.has(attrs.email) ||
          this.seededAuthUsers.some((u) => u.email.trim().toLowerCase() === wanted);
        if (taken) {
          return {
            data: { user: null },
            error: authError('A user with this email address has already been registered'),
          };
        }
        this.createdAuthEmails.add(attrs.email);
        const id = this.createUserId ?? `created-auth-${this.createdAuthEmails.size}`;
        this.createdAuthUsers.push({ id, email: attrs.email });
        return {
          data: {
            user: {
              id,
              email: attrs.email,
              email_confirmed_at: attrs.email_confirm ? new Date().toISOString() : null,
            },
          },
          error: null,
        };
      },
      deleteUser: async (id: string) => {
        this.deletedAuthUsers.push(id);
        this.calls.push({ op: 'deleteUser', table: 'auth', arg: id });
        return { data: {}, error: null };
      },
      /**
       * GoTrue's admin user directory. Paginated like the live API
       * (`{ page, perPage }`, 1-based page); the recorded call carries only
       * the pagination, never the returned addresses.
       */
      listUsers: async (params?: { page?: number; perPage?: number }) => {
        const page = Math.max(1, params?.page ?? 1);
        const perPage = Math.min(1000, Math.max(1, params?.perPage ?? 50));
        this.calls.push({ op: 'listUsers', table: 'auth', arg: { page, perPage } });
        const users = this.authUsers().map((u) => ({ id: u.id, email: u.email }));
        return {
          data: { users: users.slice((page - 1) * perPage, page * perPage) },
          error: null,
        };
      },
      /**
       * GoTrue's admin password/metadata rotation. The secret is captured in
       * `passwordsSeen` only (the same test-only point as `createUser`); the
       * recorded call arg carries the id and non-secret flags so "no password
       * in logs/calls" assertions remain possible.
       */
      updateUserById: async (id: string, attrs: { password?: string; user_metadata?: unknown }) => {
        this.calls.push({
          op: 'updateUserById',
          table: 'auth',
          arg: { id, hasUserMetadata: attrs.user_metadata !== undefined },
        });
        if (attrs.password !== undefined) this.passwordsSeen.push(attrs.password);
        if (this.updateUserImpl) return this.updateUserImpl(id, attrs);
        return { data: { user: { id } }, error: null };
      },
    },
  };

  from(table: string) {
    // Directly appended synthetic rows also inherit the real column default.
    if (table === 'card_sales')
      for (const row of this.tables.card_sales ?? []) row.origin ??= 'normal';
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
      neq(col: string, val: unknown) {
        ops.push({ t: 'neq', col, val });
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
      ilike(col: string, pattern: string) {
        ops.push({ t: 'ilike', col, pattern });
        return this;
      },
      gte(col: string, val: unknown) {
        ops.push({ t: 'gte', col, val });
        return this;
      },
      lte(col: string, val: unknown) {
        ops.push({ t: 'lte', col, val });
        return this;
      },
      range(from: number, to: number) {
        ops.push({ t: 'range', from, to });
        return this;
      },
      order(col: string, opts?: { ascending?: boolean; referencedTable?: string }) {
        ops.push({
          t: 'order',
          col,
          asc: opts?.ascending !== false,
          reference: opts?.referencedTable,
        });
        return this;
      },
      limit(n: number, opts?: { referencedTable?: string }) {
        ops.push({ t: 'limit', n, reference: opts?.referencedTable });
        return this;
      },
      async maybeSingle() {
        // `insert().select().single()` is a write: the write error must surface,
        // not just the read result.
        const kind = hasWrite(ops) ? 'write' : 'select';
        const { data, error } = await run(kind);
        if (error) return { data: null, error, count: null };
        const rows = data ?? [];
        if (rows.length > 1) {
          return {
            data: null,
            error: authError('multiple rows returned for maybeSingle'),
            count: null,
          };
        }
        return { data: rows[0] ?? null, error: null };
      },
      async single() {
        const kind = hasWrite(ops) ? 'write' : 'select';
        const { data, error } = await run(kind);
        if (error) return { data: null, error, count: null };
        const rows = data ?? [];
        if (rows.length !== 1) {
          return { data: null, error: authError('expected exactly one row'), count: null };
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
      count: number | null;
    }> {
      const write = ops.find((o) => o.t === 'insert' || o.t === 'update' || o.t === 'delete');
      if (kind === 'write') {
        const werr = self.writeErrors[table];
        if (werr) return { data: null, error: { ...werr }, count: null };
      } else if (write === undefined) {
        const rerr = self.errors[table];
        if (rerr) return { data: null, error: { ...rerr }, count: null };
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
          if (clash) return { data: null, error: clash, count: null };
        }
        store.push(...withDefaults);
        return { data: withDefaults, error: null, count: null };
      }
      if (ops.some((o) => o.t === 'update')) {
        const op = ops.find((o) => o.t === 'update') as { t: 'update'; patch: FakeRow };
        const hit = store.filter((r) => matches(r, ops));
        for (const row of hit) {
          const clash = uniqueViolation(row, { ...row, ...op.patch });
          if (clash) return { data: null, error: clash, count: null };
        }
        for (const row of hit) Object.assign(row, op.patch);
        return { data: hit, error: null, count: null };
      }
      if (ops.some((o) => o.t === 'delete')) {
        const keep = store.filter((r) => !matches(r, ops));
        const removed = store.filter((r) => matches(r, ops));
        self.tables[table] = keep;
        return { data: removed, error: null, count: null };
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
      const orders = ops.filter((o) => o.t === 'order' && !o.reference) as {
        t: 'order';
        col: string;
        asc: boolean;
      }[];
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
        { t: 'range'; from: number; to: number } | undefined;
      const limit = [...ops].reverse().find((o) => o.t === 'limit' && !o.reference) as
        { t: 'limit'; n: number } | undefined;

      // PostgREST's `count: 'exact'` is the TOTAL number of matching rows, taken
      // BEFORE range/limit. Returning the page length instead makes every
      // pagination total wrong - and it was previously not returned at all, so
      // `meta.total` silently fell back to the page size.
      const totalMatching = out.length;

      if (range) out = out.slice(range.from, range.to + 1);
      if (limit) out = out.slice(0, limit.n);

      // Resolve embedded selects against the configured links. Both the
      // explicit `child!constraint(cols)` form and the bare `child(cols)`
      // form (resolved by PostgREST through the single FK) must attach -
      // gating on `'!'` left every bare embed as `undefined` in silence, so
      // handlers reading the embed were green while testing nothing.
      const selectOp = ops.find((o) => o.t === 'select') as
        { t: 'select'; cols: string; count: boolean } | undefined;
      if (selectOp) {
        out = out.map((row) => ({ ...row, ...self.embed(table, row, selectOp.cols, ops) }));
      }
      // Record the read shape (columns only, never row data) so tests can
      // assert a probe selected the column it filters on. A blocker probe
      // that selects a column its table does not have fails live with a 400
      // that surfaces as a 500 - this record is the tripwire for that class.
      self.calls.push({ op: 'select', table, arg: { cols: selectOp?.cols ?? '*' } });
      return {
        data: out,
        error: null,
        count: selectOp?.count === true ? totalMatching : null,
      };
    }

    return builder;
  }

  /**
   * Attach embedded relations to a parent row. Supports one level of
   * `alias:child!constraint(cols)` / `child!constraint(cols)` / `child(cols)`.
   */
  private embed(parent: string, row: FakeRow, cols: string, ops: Op[] = []): FakeRow {
    const attached: FakeRow = {};
    for (const spec of splitTopLevel(cols)) {
      if (!spec.includes('!') && !/\w+\(/.test(spec)) continue;
      const inner = spec.includes('(') ? spec.slice(0, spec.indexOf('(')) : spec;
      const [aliasRaw, targetRaw] = inner.split(':');
      // `alias:table!fk(cols)` names the key explicitly; a bare `table!fk(cols)`
      // or `table!inner(cols)` is keyed by the TABLE name. Using the whole
      // `table!inner` string as the key silently produced `undefined` on read.
      const hasAlias = targetRaw !== undefined;
      const bangIndex = inner.indexOf('!');
      const tableName = bangIndex === -1 ? inner : inner.slice(0, bangIndex);
      const alias = hasAlias ? (aliasRaw as string) : tableName;
      const target = hasAlias ? (targetRaw as string) : inner;
      // `table!inner(cols)` / `table!fk(cols)`. Without a constraint name the
      // embedded table may be EITHER side of the relation, so both directions are
      // tried: the current table holding the FK (parent side), or the embedded
      // table holding it (child side, a reverse one-to-one). Only looking one way
      // made a reverse embed resolve to `undefined` in silence, which is exactly
      // the kind of gap that lets a test pass without testing anything.
      const [embedTable, constraint] = target.split('!');
      const byName = (l: FakeLink) =>
        constraint && constraint !== 'inner'
          ? l.child === parent &&
            l.parent === embedTable &&
            `${l.child}_${l.fk}_fkey` === constraint
          : false;
      const asParent = (l: FakeLink) =>
        constraint && constraint !== 'inner'
          ? false
          : l.child === parent && l.parent === embedTable && row[l.fk] !== undefined;
      const asChild = (l: FakeLink) =>
        constraint && constraint !== 'inner'
          ? false
          : l.parent === parent && l.child === embedTable;
      const link = this.links.find((l) => byName(l) || asParent(l) || asChild(l));
      if (!link) continue;
      const parentSide = link.parent === embedTable;
      const childLimit = ops.find((op) => op.t === 'limit' && op.reference === alias);
      if (!parentSide && childLimit?.t === 'limit') {
        const embeddedError = this.errors[embedTable!];
        if (embeddedError) throw new Error(embeddedError.message);
        const filters: Op[] = ops.flatMap((op) =>
          'col' in op && op.col.startsWith(alias + '.')
            ? [{ ...op, col: op.col.slice(alias.length + 1) }]
            : [],
        );
        const orders = ops.filter((op) => op.t === 'order' && op.reference === alias);
        const children = (this.tables[link.child] ?? [])
          .filter((child) => child[link.fk] === row[link.pk ?? 'id'] && matches(child, filters))
          .sort((a, b) => {
            for (const order of orders) {
              if (order.t !== 'order' || a[order.col] === b[order.col]) continue;
              const cmp = a[order.col]! > b[order.col]! ? 1 : -1;
              return order.asc ? cmp : -cmp;
            }
            return 0;
          });
        attached[alias] = children.slice(0, childLimit.n);
        continue;
      }
      const match = parentSide
        ? // Embedded table is the PARENT: this row holds the FK.
          (this.tables[link.parent] ?? []).find((r) => r[link.pk ?? 'id'] === row[link.fk])
        : // Embedded table is the CHILD: it holds the FK pointing back here.
          (this.tables[link.child] ?? []).find((r) => r[link.fk] === row[link.pk ?? 'id']);
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
    // Directory behavior is a handler fixture only; real SQL is separately executed.
    if (!entry && fn === 'match_import_emails') {
      const emails = Array.isArray(args.p_emails)
        ? args.p_emails.map((e) => String(e).toLowerCase())
        : [];
      return {
        data: (this.tables.customers ?? [])
          .filter((c) => emails.includes(String(c.email).toLowerCase()))
          .map((c) => ({ id: c.id, email: c.email })),
        error: null,
      };
    }
    if (!entry && fn === 'customer_directory') {
      const filters = z.record(z.string(), z.unknown()).parse(args.p_filters ?? {});
      let records = (this.tables.customers ?? [])
        .map((c): FakeRow => {
          const m = (this.tables.memberships ?? []).find((m) => m.customer_id === c.id);
          const sale = (this.tables.card_sales ?? [])
            .filter((s) => s.customer_id === c.id && s.status !== 'cancelled')
            .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
          const paid = (this.tables.payments ?? [])
            .filter((p) => p.sale_id === sale?.id && p.status === 'verified')
            .reduce((sum, p) => addMoney(sum, String(p.amount)), '0.00');
          const memberStatus =
            m?.status === 'active' && m.expires_at && Date.parse(String(m.expires_at)) <= Date.now()
              ? 'expired'
              : m?.status;
          const category = resolveCustomerCategory({
            customerStatus: String(c.status),
            membershipStatus: memberStatus ? String(memberStatus) : null,
            verifiedTotal: paid,
            priceTotal: String(sale?.cash_price_snapshot ?? '0.00'),
            reservationFee: String(sale?.reservation_fee_snapshot ?? '0.00'),
            requiredInitial: String(sale?.required_initial_snapshot ?? '0.00'),
          });
          const plan = (this.tables.card_plans ?? []).find(
            (p) => p.id === m?.product_id || p.id === sale?.plan_id,
          );
          return {
            ...c,
            full_name: [c.first_name, c.middle_name, c.last_name, c.suffix]
              .filter(Boolean)
              .join(' '),
            derivedCategory: category,
            tier: plan?.code,
            memberships: m ?? null,
            membership_id: m?.id,
            member_status: m?.status,
            membership_number: m?.membership_number,
            expires_at: m?.expires_at,
            activated_at: m?.activated_at,
            available_points:
              (this.tables.points_accounts ?? []).find((p) => p.membership_id === m?.id)?.balance ??
              0,
            seller_name:
              (this.tables.staff_users ?? []).find((p) => p.id === sale?.seller_staff_id)
                ?.full_name ?? '',
            payment_status:
              paid === '0.00'
                ? 'no_payment'
                : Number(paid) >= Number(sale?.cash_price_snapshot ?? 0)
                  ? 'fully_paid'
                  : 'partially_paid',
            verified_paid: paid,
          };
        })
        .filter(
          (r) =>
            (!filters.status || r.status === filters.status) &&
            (!filters.category || r.derivedCategory === filters.category) &&
            (!filters.tier || r.tier === filters.tier) &&
            (!filters.membersOnly || r.membership_id) &&
            (!filters.search ||
              [r.full_name, r.customer_number, r.membership_number, r.email].some((v) =>
                String(v ?? '')
                  .toLowerCase()
                  .includes(String(filters.search).toLowerCase()),
              )),
        );
      const total = records.length;
      records = records.slice(
        Number(filters.offset ?? 0),
        Number(filters.offset ?? 0) + Number(filters.limit ?? 50),
      );
      return { data: records.map((record) => ({ record, total_count: total })), error: null };
    }
    if (!entry) return { data: null, error: { code: '42883', message: `${fn} does not exist` } };
    return {
      data: typeof entry.result === 'function' ? entry.result(args) : entry.result,
      error: null,
    };
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
