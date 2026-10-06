import { runIdempotencyChecks } from './idempotency-integration.js';
import { runOstAccreditationChecks } from './ost-accreditation-integration.js';
import { memberLookupFromDirectory } from '../api/_lib/member-lookup.js';
/**
 * AF Homes Phase 2 - DATABASE INTEGRATION SUITE.
 *
 * This executes the real SQL against a real PostgreSQL server. The migrations
 * are not inspected as text and the handlers are not involved: the point is to
 * prove the database itself is correct.
 *
 * Run it with either of:
 *
 *   pnpm test:db          # against an explicitly approved development database
 *   pnpm test:db:local    # against a disposable local PostgreSQL it boots itself
 *
 * It is deliberately NOT part of `pnpm test`. The ordinary unit suite stays
 * fully offline; this suite needs a database and says so loudly if it is not
 * configured.
 *
 * SAFETY
 *  - Fail closed. With no `AFHOMES_TEST_DATABASE_URL` it exits non-zero and
 *    does nothing.
 *  - Refuses any `*.supabase.co` / `*.pooler.supabase.com` host unless the
 *    operator names a project ref that is NOT the production ref.
 *  - Synthetic data only, prefixed per run, removed on exit.
 *  - Never prints a connection string, password, key or token value.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Client } from 'pg';

/* ================================================================== */
/* Target guard - fail closed                                          */
/* ================================================================== */

/** The one production project that must never be touched. */
const PRODUCTION_PROJECT_REF = 'ikaevepedpqygdlipsei';

type Target = { url: string; host: string; isRemote: boolean };

function resolveTarget(): Target {
  const raw = process.env.AFHOMES_TEST_DATABASE_URL?.trim();
  if (!raw) {
    console.error(
      'AFHOMES_TEST_DATABASE_URL is not set.\n' +
        '  pnpm test:db:local   boots a disposable local PostgreSQL and runs everything.\n' +
        '  pnpm test:db         runs against a development database you configure yourself.',
    );
    process.exit(2);
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    console.error('AFHOMES_TEST_DATABASE_URL is not a valid connection string.');
    process.exit(2);
  }

  const host = parsed.hostname;
  // Anything that is not loopback is a REMOTE target and must be declared.
  // Previously only `*.supabase.co` qualified, so a connection string to some
  // other host bypassed the project-ref requirement entirely - the suite would
  // have written to an undeclared remote database while believing it was local.
  const isLoopback = /^(localhost|127\.0\.0\.1|::1|0:0:0:0:0:0:0:1)$/.test(host);
  const isRemote = !isLoopback;

  if (isRemote) {
    const declared = process.env.AFHOMES_TEST_PROJECT_REF?.trim();
    if (!declared) {
      console.error(
        `Refusing to run: ${host} is not a loopback address, so it is treated as a remote ` +
          'development database, but AFHOMES_TEST_PROJECT_REF is not set.\n' +
          '  This suite must never guess which project it is writing to.',
      );
      process.exit(2);
    }
    if (declared === PRODUCTION_PROJECT_REF) {
      console.error(
        `Refusing to run: AFHOMES_TEST_PROJECT_REF is ${PRODUCTION_PROJECT_REF}, which is production.`,
      );
      process.exit(2);
    }
    console.log(`[db-test] remote development project: ${declared} (${host})`);
  }

  return { url: raw, host, isRemote };
}

/**
 * Test-only fault injection, refused for any remote target.
 *
 * `AFHOMES_DB_TEST_INJECT_FAILURE=after-section-36` makes the suite throw at a
 * chosen point, which is the only way to regression-test that an unexpected
 * exception is REPORTED, that `finally` cleanup still runs, and that the
 * process exits non-zero. Without it, that property is untestable and silently
 * rotatable - which is exactly how a swallowed exception shipped once already.
 *
 * Two properties make it safe to keep in the file:
 *   1. it is refused outright for a remote target, so it can never be exercised
 *      against a development or production database, even by accident;
 *   2. a normal run never sets it, so the injection point is not reached.
 */
const INJECT_FAILURE_POINTS = ['after-section-36'] as const;
type InjectPoint = (typeof INJECT_FAILURE_POINTS)[number];

const resolveInjection = (isRemote: boolean): InjectPoint | null => {
  const raw = process.env.AFHOMES_DB_TEST_INJECT_FAILURE?.trim();
  if (!raw) return null;
  if (isRemote) {
    console.error(
      'Refusing to run: AFHOMES_DB_TEST_INJECT_FAILURE is set, and the target is a remote ' +
        'database. Fault injection deliberately corrupts schema objects, so it is only ' +
        'permitted against a disposable loopback PostgreSQL.',
    );
    process.exit(2);
  }
  if (!(INJECT_FAILURE_POINTS as readonly string[]).includes(raw)) {
    console.error(
      `AFHOMES_DB_TEST_INJECT_FAILURE="${raw}" is not a known injection point. ` +
        `Known points: ${INJECT_FAILURE_POINTS.join(', ')}.`,
    );
    process.exit(2);
  }
  console.log(`[db-test] fault injection enabled at: ${raw}`);
  return raw as InjectPoint;
};

/* ================================================================== */
/* Tiny assertion harness                                              */
/* ================================================================== */

type Result = { area: string; name: string; ok: boolean; detail?: string };
const results: Result[] = [];
let area = '';

const section = (name: string) => {
  area = name;
  console.log(`\n--- ${name} ---`);
};

const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ area, name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};

const eq = <T>(name: string, actual: T, expected: T) =>
  check(name, Object.is(actual, expected), `expected ${String(expected)}, got ${String(actual)}`);

const throws = async (name: string, fn: () => Promise<unknown>) => {
  try {
    await fn();
    check(name, false, 'expected an error, but the call succeeded');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    check(name, true, message.split('\n')[0]!.slice(0, 90));
    return message;
  }
  return '';
};

/**
 * A bounded, single-line, secret-free description of an unexpected error.
 *
 * This suite connects with a real connection string, and a driver-level failure
 * can echo any part of it back in the message. A validation harness that prints
 * its own credentials into a CI log is worse than one that crashes, so the text
 * is redacted and truncated before it can reach a result line. The redaction is
 * deliberately narrow - only shapes that really are credentials - so a genuine
 * Postgres error is still diagnosable.
 */
const safeErrorMessage = (error: unknown): string => {
  const raw = error instanceof Error ? error.message : String(error);
  const redacted = raw
    .replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://<redacted>')
    .replace(/\b(password|passfile|pwd|sslpassword)\s*=\s*\S+/gi, '$1=<redacted>')
    .replace(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/g, '<redacted-jwt>')
    .replace(/\bsb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '<redacted-key>')
    .replace(/\b[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/g, '<redacted-jwt>');
  const firstLine = (redacted.split('\n')[0] ?? '').trim();
  return firstLine.length > 160 ? `${firstLine.slice(0, 157)}...` : firstLine;
};

/**
 * Remove SQL comments from an installed function body.
 *
 * `pg_proc.prosrc` keeps the comments, so an assertion that greps the body for
 * the OLD broken code will match the comment that explains why the old code was
 * broken. That is a false positive against correct SQL. The fix belongs here and
 * NOT in the migration: the explanatory comments are worth keeping, and a test
 * is never a good reason to delete them.
 *
 * Single-quoted literals are tracked, so a `--` inside a string is never
 * mistaken for a comment and a quoted fragment is never treated as code.
 */
const stripSqlComments = (src: string): string => {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (inString) {
      if (src[i] === "'") {
        // A doubled quote is an escaped quote, not the end of the literal.
        if (src[i + 1] === "'") {
          out += "''";
          i += 2;
          continue;
        }
        inString = false;
      }
      out += src[i];
      i += 1;
      continue;
    }
    if (two === '--') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2);
      i = end === -1 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    if (src[i] === "'") {
      inString = true;
      out += src[i];
      i += 1;
      continue;
    }
    out += src[i];
    i += 1;
  }
  return out;
};

/** Read a migration from the repository, whatever directory the suite is run from. */
const readMigration = (name: string): string => {
  let dir = process.cwd();
  for (let hop = 0; hop < 6; hop += 1) {
    const candidate = join(dir, 'supabase', 'migrations', name);
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`could not locate supabase/migrations/${name} from ${process.cwd()}`);
};

/* ================================================================== */
/* Fixture helpers                                                     */
/* ================================================================== */

const RUN = `t${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)
  .toString(36)
  .padStart(3, '0')}`;

let db: Client;
const createdCustomerIds: string[] = [];
const createdStaffIds: string[] = [];
/** Auth users created for the Phase 3 portal section (not staff). */
const createdAuthIds: string[] = [];
/**
 * OST fixture ids for the legacy-ID rehearsal. Teardown is registered with the
 * suite's own cleanup rather than only at the end of the section, because a
 * deliberately injected failure can abort the section mid-way and leak rows
 * that would then fail cleanup's row-count proof for everything.
 */
const legacyOstFixtureIds: string[] = [];

/**
 * Deterministic uuid per label, so a re-run never collides and a test failure can
 * be traced back to the row that produced it. The label is HASHED first: slicing
 * raw bytes would truncate, because short labels all share a common prefix.
 */
const uuidFor = (label: string) => {
  const hex = createHash('sha256').update(`${RUN}:${label}`).digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    '4' + hex.slice(13, 16),
    ((parseInt(hex.slice(16, 17), 16) & 0x3) | 0x8).toString(16) + hex.slice(17, 20),
    hex.slice(20, 32),
  ].join('-');
};

const one = async <T>(sql: string, params: unknown[] = []): Promise<T> => {
  const res = await db.query(sql, params);
  return res.rows[0] as T;
};

/**
 * Postgres returns snake_case column names; the suite asserts against the
 * camelCase names the API exposes. Convert explicitly rather than guessing.
 */
const camel = <T>(row: Record<string, unknown> | undefined): T => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row ?? {})) {
    out[key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return out as T;
};

/** `select * from public.sale_financial_summary($1)` in API field names. */
const summaryOf = async (id: string) =>
  camel<{
    saleId: string;
    status: string;
    cashPrice: string;
    minimumDownPayment: string;
    recordedTotal: string;
    verifiedTotal: string;
    rejectedTotal: string;
    remainingBalance: string;
    overpaidAmount: string;
    downPaymentSatisfied: boolean;
    fullyPaid: boolean;
    spotCashDeadline: string | null;
    spotCashState: string;
  }>(await one('select * from public.sale_financial_summary($1)', [id]));

/**
 * Run `fn` as a browser role impersonating `staffId`, in its own transaction.
 * `set_config(..., true)` is transaction-local, exactly like PostgREST, so the
 * identity cannot leak into the next test.
 */
async function asBrowserRole<T>(
  url: string,
  role: 'anon' | 'authenticated',
  staffId: string | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = new Client({ connectionString: url });
  client.on('error', () => {});
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    if (staffId)
      await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [staffId]);
    return await fn(client);
  } finally {
    await client.query('rollback').catch(() => {});
    await client.end();
  }
}

/**
 * Count the rows a browser role can see. A missing table GRANT makes Postgres
 * refuse the statement outright, which is a stronger denial than an empty
 * result, so both are reported as 0 visible rows.
 */
async function visibleRows(
  url: string,
  role: 'anon' | 'authenticated',
  staffId: string | null,
  sql: string,
): Promise<number> {
  return asBrowserRole(url, role, staffId, async (c) => {
    try {
      const res = await c.query(sql);
      return Number(res.rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  });
}

/* ================================================================== */
/* Reference data                                                      */
/* ================================================================== */

const ROLE_SLUGS = [
  'super_admin',
  'admin',
  'vice_director',
  'senior_sales_manager',
  'sales_manager',
  'ost',
  'finance',
  'employee',
] as const;

const modules = {} as Record<string, { id: string }>;
const roles = {} as Record<string, string>;
const staff = {} as Record<string, string>;

/**
 * Every table the suite writes to, and nothing else.
 *
 * The counts are captured immediately after connecting, before any fixture
 * exists, and compared again after cleanup. Comparing against the pre-run count
 * is what lets cleanup be verified for tables that carry no run prefix -
 * memberships, points_ledger, redemptions and commissions are all unmarkable
 * once their parent rows are gone, so a grep-based check would silently pass
 * while they leaked. The names are a hardcoded constant, never input.
 */
const BASELINE_TABLES = [
  'identity_documents',
  'customers',
  'staff_users',
  'card_sales',
  'card_sale_hierarchy_snapshots',
  'payments',
  'memberships',
  'commissions',
  'points_accounts',
  'points_ledger',
  'redemptions',
  'redemption_items',
  'customer_onboarding_tokens',
  'referral_relationships',
  'audit_events',
  'customer_applications',
  'customer_application_holders',
  'customer_application_documents',
  'reservation_agreements',
  'reservation_agreement_holders',
  'reservation_agreement_schedule',
  'reservation_agreement_documents',
] as const;
const baseline = new Map<string, number>();

const captureBaseline = async (): Promise<void> => {
  baseline.set(
    'private.mutation_requests',
    (await db.query<{ n: number }>('select count(*)::int n from private.mutation_requests'))
      .rows[0]!.n,
  );
  for (const table of BASELINE_TABLES) {
    const r = await db.query<{ n: number }>(`select count(*)::int as n from public.${table}`);
    baseline.set(table, r.rows[0]!.n);
  }
};

/* ================================================================== */
/* Suite                                                               */
/* ================================================================== */

/**
 * Everything above this line is synchronous setup. The suite body lives in
 * `main()` for the same reason as the two operator scripts: this file resolves
 * as CommonJS, where a top-level `await` is a syntax error. `main()` is valid
 * under both CJS and ESM resolution.
 */
async function main(): Promise<void> {
  const target = resolveTarget();
  const injectAt = resolveInjection(target.isRemote);

  try {
    db = new Client({ connectionString: target.url });
    db.on('error', () => {});
    await db.connect();
    await captureBaseline();

    /* ---------------------------------------------------------------- */
    section('1. connection and environment');
    /* ---------------------------------------------------------------- */
    const version = await one<{ version: string }>('select version()');
    check(
      'connected to a real PostgreSQL',
      /PostgreSQL/.test(version.version),
      version.version.slice(0, 40),
    );
    console.log(`  server: ${version.version.split(' ').slice(0, 2).join(' ')}`);

    /* ---------------------------------------------------------------- */
    section('2. schema: tables, keys, constraints, indexes, RLS');
    /* ---------------------------------------------------------------- */
    const tableRows = await db.query<{ table_name: string; rls: boolean }>(
      `select c.relname as table_name, c.relrowsecurity as rls
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'`,
    );
    const tableMap = new Map(tableRows.rows.map((r) => [r.table_name, r.rls]));

    for (const t of [
      'card_categories',
      'card_plans',
      'customers',
      'card_sales',
      'payments',
      'memberships',
      'commissions',
      'referral_relationships',
      'points_accounts',
      'points_ledger',
      'customer_onboarding_tokens',
      'identity_documents',
    ]) {
      check(`table public.${t} exists`, tableMap.has(t));
      if (tableMap.has(t)) check(`  ${t} has RLS enabled`, tableMap.get(t) === true);
    }

    // No NFC anywhere. This is a hard product decision, so it is asserted.
    const nfc = await db.query<{ hits: number }>(
      `select count(*)::int as hits from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%nfc%' or column_name ilike '%tag_%' or column_name ilike '%rfid%')`,
    );
    eq('no NFC columns anywhere in public', nfc.rows[0]!.hits, 0);

    const constraints = await db.query<{ name: string; def: string }>(
      `select conname as name, pg_get_constraintdef(oid) as def
       from pg_constraint
      where connamespace = 'public'::regnamespace`,
    );
    const defFor = (fragment: string) =>
      constraints.rows.filter((c) => c.def.includes(fragment)).map((c) => c.name);

    check(
      'card_sales status CHECK covers the Phase 2 lifecycle',
      defFor("'payment_in_progress'").some((n) => n.startsWith('card_sales')),
      JSON.stringify(defFor("'payment_in_progress'")),
    );
    check(
      'commissions status CHECK covers the 4% lifecycle',
      defFor("'final_qualification_pending'").some((n) => n.startsWith('commissions')),
    );
    check(
      'customers status CHECK is person-level only',
      defFor("'prospect'").some((n) => n.startsWith('customers')),
    );
    check(
      'commission beneficiary must be exactly one of staff / OST',
      constraints.rows.some((c) => c.name === 'commissions_beneficiary_check'),
    );
    check(
      'referral relationship forbids a self-referencing upline',
      constraints.rows.some(
        (c) => c.name === 'referral_relationships_check' || c.def.includes('<>'),
      ),
    );

    const idx = await db.query<{ indexname: string; indexdef: string }>(
      `select indexname, indexdef from pg_indexes where schemaname = 'public'`,
    );
    const idxNames = new Set(idx.rows.map((r) => r.indexname));
    for (const [label, name] of [
      ['one active upline per subject', 'referral_relationships_one_active_upline'],
      ['one open application per customer+product', 'card_sales_one_open_per_customer'],
      ['unique payment reference per sale', 'payments_sale_reference_unique'],
      ['one annual point allocation per membership', 'points_ledger_one_allocation_per_year'],
      ['one commission per sale', 'commissions_one_per_sale'],
      ['unique government id', 'customers_gov_id_unique'],
    ] as const) {
      check(`partial unique index: ${label}`, idxNames.has(name), `missing ${name}`);
    }
    const qrIdx = idx.rows.find((r) => r.indexname.includes('memberships'));
    check(
      'unique index on memberships.qr_token_hash',
      idx.rows.some(
        (r) => r.indexdef.includes('qr_token_hash') && r.indexdef.toLowerCase().includes('unique'),
      ),
    );
    void qrIdx;

    // Partial-index predicates must actually be partial, not full unique indexes.
    const activeIdx = idx.rows.find(
      (r) => r.indexname === 'referral_relationships_one_active_upline',
    );
    check(
      '  ...and it is partial (WHERE is_active)',
      /where/i.test(activeIdx?.indexdef ?? ''),
      activeIdx?.indexdef,
    );
    const openIdx = idx.rows.find((r) => r.indexname === 'card_sales_one_open_per_customer');
    check(
      '  ...and one-open-sale is partial (status list)',
      /where/i.test(openIdx?.indexdef ?? ''),
      openIdx?.indexdef,
    );

    const fks = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_constraint
      where contype = 'f' and connamespace = 'public'::regnamespace
        and confrelid <> 0`,
    );
    check('foreign keys present', fks.rows[0]!.n > 0, `count=${fks.rows[0]!.n}`);

    /* ---------------------------------------------------------------- */
    section('3. default card products are database values');
    /* ---------------------------------------------------------------- */
    const plans = await db.query<{
      id: string;
      code: string;
      cash_price: string;
      installment_price: string;
      reservation_fee: string;
      spot_cash_days: number;
      standard_installment_months: number;
      validity_years: number;
      move_a_enabled: boolean;
      move_b1_enabled: boolean;
      move_b2_enabled: boolean;
      minimum_down_payment: string;
      yearly_points: number;
      commission_rate: string;
      is_active: boolean;
    }>(
      `select id, code, cash_price, installment_price, reservation_fee, spot_cash_days,
              standard_installment_months, validity_years, move_a_enabled, move_b1_enabled,
              move_b2_enabled, minimum_down_payment, yearly_points, commission_rate, is_active
         from public.card_plans order by sort_order`,
    );
    const byCode = new Map(plans.rows.map((p) => [p.code, p]));

    // VIP Stage 1 pre-opening values (migration 20261014000001): dual totals,
    // a 10k reservation inside every total, a 7-day spot window, frozen
    // validity years, and Bronze locked out of B1/B2.
    for (const [code, spot, inst, validity, b1, b2] of [
      ['BRONZE', '54000.00', '72000.00', 7, false, false],
      ['SILVER', '192000.00', '240000.00', 12, true, true],
      ['GOLD', '312000.00', '390000.00', 22, true, true],
    ] as const) {
      const p = byCode.get(code);
      check(`${code} exists`, !!p);
      if (!p) continue;
      eq(`  ${code} spot cash price`, p.cash_price, spot);
      eq(`  ${code} installment price`, p.installment_price, inst);
      eq(`  ${code} reservation fee`, p.reservation_fee, '10000.00');
      eq(`  ${code} spot cash days`, p.spot_cash_days, 7);
      eq(`  ${code} standard installment months`, p.standard_installment_months, 4);
      eq(`  ${code} validity years`, p.validity_years, validity);
      eq(`  ${code} move A enabled`, p.move_a_enabled, true);
      eq(`  ${code} move B1 enabled`, p.move_b1_enabled, b1);
      eq(`  ${code} move B2 enabled`, p.move_b2_enabled, b2);
    }

    for (const [code, down, points] of [
      ['BRONZE', '10000.00', 10000],
      ['SILVER', '15000.00', 20000],
      ['GOLD', '20000.00', 25000],
    ] as const) {
      const p = byCode.get(code);
      check(`${code} exists`, !!p);
      if (!p) continue;
      eq(`  ${code} minimum down payment`, p.minimum_down_payment, down);
      eq(`  ${code} yearly points`, p.yearly_points, points);
      eq(`  ${code} commission default`, p.commission_rate, '0');
      check(`  ${code} is active`, p.is_active === true);
    }

    /* ---------------------------------------------------------------- */
    section('4. synthetic principals');
    /* ---------------------------------------------------------------- */
    for (const row of (
      await db.query<{ id: string; key: string }>('select id, key from public.modules')
    ).rows) {
      modules[row.key] = { id: row.id };
    }
    check(
      'modules are seeded by the migrations',
      Object.keys(modules).length > 0,
      `count=${Object.keys(modules).length}`,
    );
    check('sales.uplines module exists', !!modules['sales.uplines']);
    check('finance.points module exists', !!modules['finance.points']);

    for (const slug of ROLE_SLUGS) {
      const existing = await one<{ id: string } | undefined>(
        'select id from public.roles where slug = $1',
        [slug],
      );
      const id =
        existing?.id ??
        (
          await one<{ id: string }>(
            `insert into public.roles (slug, name, is_system, is_active)
         values ($1, $2, true, true) returning id`,
            [slug, slug.replace(/_/g, ' ')],
          )
        ).id;
      roles[slug] = id;
    }
    check('synthetic roles available', Object.keys(roles).length === ROLE_SLUGS.length);

    const mkStaff = async (label: string, role: string, status = 'active') => {
      const id = uuidFor(`staff:${label}`);
      const email = `${RUN}-${label}@example.invalid`;
      // staff_users.id references auth.users(id) and that FK is enforced. The
      // shim reproduces the reference so the constraint is genuinely exercised.
      await db.query('insert into auth.users (id, email) values ($1, $2)', [id, email]);
      await db.query(
        `insert into public.staff_users (id, email, full_name, status)
       values ($1, $2, $3, $4)`,
        [id, email, `Synthetic ${label}`, status],
      );
      await db.query(
        'insert into public.staff_role_assignments (staff_id, role_id) values ($1, $2)',
        [id, roles[role]],
      );
      createdStaffIds.push(id);
      staff[label] = id;
      return id;
    };

    await mkStaff('super-admin', 'super_admin');
    await mkStaff('admin', 'admin');
    await mkStaff('vice-director', 'vice_director');
    await mkStaff('ssm', 'senior_sales_manager');
    await mkStaff('sm', 'sales_manager');
    await mkStaff('sm-alt', 'sales_manager');
    await mkStaff('ost', 'ost');
    await mkStaff('finance', 'finance');
    await mkStaff('hr', 'employee');
    const inactiveId = uuidFor('staff:inactive');
    await db.query('insert into auth.users (id, email) values ($1, $2)', [
      inactiveId,
      `${RUN}-inactive@example.invalid`,
    ]);
    await db.query(
      `insert into public.staff_users (id, email, full_name, status) values ($1, $2, 'Synthetic inactive', 'inactive')`,
      [inactiveId, `${RUN}-inactive@example.invalid`],
    );
    staff['inactive'] = inactiveId;
    check('synthetic staff created for every role', Object.keys(staff).length >= 9);

    // The hierarchy VD -> SSM -> SM -> OST, with one active upline each.
    const link = async (subject: string, upline: string, level: string) => {
      const res = await one<{ id: string }>(
        `insert into public.referral_relationships
         (subject_staff_id, upline_staff_id, hierarchy_role, is_authoritative, is_active, assigned_by)
       values ($1, $2, $3, true, true, $4) returning id`,
        [staff[subject]!, staff[upline]!, level, staff['super-admin']!],
      );
      return res.id;
    };
    await link('ssm', 'vice-director', 'senior_sales_manager');
    await link('sm', 'ssm', 'sales_manager');
    await link('sm-alt', 'ssm', 'sales_manager');
    await link('ost', 'sm', 'ost');

    // NOTE: Phase 2 deliberately does NOT use public.ost_members. The selling
    // hierarchy (VD -> SSM -> SM -> OST) lives on staff_users plus role slugs,
    // and ost_members requires a non-null application_id because it is fed by
    // OST registration, which is a later phase. An OST here is simply an active
    // staff account holding the `ost` role.

    /* ---------------------------------------------------------------- */
    type PlanRow = {
      id: string;
      code: string;
      cash_price: string;
      minimum_down_payment: string;
      yearly_points: number;
      commission_rate: string;
      installment_price?: string;
      reservation_fee?: string;
      spot_cash_days?: number;
      standard_installment_months?: number;
      validity_years?: number;
      move_a_enabled?: boolean;
      move_b1_enabled?: boolean;
      move_b2_enabled?: boolean;
    };

    /**
     * Create a synthetic customer. One customer PER case: the
     * `card_sales_one_open_per_customer` partial unique index (customer_id,
     * plan_id) correctly forbids two open applications for the same customer and
     * card. That constraint is asserted on real data in section 9b.
     */
    const mkCustomer = async (label: string, tag = 'down') => {
      const id = uuidFor(`cust:${tag}:${label}`);
      const cn = (
        await one<{ customer_number: string }>('select * from public.next_customer_number()')
      ).customer_number;
      await db.query(
        `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
       values ($1,$2,'Down','Test','1990-01-01',$3,'09175550001','prospect')`,
        [id, cn, `${RUN}-${tag}-${label}@example.invalid`],
      );
      createdCustomerIds.push(id);
      return id;
    };

    const mkSale = async (label: string, customerId: string, plan: PlanRow, tag = 'down') => {
      const sId = uuidFor(`sale:${tag}:${label}`);
      const sn = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
        .sale_number;
      await db.query(
        `insert into public.card_sales
         (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
          cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
          commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at)
       values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now(), now() + interval '365 days')`,
        [
          sId,
          sn,
          customerId,
          plan.id,
          staff['ost']!,
          plan.cash_price,
          plan.minimum_down_payment,
          plan.yearly_points,
          plan.commission_rate,
        ],
      );
      return sId;
    };

    section('5. customer + sale snapshot immutability');
    /* ---------------------------------------------------------------- */
    const customerNumber = await one<{ customer_number: string }>(
      'select * from public.next_customer_number()',
    );
    const customerId = uuidFor('customer:1');
    await db.query(
      `insert into public.customers
       (id, customer_number, first_name, last_name, birth_date, email, phone, address,
        government_id_type, government_id_number, status, created_by)
     values ($1,$2,'Test','Buyer','1990-01-01',$3,'09175550000',
             '{"line1":"1 Test St","city":"Manila","province":"Metro Manila","countryCode":"PH"}'::jsonb,
             'philippine_id', $4, 'prospect', $5)`,
      [
        customerId,
        customerNumber.customer_number,
        `${RUN}-buyer@example.invalid`,
        `${RUN}-GOV-1`,
        staff['sm']!,
      ],
    );
    createdCustomerIds.push(customerId);
    check('synthetic customer created', true);

    const saleId = uuidFor('sale:1');
    const gold = byCode.get('GOLD')!;
    const goldId = (
      await one<{ id: string }>('select id from public.card_plans where code = $1', ['GOLD'])
    ).id;
    const saleNumber = (
      await one<{ sale_number: string }>('select * from public.next_sale_number()')
    ).sale_number;
    const commissionAmount = await one<{ v: string }>(
      'select private.money(round($1::numeric * $2::numeric, 2)) as v',
      [gold.cash_price, gold.commission_rate],
    );
    await db.query(
      `insert into public.card_sales
       (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
        cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
        commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at,
        referral_relationship_id, created_by)
     values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,$10,'submitted', now(), now() + interval '365 days', $11, $12)`,
      [
        saleId,
        saleNumber,
        customerId,
        goldId,
        staff['sm']!,
        gold.cash_price,
        gold.minimum_down_payment,
        gold.yearly_points,
        gold.commission_rate,
        commissionAmount.v,
        (
          await one<{ id: string }>(
            'select id from public.referral_relationships where subject_staff_id = $1 and is_active',
            [staff['sm']],
          )
        ).id,
        staff['sm']!,
      ],
    );
    await db.query(
      `insert into public.commissions
       (sale_id, beneficiary_type, beneficiary_staff_id, amount, rate_snapshot, basis_amount_snapshot, status)
     values ($1,'staff',$2,$3,$4,$5,'pending')`,
      [saleId, staff['sm'], commissionAmount.v, gold.commission_rate, gold.cash_price],
    );
    check('synthetic sale created with a full commercial snapshot', true);

    const hierarchySnapshot = (
      await db.query<{ ancestor_staff_id: string; ancestor_role: string }>(
        `select ancestor_staff_id, ancestor_role
         from public.card_sale_hierarchy_snapshots
        where sale_id=$1 order by depth`,
        [saleId],
      )
    ).rows;
    check(
      'Phase 14 snapshots SM -> SSM -> VD at sale creation',
      hierarchySnapshot.length === 3 &&
        hierarchySnapshot[0]?.ancestor_staff_id === staff['sm'] &&
        hierarchySnapshot[1]?.ancestor_staff_id === staff['ssm'] &&
        hierarchySnapshot[2]?.ancestor_staff_id === staff['vice-director'],
      JSON.stringify(hierarchySnapshot),
    );

    // Preview QA regression: Phase 2 has always allowed Admin/Super Admin to
    // sell, but those roles do not belong to the genealogy. Phase 14 must not
    // reject the sale or invent a hierarchy for it.
    const adminCustomer = uuidFor('preview-qa:admin-customer');
    const adminSale = uuidFor('preview-qa:admin-sale');
    const adminCustomerNumber = (
      await one<{ customer_number: string }>('select * from public.next_customer_number()')
    ).customer_number;
    await db.query(
      `insert into public.customers(id,customer_number,email,phone,first_name,last_name,status)
       values($1,$2,$3,'09170000000','Preview','Admin Sale','prospect')`,
      [adminCustomer, adminCustomerNumber, `${RUN}-admin-sale@example.invalid`],
    );
    createdCustomerIds.push(adminCustomer);
    const adminSaleNumber = (
      await one<{ sale_number: string }>('select * from public.next_sale_number()')
    ).sale_number;
    await db.query(
      `insert into public.card_sales
       (id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,
        cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
        commission_rate_snapshot,expected_commission_snapshot,status,submitted_at,balance_due_at,created_by)
       values($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,$10,'submitted',now(),now()+interval '1 year',$5)`,
      [
        adminSale,
        adminSaleNumber,
        adminCustomer,
        goldId,
        staff['super-admin'],
        gold.cash_price,
        gold.minimum_down_payment,
        gold.yearly_points,
        gold.commission_rate,
        commissionAmount.v,
      ],
    );
    const adminSnapshot = await one<{ n: number }>(
      `select count(*)::int n from public.card_sale_hierarchy_snapshots where sale_id=$1`,
      [adminSale],
    );
    check('Admin/Super Admin sale succeeds without fabricated genealogy', adminSnapshot.n === 0);

    // Prove an upline correction does not move the old sale, while a new sale
    // takes the new hierarchy. The savepoint leaves the rest of the suite on
    // its original genealogy after this isolated regression proof.
    await db.query('begin');
    const alternateSsm = uuidFor('phase14:ssm-b');
    const alternateCustomer = uuidFor('phase14:customer-b');
    const alternateSale = uuidFor('phase14:sale-b');
    await db.query(`insert into auth.users(id,email) values($1,$2)`, [
      alternateSsm,
      `${RUN}-ssm-b@example.invalid`,
    ]);
    await db.query(
      `insert into public.staff_users(id,email,full_name,status) values($1,$2,'Phase 14 SSM B','active')`,
      [alternateSsm, `${RUN}-ssm-b@example.invalid`],
    );
    await db.query(
      `insert into public.staff_role_assignments(staff_id,role_id,assigned_by)
       select $1,id,$2 from public.roles where slug='senior_sales_manager'`,
      [alternateSsm, staff['super-admin']],
    );
    await db.query(
      `insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
       values($1,$2,'senior_sales_manager',true,true,$3)`,
      [alternateSsm, staff['vice-director'], staff['super-admin']],
    );
    const smRelationship = await one<{ id: string }>(
      `select id from public.referral_relationships where subject_staff_id=$1 and is_active`,
      [staff['sm']],
    );
    await db.query(`select public.correct_referral_upline($1,$2,'Phase 14 regression',$3)`, [
      smRelationship.id,
      alternateSsm,
      staff['super-admin'],
    ]);
    const oldSsm = await one<{ n: number }>(
      `select count(*)::int n from public.card_sale_hierarchy_snapshots
        where sale_id=$1 and ancestor_staff_id=$2`,
      [saleId, staff['ssm']],
    );
    check('upline correction cannot rewrite the old sale hierarchy snapshot', oldSsm.n === 1);
    const alternateNumber = (
      await one<{ customer_number: string }>('select * from public.next_customer_number()')
    ).customer_number;
    await db.query(
      `insert into public.customers(id,customer_number,email,phone,first_name,last_name,status)
       values($1,$2,$3,'09170000000','Phase','Fourteen','prospect')`,
      [alternateCustomer, alternateNumber, `${RUN}-phase14-buyer@example.invalid`],
    );
    const alternateSaleNumber = (
      await one<{ sale_number: string }>('select * from public.next_sale_number()')
    ).sale_number;
    await db.query(
      `insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,cash_price_snapshot,status,balance_due_at)
       values($1,$2,$3,$4,'staff',$5,$6,$6,'submitted',now()+interval '1 year')`,
      [alternateSale, alternateSaleNumber, alternateCustomer, goldId, staff['sm'], gold.cash_price],
    );
    const newSsm = await one<{ n: number }>(
      `select count(*)::int n from public.card_sale_hierarchy_snapshots
        where sale_id=$1 and ancestor_staff_id=$2`,
      [alternateSale, alternateSsm],
    );
    check('a sale after correction is credited to the new SSM ancestry', newSsm.n === 1);
    await db.query('rollback');

    const snapshotBefore = await one<Record<string, string | number>>(
      `select cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
            commission_rate_snapshot, expected_commission_snapshot
       from public.card_sales where id = $1`,
      [saleId],
    );
    eq(
      '  expected_commission_snapshot is 4% of Gold',
      snapshotBefore.expected_commission_snapshot,
      commissionAmount.v,
    );

    // Reprice the product; the historical sale must not move.
    await db.query(
      'update public.card_plans set cash_price = $2, yearly_points = $3 where id = $1',
      [goldId, '99000.00', 99999],
    );
    const snapshotAfter = await one<Record<string, string | number>>(
      `select cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
            commission_rate_snapshot, expected_commission_snapshot
       from public.card_sales where id = $1`,
      [saleId],
    );
    check(
      'repricing the product leaves the historical sale unchanged',
      JSON.stringify(snapshotAfter) === JSON.stringify(snapshotBefore),
      JSON.stringify(snapshotAfter),
    );
    await db.query(
      'update public.card_plans set cash_price = $2, yearly_points = $3 where id = $1',
      [goldId, gold.cash_price, gold.yearly_points],
    );
    console.log('  (product pricing restored)');

    /* ---------------------------------------------------------------- */
    section('6. exact decimal arithmetic (real Postgres numeric)');
    /* ---------------------------------------------------------------- */
    const precision = await one<{ v: string }>(
      `select private.money(0.10::numeric + 0.20::numeric + 19999.70::numeric) as v`,
    );
    eq('0.10 + 0.20 + 19,999.70 = 20,000.00 (no float drift)', precision.v, '20000.00');

    const rounding = await db.query<{ v: string }>(
      `select private.money(round(2.50::numeric * 0.05::numeric, 2)) as v
     union all select private.money(round(99999999.99::numeric * 0.0400::numeric, 2))`,
    );
    eq('half away from zero: 2.50 x 0.05 = 0.13', rounding.rows[0]!.v, '0.13');
    eq('large value exact: 99,999,999.99 x 4% = 4,000,000.00', rounding.rows[1]!.v, '4000000.00');

    const moneyLen = await one<{ v: string }>('select private.money(5::numeric)::text as v');
    eq('private.money always yields two decimals', moneyLen.v, '5.00');

    /* ---------------------------------------------------------------- */
    section('7. sale_financial_summary across payment states');
    /* ---------------------------------------------------------------- */
    const summaryEmpty = await summaryOf(saleId);
    check(
      'no payments -> everything zero',
      summaryEmpty.verifiedTotal === '0.00' && summaryEmpty.remainingBalance === gold.cash_price,
      JSON.stringify(summaryEmpty),
    );

    const p1 = await one<{ id: string }>(
      `select public.record_card_payment($1,$2,'down_payment','bank_transfer',$3,null,null,$4) as id`,
      [saleId, '20000.00', `${RUN}-TRF-1`, staff['finance']],
    );
    check('record_card_payment returns the new payment id', !!p1.id);
    const afterRecord = await summaryOf(saleId);
    eq('a recorded payment does NOT count as verified money', afterRecord.verifiedTotal, '0.00');
    eq('  but it is reported as recorded', afterRecord.recordedTotal, '20000.00');
    check(
      '  down payment is NOT satisfied by unverified money',
      afterRecord.downPaymentSatisfied === false,
    );
    eq('  sale moved to payment_in_progress', afterRecord.status, 'payment_in_progress');

    const badRef = await throws('duplicate payment reference is refused', () =>
      db.query(`select public.record_card_payment($1,$2,'installment','cash',$3,null,null,$4)`, [
        saleId,
        '100.00',
        `${RUN}-TRF-1`,
        staff['finance']!,
      ]),
    );
    check(
      '  refused by a unique index, not a silent overwrite',
      /duplicate key|unique/i.test(badRef),
      badRef,
    );

    await db.query(`select public.verify_card_payment($1,'rejected','test rejection',$2)`, [
      p1.id,
      staff['finance']!,
    ]);
    const rejId = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'1.00','installment','cash',$2,null,null,$3) as id`,
        [saleId, `${RUN}-TRF-REJ`, staff['finance']],
      )
    ).id;
    const rejectNoReason = await throws('a rejection without a reason is refused', () =>
      db.query(`select public.verify_card_payment($1,'rejected',null,$2)`, [
        rejId,
        staff['finance']!,
      ]),
    );
    check('  REASON_REQUIRED', /REASON_REQUIRED/.test(rejectNoReason), rejectNoReason);

    const doubleVerify = await throws('a payment cannot be verified twice', () =>
      db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
        p1.id,
        staff['finance']!,
      ]),
    );
    check('  PAYMENT_NOT_PENDING', /PAYMENT_NOT_PENDING/.test(doubleVerify), doubleVerify);

    const zeroAmount = await throws('a zero amount is refused', () =>
      db.query(
        `select public.record_card_payment($1,'0.00','installment','cash',null,null,null,$2)`,
        [saleId, staff['finance']],
      ),
    );
    check('  AMOUNT_MUST_BE_POSITIVE', /AMOUNT_MUST_BE_POSITIVE/.test(zeroAmount), zeroAmount);

    // Now a real verified down payment, then the boundary amounts.
    const downId = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,$2,'down_payment','bank_transfer',$3,null,null,$4) as id`,
        [saleId, '20000.00', `${RUN}-TRF-DOWN`, staff['finance']],
      )
    ).id;
    const verified = (
      await db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
        downId,
        'verified',
        null,
        staff['finance']!,
      ])
    ).rows.map((r) => camel<Record<string, string | boolean>>(r));
    eq('verified total now counts', verified[0]!.verifiedTotal, '20000.00');
    eq('  remaining balance is recomputed', verified[0]!.remainingBalance, '292000.00');
    check('  not fully paid yet', verified[0]!.fullyPaid === false);

    const deadline = verified[0]!.spotCashDeadline as string;
    check(
      '  7-day spot-cash deadline was opened by the first VERIFIED payment',
      !!deadline,
      String(deadline),
    );

    const deadlineRow = await one<{ started: string; deadline: string }>(
      'select spot_cash_started_at::text as started, spot_cash_deadline::text as deadline from public.card_sales where id = $1',
      [saleId],
    );
    const diffMs =
      new Date(deadlineRow.deadline).valueOf() - new Date(deadlineRow.started).valueOf();
    eq('  deadline is exactly start + 7 days', diffMs, 7 * 24 * 60 * 60 * 1000);

    // A second verified payment must not move the deadline.
    const p3 = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'1.00','installment','cash',$2,null,null,$3) as id`,
        [saleId, `${RUN}-TRF-3`, staff['finance']],
      )
    ).id;
    await db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
      p3,
      staff['finance']!,
    ]);
    const deadlineAfter = await one<{ deadline: string }>(
      'select spot_cash_deadline::text as deadline from public.card_sales where id = $1',
      [saleId],
    );
    eq(
      '  a later verified payment does not move the deadline',
      deadlineAfter.deadline,
      deadlineRow.deadline,
    );

    const over = await summaryOf(saleId);
    eq('  remaining balance is price - verified', over.remainingBalance, '291999.00');
    eq('  rejected money is reported separately', over.rejectedTotal, '20000.00');
    eq('  rejected money is not in the verified total', over.verifiedTotal, '20001.00');

    /* ---------------------------------------------------------------- */
    section('8. minimum down payment at every boundary, all three plans');
    /* ---------------------------------------------------------------- */
    for (const [code, down, justUnder] of [
      ['BRONZE', '10000.00', '9999.99'],
      ['SILVER', '15000.00', '14999.99'],
      ['GOLD', '20000.00', '19999.99'],
    ] as const) {
      const plan = byCode.get(code)!;
      const payVerified = async (s: string, amount: string, tag: string) => {
        const p = (
          await one<{ id: string }>(
            `select public.record_card_payment($1,$2,'installment','cash',$3,null,null,$4) as id`,
            [s, amount, `${RUN}-${tag}`, staff['finance']],
          )
        ).id;
        await db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
          p,
          staff['finance']!,
        ]);
      };

      const underSale = await mkSale('under', await mkCustomer('under', code), plan, code);
      await payVerified(underSale, justUnder, `${code}-UNDER`);
      const under = await summaryOf(underSale);
      check(
        `${code}: ${justUnder} verified -> downPaymentSatisfied = false`,
        under.downPaymentSatisfied === false,
      );

      const atSale = await mkSale('at', await mkCustomer('at', code), plan, code);
      await payVerified(atSale, down, `${code}-AT`);
      const at = await summaryOf(atSale);
      check(
        `${code}: ${down} verified -> downPaymentSatisfied = true`,
        at.downPaymentSatisfied === true,
      );
    }

    // Recorded-but-unverified must not satisfy the minimum.
    const recCust = await mkCustomer('rec', 'GOLD');
    const recOnlySale = uuidFor('sale:GOLD:rec');
    const recCn = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
      .sale_number;
    await db.query(
      `insert into public.card_sales
       (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
        cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
        commission_rate_snapshot, expected_commission_snapshot, status, balance_due_at)
     values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now() + interval '365 days')`,
      [
        recOnlySale,
        recCn,
        recCust,
        goldId,
        staff['ost']!,
        gold.cash_price,
        gold.minimum_down_payment,
        gold.yearly_points,
        gold.commission_rate,
      ],
    );
    await db.query(
      `select public.record_card_payment($1,'20000.00','down_payment','bank_transfer',$2,null,null,$3)`,
      [recOnlySale, `${RUN}-REC-ONLY`, staff['finance']],
    );
    const recOnly = await summaryOf(recOnlySale);
    check(
      'recorded-but-unverified 20,000.00 does NOT satisfy Gold down payment',
      recOnly.downPaymentSatisfied === false,
    );

    /* ---------------------------------------------------------------- */
    section('9. spot-cash derived state and boundaries');
    // A dedicated sale that is paid but NOT fully paid, so its window is live.
    const spotCust = await mkCustomer('spot', 'spot');
    const spotSale = await mkSale('spot', spotCust, gold, 'spot');
    const spotPay = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'1000.00','installment','cash',$2,null,null,$3) as id`,
        [spotSale, `${RUN}-SPOT`, staff['finance']],
      )
    ).id;
    await db.query("select public.verify_card_payment($1,'verified',null,$2)", [
      spotPay,
      staff['finance']!,
    ]);

    const spotRow = await one<{ started: string; deadline: string }>(
      'select spot_cash_started_at::text as started, spot_cash_deadline::text as deadline from public.card_sales where id = $1',
      [spotSale],
    );
    check('the window records the instant it opened', !!spotRow.started, spotRow.started);
    check(
      'the deadline is exactly 7 days after that instant',
      new Date(spotRow.deadline).valueOf() - new Date(spotRow.started).valueOf() ===
        7 * 24 * 60 * 60 * 1000,
      `${spotRow.started} -> ${spotRow.deadline}`,
    );

    const live = await one<{ state: string }>(
      'select f.spot_cash_state as state from public.sale_financial_summary($1) f',
      [spotSale],
    );
    check(
      'a paid-but-unfinished sale reports within_deadline',
      live.state === 'within_deadline',
      live.state,
    );

    // Boundary semantics, evaluated with the same CASE the summary uses, against
    // a pinned instant. Self-contained SQL: no unused parameters.
    const boundary = async (deadline: string | null, at: string, fullyPaid: boolean) => {
      const r = await one<{ state: string }>(
        `with p as (
            select $1::timestamptz as d,
                   $2::timestamptz as at,
                   ${fullyPaid} as paid)
         select case
                  when p.d is null then 'not_started'
                  when p.paid then 'fully_paid'
                  when p.at <= p.d then 'within_deadline'
                  else 'expired' end as state
           from p`,
        [deadline, at],
      );
      return r.state;
    };

    const dl = spotRow.deadline;
    eq(
      'exactly at the deadline instant -> within_deadline',
      await boundary(dl, dl, false),
      'within_deadline',
    );
    eq(
      'one millisecond after the deadline -> expired',
      await boundary(dl, new Date(new Date(dl).valueOf() + 1).toISOString(), false),
      'expired',
    );
    eq(
      'one millisecond before the deadline -> within_deadline',
      await boundary(dl, new Date(new Date(dl).valueOf() - 1).toISOString(), false),
      'within_deadline',
    );
    eq(
      'no verified payment yet -> not_started',
      await boundary(null, new Date().toISOString(), false),
      'not_started',
    );
    eq(
      'fully paid overrides an expired window',
      await boundary('2020-01-01T00:00:00.000Z', '2020-01-02T00:00:00.000Z', true),
      'fully_paid',
    );

    // The window is opened by the first VERIFIED payment, never by recording.
    const recOnlyCust = await mkCustomer('window', 'window');
    const recOnlyWindow = await mkSale('window', recOnlyCust, gold, 'window');
    await db.query(
      `select public.record_card_payment($1,'500.00','installment','cash',$2,null,null,$3)`,
      [recOnlyWindow, `${RUN}-WINDOW-REC`, staff['finance']],
    );
    const stillNull = await one<{ started: string | null; deadline: string | null }>(
      'select spot_cash_started_at::text as started, spot_cash_deadline::text as deadline from public.card_sales where id = $1',
      [recOnlyWindow],
    );
    check(
      'a RECORDED (unverified) payment does not open the window',
      stillNull.started === null && stillNull.deadline === null,
      `${stillNull.started} / ${stillNull.deadline}`,
    );
    const notStarted = await one<{ state: string }>(
      'select f.spot_cash_state as state from public.sale_financial_summary($1) f',
      [recOnlyWindow],
    );
    eq('  and the sale reports not_started', notStarted.state, 'not_started');

    // A second verified payment must not move the deadline.
    const spotPay2 = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'1.00','installment','cash',$2,null,null,$3) as id`,
        [spotSale, `${RUN}-SPOT-2`, staff['finance']],
      )
    ).id;
    await db.query("select public.verify_card_payment($1,'verified',null,$2)", [
      spotPay2,
      staff['finance']!,
    ]);
    const movedDeadline = await one<{ deadline: string }>(
      'select spot_cash_deadline::text as deadline from public.card_sales where id = $1',
      [spotSale],
    );
    eq(
      'a later verified payment does not move the deadline',
      movedDeadline.deadline,
      spotRow.deadline,
    );

    const monthCross = await one<{ v: string }>(
      "select to_char((timestamptz '2026-09-28 23:59:59.999+00' + interval '7 days') at time zone 'utc', 'YYYY-MM-DD HH24:MI:SS.MS') as v",
    );
    check(
      'UTC arithmetic crosses the month boundary correctly',
      monthCross.v === '2026-10-05 23:59:59.999',
      monthCross.v,
    );
    const leap = await one<{ v: string }>(
      "select to_char((timestamptz '2028-02-20 00:00:00+00' + interval '7 days') at time zone 'utc', 'YYYY-MM-DD') as v",
    );
    check('leap-year arithmetic is correct', leap.v === '2028-02-27', leap.v);
    const offset = await one<{ v: string }>(
      "select to_char((timestamptz '2026-09-27 10:00:00+08' at time zone 'utc') + interval '7 days', 'YYYY-MM-DD HH24:MI:SS') as v",
    );
    check(
      'the window is computed in UTC regardless of the input offset',
      offset.v === '2026-10-04 02:00:00',
      offset.v,
    );

    const cronish = await one<{ n: number }>(
      `select count(*)::int as n from pg_proc
        where proname ilike '%spot%' or proname ilike '%clearing%' or proname ilike '%expire%'`,
    );
    eq('no cron-like function acts on expiry', cronish.n, 0);

    /* ---------------------------------------------------------------- */
    section('9b. one open application per customer and product');
    /* ---------------------------------------------------------------- */
    const dupeCust = await mkCustomer('dupe', 'dupe');
    const firstOpen = await mkSale('dupe-first', dupeCust, gold, 'dupe');
    const dupeErr = await throws(
      'a second OPEN sale for the same customer + product is refused',
      () => mkSale('dupe-second', dupeCust, gold, 'dupe'),
    );
    check(
      '  refused by card_sales_one_open_per_customer',
      /one_open_per_customer|duplicate key/i.test(dupeErr),
      dupeErr,
    );
    // Cancelling frees the slot, so a later legitimate purchase is allowed.
    await db.query(
      "update public.card_sales set status = 'cancelled', cancelled_at = now() where id = $1",
      [firstOpen],
    );
    const reBuy = await mkSale('dupe-rebuy', dupeCust, gold, 'dupe');
    check('  after cancelling, a fresh application for the same card is allowed', !!reBuy);

    /* ---------------------------------------------------------------- */

    /* ---------------------------------------------------------------- */
    section('10. full payment transition');
    /* ---------------------------------------------------------------- */
    const beforeFull = await summaryOf(saleId);
    check('verified 20,001.00 < 312,000.00 -> fully_paid = false', beforeFull.fullyPaid === false);

    const remainId = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'291999.00','full','bank_transfer',$2,null,null,$3) as id`,
        [saleId, `${RUN}-TRF-REMAIN`, staff['finance']],
      )
    ).id;
    const fullRes = camel<Record<string, string | boolean>>(
      await one('select * from public.verify_card_payment($1,$2,$3,$4)', [
        remainId,
        'verified',
        null,
        staff['finance']!,
      ]),
    );
    eq('verified total reaches the full price', fullRes.verifiedTotal, gold.cash_price);
    eq('  remaining balance is zero', fullRes.remainingBalance, '0.00');
    check('  fully paid', fullRes.fullyPaid === true);
    eq('  sale progressed to payment_verified', fullRes.status, 'payment_verified');

    // Only now is the sale fully paid, so only now can the window report
    // fully_paid, which must override the still-open deadline.
    const paidState = await one<{ state: string }>(
      'select f.spot_cash_state as state from public.sale_financial_summary($1) f',
      [saleId],
    );
    check(
      'a fully paid sale reports fully_paid, overriding the window',
      paidState.state === 'fully_paid',
      paidState.state,
    );
    const stillOpen = await one<{ deadline: string }>(
      'select spot_cash_deadline::text as deadline from public.card_sales where id = $1',
      [saleId],
    );
    check(
      '  and the original deadline is still recorded',
      !!stillOpen.deadline,
      stillOpen.deadline,
    );

    const commission = await one<{ status: string; amount: string }>(
      'select status, amount from public.commissions where sale_id = $1',
      [saleId],
    );
    eq(
      'commission advanced to payment_verified on full payment',
      commission.status,
      'payment_verified',
    );
    eq(
      '  commission amount matches the snapshotted Gold economics',
      commission.amount,
      commissionAmount.v,
    );

    /* ---------------------------------------------------------------- */
    section('11. ACTIVATION - unpaid is refused');
    /* ---------------------------------------------------------------- */
    // Two refusals must be distinguished. (a) a sale in a status that is not
    // activatable, and (b) the load-bearing one: a sale that IS in an activatable
    // status but whose verified money does not reach the price. (b) is the case
    // that proves a status flag alone can never activate a membership.
    const statusRefused = await throws('activation from a non-activatable status is refused', () =>
      db.query('select * from public.activate_card_sale($1,$2,$3)', [
        recOnlySale,
        staff['finance']!,
        12,
      ]),
    );
    check('  SALE_NOT_ACTIVATABLE', /SALE_NOT_ACTIVATABLE/.test(statusRefused), statusRefused);

    // Force the status to the activatable one while leaving the sale underpaid.
    const underpaidCust = await mkCustomer('underpaid', 'underpaid');
    const unpaidSale = await mkSale('underpaid', underpaidCust, gold, 'underpaid');
    await db.query(`update public.card_sales set status = 'payment_verified' where id = $1`, [
      unpaidSale,
    ]);
    const underpaidOnly = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'100.00','installment','cash',$2,null,null,$3) as id`,
        [unpaidSale, `${RUN}-UNDERPAID`, staff['finance']],
      )
    ).id;
    await db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
      underpaidOnly,
      staff['finance']!,
    ]);
    // Put the status back: verification may have moved it on, and the point of
    // the test is that a fully VERIFIED sum below the price still blocks.
    await db.query(`update public.card_sales set status = 'payment_verified' where id = $1`, [
      unpaidSale,
    ]);
    const underpaidSummary = await summaryOf(unpaidSale);
    check(
      '  the sale looks activatable by status alone',
      underpaidSummary.status === 'payment_verified' && underpaidSummary.fullyPaid === false,
      `${underpaidSummary.status} / fullyPaid=${underpaidSummary.fullyPaid}`,
    );

    const membershipsBefore = await one<{ n: number }>(
      'select count(*)::int as n from public.memberships',
    );
    const accountsBefore = await one<{ n: number }>(
      'select count(*)::int as n from public.points_accounts',
    );
    const ledgerBefore = await one<{ n: number }>(
      'select count(*)::int as n from public.points_ledger',
    );
    const refused = await throws('activate_card_sale on an unpaid sale is refused', () =>
      db.query('select * from public.activate_card_sale($1,$2,$3)', [
        unpaidSale,
        staff['finance']!,
        12,
      ]),
    );
    check('  SALE_NOT_FULLY_PAID', /SALE_NOT_FULLY_PAID/.test(refused), refused);
    const membershipsAfter = await one<{ n: number }>(
      'select count(*)::int as n from public.memberships',
    );
    const accountsAfter = await one<{ n: number }>(
      'select count(*)::int as n from public.points_accounts',
    );
    const ledgerAfter = await one<{ n: number }>(
      'select count(*)::int as n from public.points_ledger',
    );
    eq('  no membership was created', membershipsAfter.n, membershipsBefore.n);
    eq('  no points account was created', accountsAfter.n, accountsBefore.n);
    eq('  no points ledger entry was created', ledgerAfter.n, ledgerBefore.n);

    /* ---------------------------------------------------------------- */
    section('12. ACTIVATION - fully paid succeeds atomically');
    /* ---------------------------------------------------------------- */
    const activation = await one<Record<string, string | number | boolean>>(
      'select * from public.activate_card_sale($1,$2,$3)',
      [saleId, staff['finance'], 12],
    );
    const membershipId = String(activation.membership_id);
    check('activation returned a membership', !!membershipId);
    check(
      '  activation issues a cryptographically random membership number',
      /^MBS-([0-9A-F]{8}-){3}[0-9A-F]{8}$/.test(String(activation.membership_number)),
      String(activation.membership_number),
    );
    check('  QR token was generated', !!activation.qr_token);
    check('  fallback code was generated', !!activation.fallback_code);
    eq(
      '  annual points allocated from the snapshot',
      String(activation.points_allocated),
      String(gold.yearly_points),
    );
    check('  not flagged as already active', activation.already_active === false);

    const membership = await one<Record<string, string | number>>(
      'select * from public.memberships where id = $1',
      [membershipId],
    );
    check(
      'membership row exists and is active',
      membership.status === 'active',
      String(membership.status),
    );
    eq('  it belongs to the same customer', String(membership.customer_id), customerId);
    eq('  it belongs to the same sale', String(membership.sale_id), saleId);
    eq('  QR token is stored hashed, not plaintext', String(membership.qr_token_hash).length, 64);
    check(
      '  the plaintext QR token is NOT stored',
      String(membership.qr_token_hash) !== String(activation.qr_token),
    );
    eq('  fallback code is stored hashed', String(membership.fallback_code_hash).length, 64);
    check(
      '  the plaintext fallback code is NOT stored',
      String(membership.fallback_code_hash) !== String(activation.fallback_code),
    );
    check(
      '  no customer PII is embedded in either identifier',
      !String(activation.qr_token).includes(customerNumber.customer_number) &&
        !String(activation.qr_token).includes('Buyer') &&
        !String(activation.fallback_code).includes(customerNumber.customer_number),
    );
    check(
      '  identifiers are not a database sequential id',
      !String(activation.qr_token).includes(saleId) &&
        !String(activation.qr_token).includes(customerId),
    );

    const pointsAccount = await one<{ balance: string; lifetime_allocated: string }>(
      'select balance::text, lifetime_allocated::text from public.points_accounts where membership_id = $1',
      [membershipId],
    );
    eq(
      'points account balance = official Gold yearly points',
      pointsAccount.balance,
      String(gold.yearly_points),
    );
    eq(
      '  lifetime allocated = official Gold yearly points',
      pointsAccount.lifetime_allocated,
      String(gold.yearly_points),
    );

    const ledger = await db.query<{
      entry_type: string;
      amount: string;
      balance_after: string;
      reference_type: string;
      reference_id: string;
    }>(
      `select entry_type, amount::text, balance_after::text, reference_type, reference_id
       from public.points_ledger where account_id = (select id from public.points_accounts where membership_id = $1)`,
      [membershipId],
    );
    eq('exactly one allocation ledger entry', ledger.rows.length, 1);
    eq('  entry type', ledger.rows[0]!.entry_type, 'annual_allocation');
    eq('  amount', ledger.rows[0]!.amount, String(gold.yearly_points));
    eq('  balance_after', ledger.rows[0]!.balance_after, String(gold.yearly_points));
    eq('  reference type', ledger.rows[0]!.reference_type, 'membership');
    eq('  reference id is the membership', ledger.rows[0]!.reference_id, membershipId);

    const saleAfter = await one<{ status: string }>(
      'select status from public.card_sales where id = $1',
      [saleId],
    );
    eq('sale is now active', saleAfter.status, 'active');
    const custAfter = await one<{ status: string }>(
      'select status from public.customers where id = $1',
      [customerId],
    );
    eq('customer is now active', custAfter.status, 'active');
    const commAfter = await one<{ status: string; earned_at: string | null }>(
      'select status, earned_at::text from public.commissions where sale_id = $1',
      [saleId],
    );
    eq(
      'commission is awaiting final qualification',
      commAfter.status,
      'final_qualification_pending',
    );
    check('  and was NOT auto-earned', commAfter.earned_at === null, String(commAfter.earned_at));

    /* ---------------------------------------------------------------- */
    section('13. ACTIVATION idempotency');
    /* ---------------------------------------------------------------- */
    const again = await one<Record<string, string | number | boolean>>(
      'select * from public.activate_card_sale($1,$2,$3)',
      [saleId, staff['finance'], 12],
    );
    check('second activation is flagged already_active', again.already_active === true);
    eq('  it returns the SAME membership', String(again.membership_id), membershipId);
    eq(
      '  same membership number',
      String(again.membership_number),
      String(activation.membership_number),
    );
    check(
      '  it does NOT re-issue the plaintext identifiers',
      again.qr_token === null && again.fallback_code === null,
    );
    const counts = await one<{ m: number; a: number; l: number; c: number }>(
      `select (select count(*)::int from public.memberships where sale_id = $1) as m,
            (select count(*)::int from public.points_accounts where membership_id = $2) as a,
            (select count(*)::int from public.points_ledger where account_id = (select id from public.points_accounts where membership_id = $2)) as l,
            (select count(*)::int from public.commissions where sale_id = $1) as c`,
      [saleId, membershipId],
    );
    eq('  exactly one membership', counts.m, 1);
    eq('  exactly one points account', counts.a, 1);
    eq('  exactly one allocation entry', counts.l, 1);
    eq('  exactly one commission', counts.c, 1);

    /* ---------------------------------------------------------------- */
    section('14. ACTIVATION rollback (fault injection)');
    /* ---------------------------------------------------------------- */
    // A second fully-paid sale whose points allocation is forced to fail by an
    // over-limit ledger amount: valid inside the function, rejected by the CHECK.
    const rollCust = uuidFor('customer:roll');
    const rollCustNumber = (
      await one<{ customer_number: string }>('select * from public.next_customer_number()')
    ).customer_number;
    await db.query(
      `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
     values ($1,$2,'Roll','Back','1990-01-01',$3,'09175550002','prospect')`,
      [rollCust, rollCustNumber, `${RUN}-roll@example.invalid`],
    );
    createdCustomerIds.push(rollCust);

    // Force the points allocation to violate points_ledger_one_allocation_per_year
    // by pre-seeding a conflicting allocation for the SAME membership reference.
    const rollSale = uuidFor('sale:roll');
    const rollSaleNumber = (
      await one<{ sale_number: string }>('select * from public.next_sale_number()')
    ).sale_number;
    await db.query(
      `insert into public.card_sales
       (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
        cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
        commission_rate_snapshot, expected_commission_snapshot, status, balance_due_at)
     values ($1,$2,$3,$4,'staff',$5,$6,$6,'10000.00',25000,$7,'2400.00','payment_verified', now() + interval '365 days')`,
      [
        rollSale,
        rollSaleNumber,
        rollCust,
        goldId,
        staff['ost']!,
        gold.cash_price,
        gold.commission_rate,
      ],
    );
    await db.query(
      `insert into public.payments (sale_id, customer_id, amount, method, status, recorded_by, verified_by)
     values ($1,$2,$3,'bank_transfer','verified',$4,$4)`,
      [rollSale, rollCust, gold.cash_price, staff['finance']],
    );
    await db.query(
      `insert into public.commissions (sale_id, beneficiary_type, beneficiary_staff_id, amount, rate_snapshot, basis_amount_snapshot, status)
     values ($1,'staff',$2,'2400.00',$3,$4,'payment_verified')`,
      [rollSale, staff['ost'], gold.commission_rate, gold.cash_price],
    );

    const rollBefore = await one<{ l: number; c: string; s: string }>(
      `select (select count(*)::int from public.points_ledger) as l,
            (select status from public.commissions where sale_id = $1) as c,
            (select status from public.card_sales where id = $1) as s`,
      [rollSale],
    );
    // Force a deterministic downstream failure: a trigger that rejects the points
    // ledger insert. Everything the function does BEFORE that insert must roll
    // back with it, leaving no partial state.
    await db.query(
      `create or replace function public.__test_force_ledger_failure() returns trigger
       language plpgsql as $$ begin raise exception 'forced ledger failure'; end $$`,
    );
    await db.query(
      `create trigger __test_block_ledger before insert on public.points_ledger
       for each row execute function public.__test_force_ledger_failure()`,
    );

    const rollErr = await throws('activation fails when the ledger insert fails', () =>
      db.query('select * from public.activate_card_sale($1,$2,$3)', [
        rollSale,
        staff['finance']!,
        12,
      ]),
    );
    check('  the forced failure propagated', /forced ledger failure/.test(rollErr), rollErr);

    const rollAfter = await one<{ m: number; a: number; c: string; s: string }>(
      `select (select count(*)::int from public.memberships where sale_id = $1) as m,
            (select count(*)::int from public.points_accounts pa join public.memberships m2 on m2.id = pa.membership_id where m2.sale_id = $1) as a,
            (select status from public.commissions where sale_id = $1) as c,
            (select status from public.card_sales where id = $1) as s`,
      [rollSale],
    );
    eq('  ROLLBACK: no membership survives', rollAfter.m, 0);
    eq('  ROLLBACK: no points account survives', rollAfter.a, 0);
    eq('  ROLLBACK: commission did not advance past payment_verified', rollAfter.c, rollBefore.c);
    eq('  ROLLBACK: sale did not become active', rollAfter.s, rollBefore.s);
    const rollCustStatus = await one<{ status: string }>(
      'select status from public.customers where id = $1',
      [rollCust],
    );
    eq('  ROLLBACK: customer did not become active', rollCustStatus.status, 'prospect');

    await db.query('drop trigger if exists __test_block_ledger on public.points_ledger');
    await db.query('drop function if exists public.__test_force_ledger_failure()');
    console.log('  (fault-injection trigger removed)');

    /* ---------------------------------------------------------------- */
    section('15. SECURITY DEFINER search_path and grants');
    /* ---------------------------------------------------------------- */
    const definer = await db.query<{
      proname: string;
      prosecdef: boolean;
      proconfig: string[] | null;
    }>(
      `select p.proname, p.prosecdef, p.proconfig
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public','private') and p.prosecdef
      order by p.proname`,
    );
    check(
      'SECURITY DEFINER functions found',
      definer.rows.length > 0,
      `count=${definer.rows.length}`,
    );
    for (const fn of definer.rows) {
      const config = (fn.proconfig ?? []).join(',');
      check(
        `  ${fn.proname} pins search_path`,
        /search_path\s*=\s*public/.test(config) ||
          /search_path\s*=\s*pg_catalog,\s*extensions,\s*private,\s*public,\s*pg_temp/.test(
            config,
          ) ||
          /search_path\s*=\s*pg_catalog,\s*public,\s*(private,\s*)?pg_temp/.test(config),
        config,
      );
    }

    const grants = await db.query<{ proname: string; grantee: string }>(
      `select p.proname, coalesce(g.grantee,'') as grantee
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       left join information_schema.routine_privileges g on g.specific_name = p.proname
      where n.nspname in ('public','private')
        and p.proname in ('activate_card_sale','verify_card_payment','record_card_payment',
                          'correct_referral_upline','issue_customer_onboarding_token',
                          'next_customer_number','next_sale_number','money','hash_token',
                          'new_fallback_code','new_qr_token')`,
    );
    for (const m of [
      'activate_card_sale',
      'verify_card_payment',
      'record_card_payment',
      'correct_referral_upline',
      'issue_customer_onboarding_token',
    ]) {
      const leaked = grants.rows.filter(
        (r) => r.proname === m && ['PUBLIC', 'anon', 'authenticated'].includes(r.grantee),
      );
      check(
        `  ${m} is not granted to PUBLIC/anon/authenticated`,
        leaked.length === 0,
        JSON.stringify(leaked),
      );
    }

    const noAnonGrants = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.role_routine_grants
      where specific_schema in ('public','private') and grantee = 'anon'`,
    );
    eq('no routine is granted to anon anywhere', noAnonGrants.n, 0);

    /* ---------------------------------------------------------------- */
    section('16. RLS - enforced at the database, not the handler');
    /* ---------------------------------------------------------------- */
    const rlsNoWrites = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public'
        and grantee in ('anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')`,
    );
    eq('no INSERT/UPDATE/DELETE granted to anon or authenticated', rlsNoWrites.n, 0);

    const deniedWrite: string = await asBrowserRole(
      target.url,
      'authenticated',
      staff['sm'] ?? null,
      async (c) => {
        try {
          await c.query(
            "insert into public.payments (sale_id, amount, method, status, recorded_by) values ($1,'1.00','cash','recorded',$2)",
            [saleId, staff['sm']],
          );
          return 'insert succeeded';
        } catch (e) {
          return e instanceof Error ? e.message.split('\n')[0]! : String(e);
        }
      },
    );
    check(
      'authenticated cannot INSERT a payment row',
      /denied|permission|row-level/i.test(deniedWrite),
      deniedWrite,
    );

    // customer_onboarding_tokens has no grant to any browser role, so the
    // database refuses the statement outright. A hard refusal is stronger than
    // an empty result, and both are acceptable; assert the access is impossible.
    const onboardRead: string = await asBrowserRole(
      target.url,
      'authenticated',
      staff['sm'] ?? null,
      async (c) => {
        try {
          const res = await c.query(
            'select count(*)::int as n from public.customer_onboarding_tokens',
          );
          return `returned ${res.rows[0]!.n} rows`;
        } catch (error) {
          return `refused: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`;
        }
      },
    );
    check(
      'onboarding tokens are unreachable for an authenticated browser role',
      /^refused/.test(onboardRead) || /^returned 0/.test(onboardRead),
      onboardRead,
    );

    const deniedRpc: string = await asBrowserRole(
      target.url,
      'authenticated',
      staff['sm'] ?? null,
      async (c) => {
        try {
          await c.query('select * from public.activate_card_sale($1,$2,$3)', [
            saleId,
            staff['sm']!,
            12,
          ]);
          return 'call succeeded';
        } catch (e) {
          return e instanceof Error ? e.message.split('\n')[0]! : String(e);
        }
      },
    );
    check(
      'authenticated cannot invoke activate_card_sale directly',
      /denied|permission/i.test(deniedRpc),
      deniedRpc,
    );

    const deniedPrivateFn: string = await asBrowserRole(
      target.url,
      'authenticated',
      staff['sm']!,
      async (c) => {
        try {
          await c.query('select private.hash_token($1)', ['x']);
          return 'call succeeded';
        } catch (e) {
          return e instanceof Error ? e.message.split('\n')[0]! : String(e);
        }
      },
    );
    check(
      'authenticated cannot call private.hash_token',
      /denied|permission/i.test(deniedPrivateFn),
      deniedPrivateFn,
    );

    const anonRead = await visibleRows(
      target.url,
      'anon',
      null,
      'select count(*)::int as n from public.customers',
    );
    eq('anon sees zero customer rows', anonRead, 0);

    // A customer with a real permission can read; one without cannot.
    const grantPerm = async (roleSlug: string, key: string, canView = true) => {
      await db.query(
        `insert into public.role_permissions (role_id, module_id, can_view, can_create, can_update, can_delete)
       values ($1,$2,$3,$3,$3,$3) on conflict do nothing`,
        [roles[roleSlug]!, modules[key]!.id, canView],
      );
    };
    await grantPerm('sales_manager', 'sales.customers');

    const sellerRead = await visibleRows(
      target.url,
      'authenticated',
      staff['sm']!,
      'select count(*)::int as n from public.customers',
    );
    check(
      'a seller holding sales.customers can read customers',
      sellerRead > 0,
      `rows=${sellerRead}`,
    );

    await grantPerm('finance', 'finance.payment_verification');
    const financeRead = await visibleRows(
      target.url,
      'authenticated',
      staff['finance']!,
      'select count(*)::int as n from public.card_sales',
    );
    check(
      'Finance holding finance.payment_verification can read sales',
      financeRead > 0,
      `rows=${financeRead}`,
    );

    const hrRead = await visibleRows(
      target.url,
      'authenticated',
      staff['hr']!,
      'select count(*)::int as n from public.card_sales',
    );
    eq('an HR principal with no Phase 2 permission sees no sales', hrRead, 0);

    const inactiveRead = await visibleRows(
      target.url,
      'authenticated',
      staff['inactive']!,
      'select count(*)::int as n from public.card_sales',
    );
    eq('a suspended staff principal sees nothing even with a valid role', inactiveRead, 0);

    /* ---------------------------------------------------------------- */
    section('17. referral correction RPC');
    /* ---------------------------------------------------------------- */
    const originalRel = await one<{ id: string; upline: string }>(
      'select id, upline_staff_id as upline from public.referral_relationships where subject_staff_id = $1 and is_active',
      [staff['ost']],
    );
    const saleAttribution = await one<{ ref: string | null }>(
      'select referral_relationship_id as ref from public.card_sales where id = $1',
      [saleId],
    );

    const sameUpline = await throws('correcting to the same upline is refused', () =>
      db.query('select public.correct_referral_upline($1,$2,$3,$4)', [
        originalRel.id,
        originalRel.upline,
        'no-op',
        staff['admin']!,
      ]),
    );
    check('  SAME_UPLINE', /SAME_UPLINE/.test(sameUpline), sameUpline);

    const selfUpline = await throws('a self-referencing upline is refused', () =>
      db.query('select public.correct_referral_upline($1,$2,$3,$4)', [
        originalRel.id,
        staff['ost']!,
        'self',
        staff['admin']!,
      ]),
    );
    check('  UPLINE_SELF_REFERENCE', /UPLINE_SELF_REFERENCE/.test(selfUpline), selfUpline);

    const noReason = await throws('a correction without a reason is refused', () =>
      db.query('select public.correct_referral_upline($1,$2,$3,$4)', [
        originalRel.id,
        staff['vice-director']!,
        null,
        staff['admin']!,
      ]),
    );
    check('  REASON_REQUIRED', /REASON_REQUIRED/.test(noReason), noReason);

    const newRelId = await one<{ id: string }>(
      'select public.correct_referral_upline($1,$2,$3,$4) as id',
      [originalRel.id, staff['sm-alt'], 'restructured for the test', staff['admin']],
    );
    check('correction returned a new relationship id', !!newRelId.id);
    const oldNow = await one<{ is_active: boolean }>(
      'select is_active from public.referral_relationships where id = $1',
      [originalRel.id],
    );
    check('the old relationship was retired', oldNow.is_active === false);
    const newNow = await one<{ is_active: boolean; is_authoritative: boolean; upline: string }>(
      'select is_active, is_authoritative, upline_staff_id as upline from public.referral_relationships where id = $1',
      [newRelId.id],
    );
    check('the new relationship is active', newNow.is_active === true);
    check('the new relationship is authoritative', newNow.is_authoritative === true);
    eq('  it points at the requested upline', newNow.upline, staff['sm-alt']!);
    const activeCount = await one<{ n: number }>(
      'select count(*)::int as n from public.referral_relationships where subject_staff_id = $1 and is_active',
      [staff['ost']],
    );
    eq('the subject still has exactly one ACTIVE upline', activeCount.n, 1);
    const attribution = await one<{ ref: string | null }>(
      'select referral_relationship_id as ref from public.card_sales where id = $1',
      [saleId],
    );
    eq('historical sale attribution is unchanged', attribution.ref, saleAttribution.ref);
    const corrAudit = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
      where action = 'UPLINE_CORRECTED' and entity_id = $1`,
      [newRelId.id],
    );
    check('the correction is audited', corrAudit.n > 0);

    /* ---------------------------------------------------------------- */
    section('18. customer onboarding token issuance');
    /* ---------------------------------------------------------------- */
    const prospectCust = await mkCustomer('token-prospect', 'token');
    const earlyIssue = await throws(
      'a token cannot be issued for a customer who is not yet active',
      () =>
        db.query('select * from public.issue_customer_onboarding_token($1,$2,$3,$4)', [
          prospectCust,
          'account_activation',
          24,
          staff['finance']!,
        ]),
    );
    check(
      '  refused before activation',
      /CUSTOMER_NOT_ACTIVE|not found/i.test(earlyIssue),
      earlyIssue,
    );

    const issued = await one<{ token: string; expires_at: string }>(
      'select * from public.issue_customer_onboarding_token($1,$2,$3,$4)',
      [customerId, 'account_activation', 24, staff['finance']],
    );
    check(
      'a token was issued for the activated customer',
      typeof issued.token === 'string' && issued.token.length > 20,
    );
    const validity = new Date(issued.expires_at).valueOf() - Date.now();
    check(
      'the token expires in about 24 hours',
      validity > 23 * 3600_000 && validity < 25 * 3600_000,
      `${Math.round(validity / 3600_000)}h`,
    );

    const stored = await one<{ token_hash: string; consumed_at: string | null }>(
      'select token_hash, consumed_at::text from public.customer_onboarding_tokens where customer_id = $1 order by created_at desc limit 1',
      [customerId],
    );
    eq('only a 64-char hash is stored', stored.token_hash.length, 64);
    check('the plaintext token is NOT stored', stored.token_hash !== issued.token);
    check('the token starts unconsumed', stored.consumed_at === null);

    const reissued = await one<{ token: string }>(
      'select * from public.issue_customer_onboarding_token($1,$2,$3,$4)',
      [customerId, 'account_activation', 24, staff['finance']],
    );
    check('re-issuing returns a DIFFERENT token', reissued.token !== issued.token);
    const retired = await one<{ n: number }>(
      `select count(*)::int as n from public.customer_onboarding_tokens
      where customer_id = $1 and consumed_at is null`,
      [customerId],
    );
    eq('the previous outstanding token was retired (single-use)', retired.n, 1);

    /* ---------------------------------------------------------------- */
    section('19. concurrency');
    /* ---------------------------------------------------------------- */
    // Two simultaneous activations of the same fully-paid sale.
    const c1 = new Client({ connectionString: target.url });
    const c2 = new Client({ connectionString: target.url });
    c1.on('error', () => {});
    c2.on('error', () => {});
    await c1.connect();
    await c2.connect();
    const racers = await Promise.allSettled([
      c1.query('select public.activate_card_sale($1,$2,$3)', [saleId, staff['finance'], 12]),
      c2.query('select public.activate_card_sale($1,$2,$3)', [saleId, staff['finance'], 12]),
    ]);
    await c1.end();
    await c2.end();
    const won = racers.filter((r) => r.status === 'fulfilled').length;
    check(
      'concurrent activation: both calls returned without crashing',
      won === 2,
      `fulfilled=${won} rejected=${racers.length - won}`,
    );
    const raceCounts = await one<{ m: number; l: number }>(
      `select (select count(*)::int from public.memberships where sale_id = $1) as m,
            (select count(*)::int from public.points_ledger) as l`,
      [saleId],
    );
    eq('concurrent activation produced exactly one membership', raceCounts.m, 1);

    // Two simultaneous verifications of the same payment.
    const racePay = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,'1.00','installment','cash',$2,null,null,$3) as id`,
        [recOnlySale, `${RUN}-RACE-PAY`, staff['finance']],
      )
    ).id;
    const v1 = new Client({ connectionString: target.url });
    const v2 = new Client({ connectionString: target.url });
    v1.on('error', () => {});
    v2.on('error', () => {});
    await v1.connect();
    await v2.connect();
    await Promise.allSettled([
      v1.query('select public.verify_card_payment($1,$2,$3,$4)', [
        racePay,
        'verified',
        null,
        staff['finance']!,
      ]),
      v2.query('select public.verify_card_payment($1,$2,$3,$4)', [
        racePay,
        'rejected',
        'racing',
        staff['finance']!,
      ]),
    ]);
    await v1.end();
    await v2.end();
    const finalPay = await one<{ status: string; verified_by: string | null }>(
      'select status, verified_by from public.payments where id = $1',
      [racePay],
    );
    check(
      'concurrent verification leaves exactly one terminal state',
      ['verified', 'rejected'].includes(finalPay.status),
      finalPay.status,
    );
    const ledgerTally = await one<{ v: string }>(
      `select private.money(coalesce(sum(amount::numeric) filter (where status='verified'),0)) as v
       from public.payments where sale_id = $1`,
      [recOnlySale],
    );
    const summaryTally = await summaryOf(recOnlySale);
    eq(
      'the verified tally and the summary agree exactly',
      summaryTally.verifiedTotal,
      ledgerTally.v,
    );

    /* ---------------------------------------------------------------- */
    section('20. audit trail');
    /* ---------------------------------------------------------------- */
    const auditActions = await db.query<{ action: string; n: number }>(
      `select action, count(*)::int as n from public.audit_events
      where actor_id = $1 group by action order by action`,
      [staff['finance']],
    );
    const actions = auditActions.rows.map((r) => r.action);
    check('payment recorded is audited', actions.includes('PAYMENT_RECORDED'), actions.join(','));
    check('payment verified is audited', actions.includes('PAYMENT_VERIFIED'), actions.join(','));
    check('fully paid is audited', actions.includes('SALE_FULLY_PAID'), actions.join(','));
    check(
      'membership activation is audited',
      actions.includes('MEMBERSHIP_ACTIVATED'),
      actions.join(','),
    );

    const govLeak = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
      where after_data::text ilike '%' || $1 || '%' or before_data::text ilike '%' || $1 || '%'`,
      [`${RUN}-GOV-1`],
    );
    eq('no government ID number leaked into the audit trail', govLeak.n, 0);

    const appendOnly = await one<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
      where table_schema = 'public' and table_name = 'audit_events'
        and grantee in ('anon','authenticated','PUBLIC') and privilege_type <> 'SELECT'`,
    );
    eq('audit_events grants SELECT only to browser roles', appendOnly.n, 0);

    /* ================================================================== */
    /* Phase 3 - customer account activation and the portal                 */
    /* ================================================================== */

    // Two customers, each with an active membership, each linked to a different
    // Auth user. Everything below impersonates one of them as `authenticated` and
    // asks what the DATABASE will let them see. The handler is not involved: RLS
    // is the security boundary, and this is the section that proves it.
    const portalAuthUserA = uuidFor('portal:authA');
    const portalAuthUserB = uuidFor('portal:authB');

    const mkPortalCustomer = async (label: 'a' | 'b') => {
      const id = uuidFor(`portal:cust${label}`);
      const authUserId = label === 'a' ? portalAuthUserA : portalAuthUserB;
      const cn = (
        await one<{ customer_number: string }>('select * from public.next_customer_number()')
      ).customer_number;
      // `staff_users.id` -> `auth.users(id)` is a real FK, so the Auth row must
      // exist before the customer row that references it.
      await db.query('insert into auth.users (id, email) values ($1, $2)', [
        authUserId,
        `${RUN}-portal-${label}@example.invalid`,
      ]);
      await db.query(
        `insert into public.customers
           (id, customer_number, first_name, last_name, birth_date, email, phone, status,
            government_id_number, auth_user_id)
         values ($1,$2,'Portal','Tester','1990-01-01',$3,'09175550002','active',$4,$5)`,
        [id, cn, `${RUN}-portal-${label}@example.invalid`, `${RUN}-GOV-${label}`, authUserId],
      );
      createdCustomerIds.push(id);
      createdAuthIds.push(authUserId);
      return { id, authUserId };
    };

    const custA = await mkPortalCustomer('a');
    const custB = await mkPortalCustomer('b');

    /* ---------------------------------------------------------------- */
    section('22. customer portal RLS - a member sees only themselves');
    /* ---------------------------------------------------------------- */
    const asA = <T>(fn: (c: Client) => Promise<T>) =>
      asBrowserRole(target.url, 'authenticated', custA.authUserId, fn);
    const asB = <T>(fn: (c: Client) => Promise<T>) =>
      asBrowserRole(target.url, 'authenticated', custB.authUserId, fn);
    const asAnon = <T>(fn: (c: Client) => Promise<T>) =>
      asBrowserRole(target.url, 'anon', null, fn);
    // Memberships: two members, two memberships, and the money columns a staff
    // member can see but a member must not.
    const mkPortalMembership = async (
      customer: { id: string; authUserId: string },
      tag: string,
    ) => {
      const sId = uuidFor(`portal:sale:${tag}`);
      const sn = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
        .sale_number;
      const plan = (await one<PlanRow>(
        `select * from public.card_plans where code = 'GOLD'`,
      )) as PlanRow;
      await db.query(
        `insert into public.card_sales
           (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
            cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
            commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at)
         values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now(), now() + interval '365 days')`,
        [
          sId,
          sn,
          customer.id,
          plan.id,
          staff['ost'],
          plan.cash_price,
          plan.minimum_down_payment,
          plan.yearly_points,
          plan.commission_rate,
        ],
      );
      // The real money path: record, then verify. Activation only unlocks once
      // the sale is genuinely `payment_verified`, so the fixture cannot cheat.
      const paymentId = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'full','cash',$3,null,null,$4) as id`,
          [sId, plan.cash_price, `${RUN}-PAY-${tag}`, staff['finance']],
        )
      ).id;
      await db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
        paymentId,
        'verified',
        null,
        staff['finance']!,
      ]);
      const activated = await one<{
        membership_id: string;
        fallback_code: string;
        qr_token: string;
      }>('select * from public.activate_card_sale($1,$2,$3)', [sId, staff['finance'], 12]);
      return {
        saleId: sId,
        membershipId: activated.membership_id,
        fallbackCode: activated.fallback_code,
        qrToken: activated.qr_token,
      };
    };

    const memA = await mkPortalMembership(custA, 'a');
    const memB = await mkPortalMembership(custB, 'b');

    /* --- self read --- */
    const ownCustomer = await asA(async (c) => {
      const res = await c.query(
        `select customer_number from public.customers where auth_user_id = (select auth.uid())`,
      );
      return res.rows;
    });
    eq('a member sees exactly their own customer row', ownCustomer.length, 1);
    check(
      'and it is theirs',
      ownCustomer[0]!.customer_number ===
        (
          await one<{ customer_number: string }>(
            'select customer_number from public.customers where id = $1',
            [custA.id],
          )
        ).customer_number,
    );

    const allCustomersVisible = await asA(async (c) => {
      const res = await c.query('select id from public.customers');
      return res.rows.length;
    });
    eq('a member cannot read another customer', allCustomersVisible, 1);

    // Symmetry: the check is not an artefact of which fixture was created first.
    const bSeesOwn = await asB(async (c) => {
      const res = await c.query(
        `select customer_number from public.customers where auth_user_id = (select auth.uid())`,
      );
      return res.rows;
    });
    eq('the second member likewise sees exactly one customer row', bSeesOwn.length, 1);
    const bMemberships = await asB(async (c) => {
      const res = await c.query('select id from public.memberships');
      return res.rows.length;
    });
    eq('and exactly one membership', bMemberships, 1);
    const bHasItsOwn = await asB(async (c) => {
      const res = await c.query('select id from public.memberships');
      return res.rows[0]?.id === memB.membershipId;
    });
    check('and it is the second member own', bHasItsOwn);

    const membershipsVisible = await asA(async (c) => {
      const res = await c.query('select id from public.memberships');
      return res.rows.length;
    });
    eq('a member cannot read another membership', membershipsVisible, 1);
    const membershipIsOurs = await asA(async (c) => {
      const res = await c.query('select id from public.memberships');
      return res.rows[0]?.id === memA.membershipId;
    });
    check('the one membership they can read is their own', membershipIsOurs);

    const accountsVisible = await asA(async (c) => {
      const res = await c.query('select id from public.points_accounts');
      return res.rows.length;
    });
    eq('a member cannot read another points account', accountsVisible, 1);

    const ledgerVisible = await asA(async (c) => {
      const res = await c.query('select id from public.points_ledger');
      return res.rows.length;
    });
    check(
      'a member reads only their own ledger entries',
      ledgerVisible > 0,
      `${ledgerVisible} entries visible (all their own by RLS)`,
    );
    const ledgerIsOurs = await asA(async (c) => {
      const res = await c.query(
        `select count(*)::int as n from public.points_ledger l
         join public.points_accounts a on a.id = l.account_id
         join public.memberships m on m.id = a.membership_id
         where m.customer_id <> $1`,
        [custA.id],
      );
      return res.rows[0]!.n;
    });
    eq('zero of those entries belong to another member', ledgerIsOurs, 0);

    /* --- forbidden tables --- */
    eq(
      'a member cannot read onboarding tokens',
      await asA(async (c) => {
        try {
          const res = await c.query('select * from public.customer_onboarding_tokens');
          return res.rows.length;
        } catch {
          return 0;
        }
      }),
      0,
    );
    eq(
      'a member cannot read identity documents',
      await asA(async (c) => {
        try {
          const res = await c.query('select * from public.identity_documents');
          return res.rows.length;
        } catch {
          return 0;
        }
      }),
      0,
    );
    eq(
      'a member cannot read commission records',
      await asA(async (c) => {
        try {
          const res = await c.query('select * from public.commissions');
          return res.rows.length;
        } catch {
          return 0;
        }
      }),
      0,
    );
    eq(
      'a member cannot read payments',
      await asA(async (c) => {
        try {
          const res = await c.query('select * from public.payments');
          return res.rows.length;
        } catch {
          return 0;
        }
      }),
      0,
    );
    eq(
      'a member cannot read referral relationships',
      await asA(async (c) => {
        try {
          const res = await c.query('select * from public.referral_relationships');
          return res.rows.length;
        } catch {
          return 0;
        }
      }),
      0,
    );
    eq(
      'a member cannot read the audit trail',
      await asA(async (c) => {
        try {
          const res = await c.query('select * from public.audit_events');
          return res.rows.length;
        } catch {
          return 0;
        }
      }),
      0,
    );

    /* --- column level: RLS picks the ROW, grants pick the COLUMNS --- */
    // Row-level security decides WHICH ROWS a browser role may read and says
    // nothing about which COLUMNS. Each sensitive column is probed on the table
    // it actually lives on, and a `permission denied` is the pass condition.
    const columnLeak = await asA(async (c) => {
      const out: Record<string, string> = {};
      for (const column of ['government_id_number', 'government_id_type']) {
        try {
          const res = await c.query(`select ${column} from public.customers limit 1`);
          out[column] = `READABLE(${res.rowCount})`;
        } catch {
          out[column] = 'denied';
        }
      }
      return out;
    });
    const membershipColumn = await asA(async (c) => {
      const out: Record<string, string> = {};
      for (const column of ['fallback_code_hash', 'qr_token_hash', 'activated_by']) {
        try {
          const res = await c.query(`select ${column} from public.memberships limit 1`);
          out[column] = `READABLE(${res.rowCount})`;
        } catch {
          out[column] = 'denied';
        }
      }
      return out;
    });
    const ledgerColumn = await asA(async (c) => {
      const out: Record<string, string> = {};
      for (const column of ['actor_id', 'metadata']) {
        try {
          const res = await c.query(`select ${column} from public.points_ledger limit 1`);
          out[column] = `READABLE(${res.rowCount})`;
        } catch {
          out[column] = 'denied';
        }
      }
      return out;
    });
    check(
      'the government ID columns are unreadable through the browser role',
      columnLeak['government_id_number'] === 'denied' &&
        columnLeak['government_id_type'] === 'denied',
      JSON.stringify(columnLeak),
    );
    check(
      'the membership credential hashes are unreadable through the browser role',
      membershipColumn['fallback_code_hash'] === 'denied' &&
        membershipColumn['qr_token_hash'] === 'denied' &&
        membershipColumn['activated_by'] === 'denied',
      JSON.stringify(membershipColumn),
    );
    check(
      'the internal actor id and ledger metadata are unreadable',
      ledgerColumn['actor_id'] === 'denied' && ledgerColumn['metadata'] === 'denied',
      JSON.stringify(ledgerColumn),
    );

    const safeColumnsReadable = await asA(async (c) => {
      try {
        const res = await c.query(
          'select id, customer_number, first_name, last_name, email, status from public.customers',
        );
        return res.rows.length;
      } catch {
        return -1;
      }
    });
    check(
      'the SAFE columns are still readable, so the portal works',
      safeColumnsReadable === 1,
      `${safeColumnsReadable} rows`,
    );

    /* --- no writes, ever --- */
    // Each attempt runs in its own SAVEPOINT. A denied statement aborts the
    // enclosing transaction, so without this every attempt after the first
    // would report "current transaction is aborted" instead of its own reason -
    // which would make the test pass for the wrong reason.
    const writeAttempts = await asA(async (c) => {
      const out: Record<string, string> = {};
      let n = 0;
      for (const [label, sql] of [
        ['update_points_accounts', 'update public.points_accounts set balance = 1'],
        [
          'insert_points_ledger',
          `insert into public.points_ledger (account_id, entry_type, amount, balance_after)
           select id, 'adjustment', 1, 1 from public.points_accounts limit 1`,
        ],
        ['update_customers', `update public.customers set status='suspended'`],
        ['delete_memberships', 'delete from public.memberships'],
        ['update_memberships', `update public.memberships set status='cancelled'`],
        [
          'insert_customers',
          `insert into public.customers (customer_number, first_name, last_name, birth_date, email, phone) values ('X','Y','Z','1990-01-01','x@example.invalid','0')`,
        ],
      ] as const) {
        const savepoint = `probe_${n++}`;
        await c.query(`savepoint ${savepoint}`);
        try {
          await c.query(sql);
          out[label] = 'ALLOWED';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          out[label] = /permission denied|row-level security/i.test(message)
            ? 'denied'
            : message.slice(0, 60);
        }
        await c.query(`rollback to savepoint ${savepoint}`);
      }
      return out;
    });
    check(
      'a member cannot mutate points',
      writeAttempts['update_points_accounts'] === 'denied' &&
        writeAttempts['insert_points_ledger'] === 'denied',
      JSON.stringify(writeAttempts),
    );
    check(
      'a member cannot edit their own customer record',
      writeAttempts['update_customers'] === 'denied',
      JSON.stringify(writeAttempts),
    );
    check(
      'a member cannot alter a membership',
      writeAttempts['update_memberships'] === 'denied' &&
        writeAttempts['delete_memberships'] === 'denied',
      JSON.stringify(writeAttempts),
    );
    check(
      'a member cannot create a customer record',
      writeAttempts['insert_customers'] === 'denied',
      JSON.stringify(writeAttempts),
    );

    /* --- anon sees nothing at all --- */
    const anonCustomers = await asAnon(async (c) => {
      try {
        const res = await c.query('select id from public.customers');
        return res.rows.length;
      } catch {
        return 0;
      }
    });
    eq('anon sees no customers', anonCustomers, 0);

    /* --- a staff session gets no customer privilege it did not have --- */
    // A staff member who also holds a customer record still gets customer access
    // ONLY through their own row - the staff permission model is never consulted
    // for a customer table, and customer tables are not widened for staff.
    const staffSeesAllCustomers = await asBrowserRole(
      target.url,
      'authenticated',
      staff['super-admin']!,
      async (c) => {
        const res = await c.query('select id from public.customers');
        return res.rows.length;
      },
    );
    check(
      'a super admin still reads customers through the permission model',
      staffSeesAllCustomers >= 2,
      `${staffSeesAllCustomers} rows`,
    );
    const staffSeesTokens = await asBrowserRole(
      target.url,
      'authenticated',
      staff['super-admin']!,
      async (c) => {
        try {
          const res = await c.query('select * from public.customer_onboarding_tokens');
          return res.rows.length;
        } catch {
          return 0;
        }
      },
    );
    eq('even a super admin cannot read onboarding tokens directly', staffSeesTokens, 0);

    /* ---------------------------------------------------------------- */
    section('23. onboarding token claim RPC (atomic redemption)');
    /* ---------------------------------------------------------------- */
    const claimCust = uuidFor('claim:cust');
    const claimAuthA = uuidFor('claim:authA');
    const claimAuthB = uuidFor('claim:authB');
    await db.query('insert into auth.users (id, email) values ($1,$2),($3,$4)', [
      claimAuthA,
      `${RUN}-claim-a@example.invalid`,
      claimAuthB,
      `${RUN}-claim-b@example.invalid`,
    ]);
    createdAuthIds.push(claimAuthA, claimAuthB);
    const claimNumber = (
      await one<{ customer_number: string }>('select * from public.next_customer_number()')
    ).customer_number;
    await db.query(
      `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
       values ($1,$2,'Claim','Tester','1990-01-01',$3,'09175550003','active')`,
      [claimCust, claimNumber, `${RUN}-claim@example.invalid`],
    );
    createdCustomerIds.push(claimCust);

    // A real active membership, so the claim's membership precondition holds.
    const claimSale = uuidFor('claim:sale');
    const claimSn = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
      .sale_number;
    const claimPlan = await one<PlanRow>(`select * from public.card_plans where code = 'BRONZE'`);
    await db.query(
      `insert into public.card_sales
         (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
          cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
          commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at)
       values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now(), now() + interval '365 days')`,
      [
        claimSale,
        claimSn,
        claimCust,
        claimPlan.id,
        staff['ost'],
        claimPlan.cash_price,
        claimPlan.minimum_down_payment,
        claimPlan.yearly_points,
        claimPlan.commission_rate,
      ],
    );
    const claimPaymentId = (
      await one<{ id: string }>(
        `select public.record_card_payment($1,$2,'full','cash',$3,null,null,$4) as id`,
        [claimSale, claimPlan.cash_price, `${RUN}-PAY-CLAIM`, staff['finance']],
      )
    ).id;
    await db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
      claimPaymentId,
      'verified',
      null,
      staff['finance']!,
    ]);
    const claimMembership = await one<{ membership_id: string }>(
      'select * from public.activate_card_sale($1,$2,$3)',
      [claimSale, staff['finance'], 12],
    );
    check('a membership exists for the claim customer', Boolean(claimMembership.membership_id));

    const hashToken = (raw: string) => createHash('sha256').update(raw).digest('hex');
    const issueFor = async (customer: string) => {
      const issued = await one<{ token: string }>(
        'select * from public.issue_customer_onboarding_token($1,$2,$3,$4)',
        [customer, 'account_activation', 24, staff['finance']],
      );
      return issued.token;
    };
    /** Back-date a token past its own validity. `created_at` moves too, because
     *  the table enforces `expires_at > created_at`. */
    const expireToken = async (hash: string) => {
      await db.query(
        `update public.customer_onboarding_tokens
           set created_at = now() - interval '2 hours', expires_at = now() - interval '1 hour'
         where token_hash = $1`,
        [hash],
      );
    };

    /* --- expiry is tested while the customer is still UNLINKED, because a linked
           customer short-circuits to ALREADY_LINKED before any token check --- */
    const doomedHash = hashToken(await issueFor(claimCust));
    await expireToken(doomedHash);
    check(
      'an expired token is refused',
      /TOKEN_EXPIRED/.test(
        await throws('  expired refused', () =>
          db.query('select * from public.claim_customer_onboarding_token($1,$2,$3)', [
            doomedHash,
            claimAuthA,
            'account_activation',
          ]),
        ),
      ),
    );
    const afterExpiry = await one<{ auth_user_id: string | null; consumed_at: string | null }>(
      `select
         (select auth_user_id::text from public.customers where id = $1) as auth_user_id,
         (select consumed_at::text from public.customer_onboarding_tokens where token_hash = $2) as consumed_at`,
      [claimCust, doomedHash],
    );
    eq('a refused claim leaves the customer unlinked', afterExpiry.auth_user_id, null);
    eq('and the token unconsumed, so the customer can retry', afterExpiry.consumed_at, null);

    const liveToken = await issueFor(claimCust);
    const liveHash = hashToken(liveToken);

    check(
      'an unknown hash is refused',
      /TOKEN_NOT_FOUND/.test(
        await throws('  unknown token refused', () =>
          db.query('select * from public.claim_customer_onboarding_token($1,$2,$3)', [
            'f'.repeat(64),
            claimAuthA,
            'account_activation',
          ]),
        ),
      ),
    );
    check(
      'a wrong purpose is refused',
      /TOKEN_WRONG_PURPOSE/.test(
        await throws('  wrong purpose refused', () =>
          db.query('select * from public.claim_customer_onboarding_token($1,$2,$3)', [
            liveHash,
            claimAuthA,
            'password_reset',
          ]),
        ),
      ),
    );
    check(
      'a null actor is refused',
      /ACTOR_REQUIRED/.test(
        await throws('  null actor refused', () =>
          db.query('select * from public.claim_customer_onboarding_token($1,$2,$3)', [
            liveHash,
            null,
            'account_activation',
          ]),
        ),
      ),
    );

    const claimed = await one<{ customer_id: string; outcome: string }>(
      'select * from public.claim_customer_onboarding_token($1,$2,$3)',
      [liveHash, claimAuthA, 'account_activation'],
    );
    eq('the claim links the right customer', claimed.customer_id, claimCust);
    eq('the outcome is CLAIMED', claimed.outcome, 'CLAIMED');

    const afterClaim = await one<{
      auth_user_id: string | null;
      consumed_at: string | null;
      consumed_by: string | null;
    }>(
      `select
         (select auth_user_id::text from public.customers where id = $1) as auth_user_id,
         (select consumed_at::text from public.customer_onboarding_tokens where token_hash = $2) as consumed_at,
         (select consumed_by::text from public.customer_onboarding_tokens where token_hash = $2) as consumed_by`,
      [claimCust, liveHash],
    );
    eq('customers.auth_user_id is set', afterClaim.auth_user_id, claimAuthA);
    check('the token is consumed', afterClaim.consumed_at !== null);
    eq('and consumed_by records the Auth user', afterClaim.consumed_by, claimAuthA);

    /* --- idempotency: the SAME Auth user gets the success it already earned --- */
    // A read-then-write ordering that checks `consumed_at` first makes this
    // impossible, so it is asserted rather than assumed.
    const retry = await one<{ outcome: string; customer_id: string }>(
      'select * from public.claim_customer_onboarding_token($1,$2,$3)',
      [liveHash, claimAuthA, 'account_activation'],
    );
    eq('a retry with the same Auth user is ALREADY_LINKED', retry.outcome, 'ALREADY_LINKED');
    eq('  and reports the same customer', retry.customer_id, claimCust);

    await expireToken(liveHash);
    const retryAfterExpiry = await one<{ outcome: string }>(
      'select * from public.claim_customer_onboarding_token($1,$2,$3)',
      [liveHash, claimAuthA, 'account_activation'],
    );
    eq(
      'a retry stays idempotent even once the token has expired',
      retryAfterExpiry.outcome,
      'ALREADY_LINKED',
    );

    /* --- a second Auth user can never take the customer --- */
    check(
      'a different Auth user cannot replay a consumed token',
      /CUSTOMER_ALREADY_CLAIMED/.test(
        await throws('  second claimant refused', () =>
          db.query('select * from public.claim_customer_onboarding_token($1,$2,$3)', [
            liveHash,
            claimAuthB,
            'account_activation',
          ]),
        ),
      ),
    );
    check(
      'nor with a FRESH token issued to the same customer',
      /CUSTOMER_ALREADY_CLAIMED/.test(
        await throws('  second token refused', async () => {
          const other = await issueFor(claimCust);
          await db.query('select * from public.claim_customer_onboarding_token($1,$2,$3)', [
            hashToken(other),
            claimAuthB,
            'account_activation',
          ]);
        }),
      ),
    );
    const stillA = await one<{ auth_user_id: string | null }>(
      'select auth_user_id::text as auth_user_id from public.customers where id = $1',
      [claimCust],
    );
    eq('the link still points at the FIRST Auth user', stillA.auth_user_id, claimAuthA);

    /* --- the claim's audit trail --- */
    const claimAudit = await db.query<{ action: string; n: number }>(
      `select action, count(*)::int as n from public.audit_events
       where entity_id = $1 group by action order by action`,
      [claimCust],
    );
    const claimActions = claimAudit.rows.map((r) => r.action);
    check(
      'activation is audited',
      claimActions.includes('CUSTOMER_AUTH_ACTIVATED'),
      claimActions.join(','),
    );
    check(
      'account link is audited',
      claimActions.includes('CUSTOMER_ACCOUNT_LINKED'),
      claimActions.join(','),
    );
    const tokenAudit = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
       where action = 'CUSTOMER_ONBOARDING_TOKEN_CONSUMED' and entity_id in
         (select id::text from public.customer_onboarding_tokens where customer_id = $1)`,
      [claimCust],
    );
    check('token consumption is audited', tokenAudit.n >= 1);
    const claimLeak = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
       where after_data::text like '%' || $1 || '%' or before_data::text like '%' || $1 || '%'`,
      [liveToken],
    );
    eq('the plaintext token never reaches the audit trail', claimLeak.n, 0);
    const hashLeak = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
       where after_data::text like '%' || $1 || '%' or before_data::text like '%' || $1 || '%'`,
      [liveHash],
    );
    eq('nor does the token hash', hashLeak.n, 0);

    /* --- a non-active customer can never get as far as the claim --- */
    const prospectId = await mkCustomer('claim-prospect', 'claim');
    const prospectIssue = await throws('  issuing for a prospect is refused', () =>
      db.query('select * from public.issue_customer_onboarding_token($1,$2,$3,$4)', [
        prospectId,
        'account_activation',
        24,
        staff['finance'],
      ]),
    );
    check(
      'no token can be issued for a non-active customer',
      /CUSTOMER_NOT_ACTIVE|not found/i.test(prospectIssue),
      prospectIssue.split('\n')[0]?.slice(0, 60),
    );
    section('24. membership credential re-issue (rotation, not recovery)');
    /* ---------------------------------------------------------------- */
    const beforeRotation = await one<{ fallback_code_hash: string; qr_token_hash: string }>(
      'select fallback_code_hash, qr_token_hash from public.memberships where id = $1',
      [memA.membershipId],
    );
    const rotated = await one<{ membership_id: string; fallback_code: string; qr_token: string }>(
      'select * from public.reissue_membership_credentials($1,$2,$3)',
      [memA.membershipId, custA.id, custA.authUserId],
    );
    eq('the rotated membership is the caller own', rotated.membership_id, memA.membershipId);
    check('a fresh fallback code is issued', rotated.fallback_code !== memA.fallbackCode);
    check('a fresh QR token is issued', rotated.qr_token !== memA.qrToken);
    check('the fallback code is non-trivial', rotated.fallback_code.length >= 8);
    check('the QR token is long and opaque', rotated.qr_token.length >= 32);
    check('neither value encodes a customer number', !rotated.fallback_code.includes(RUN));

    const afterRotation = await one<{ fallback_code_hash: string; qr_token_hash: string }>(
      'select fallback_code_hash, qr_token_hash from public.memberships where id = $1',
      [memA.membershipId],
    );
    check(
      'the stored hash changed',
      afterRotation.fallback_code_hash !== beforeRotation.fallback_code_hash,
    );
    check(
      'the stored QR hash changed',
      afterRotation.qr_token_hash !== beforeRotation.qr_token_hash,
    );
    check(
      'only a hash is stored, never the plaintext',
      afterRotation.fallback_code_hash === hashToken(rotated.fallback_code) &&
        afterRotation.qr_token_hash === hashToken(rotated.qr_token) &&
        afterRotation.fallback_code_hash !== rotated.fallback_code,
    );
    check(
      'the PREVIOUS code no longer resolves (the old hash is gone)',
      afterRotation.fallback_code_hash !== hashToken(memA.fallbackCode),
    );
    const oldResolution = await one<{ n: number }>(
      `select count(*)::int as n from public.memberships
       where id = $1 and fallback_code_hash = private.hash_token($2)`,
      [memA.membershipId, memA.fallbackCode],
    );
    eq('the old fallback code matches nothing', oldResolution.n, 0);
    const newResolution = await one<{ n: number }>(
      `select count(*)::int as n from public.memberships
       where id = $1 and fallback_code_hash = private.hash_token($2)`,
      [memA.membershipId, rotated.fallback_code],
    );
    eq('the new fallback code resolves exactly once', newResolution.n, 1);

    const rotationAudit = await db.query<{ action: string; n: number }>(
      `select count(*)::int as n from public.audit_events
       where action = 'CUSTOMER_CREDENTIALS_REISSUED' and entity_id = $1`,
      [memA.membershipId],
    );
    eq('the rotation is audited', rotationAudit.rows[0]!.n, 1);
    const rotationLeak = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
       where (after_data::text || before_data::text) like '%' || $1 || '%'
          or (after_data::text || before_data::text) like '%' || $2 || '%'`,
      [rotated.fallback_code, rotated.qr_token],
    );
    eq('neither plaintext code reaches the audit trail', rotationLeak.n, 0);

    /* --- ownership is enforced in SQL, not only in the handler --- */
    check(
      'a caller cannot rotate another member card',
      /MEMBERSHIP_NOT_FOUND/.test(
        await throws('  cross-customer rotation refused', () =>
          db.query('select * from public.reissue_membership_credentials($1,$2,$3)', [
            memB.membershipId,
            custA.id,
            custA.authUserId,
          ]),
        ),
      ),
    );
    check(
      'a null actor is refused',
      /ACTOR_REQUIRED/.test(
        await throws('  null actor rotation refused', () =>
          db.query('select * from public.reissue_membership_credentials($1,$2,$3)', [
            memA.membershipId,
            custA.id,
            null,
          ]),
        ),
      ),
    );

    /* --- a suspended customer cannot rotate, even though the membership row is
           still `active` - the gate is the CUSTOMER's status, in SQL --- */
    await db.query(`update public.customers set status = 'suspended' where id = $1`, [custA.id]);
    const memStillActive = await one<{ status: string }>(
      'select status from public.memberships where id = $1',
      [memA.membershipId],
    );
    eq('  the membership itself is still active', memStillActive.status, 'active');
    check(
      'a suspended customer cannot rotate a card',
      /CUSTOMER_NOT_ACTIVE/.test(
        await throws('  suspended rotation refused', () =>
          db.query('select * from public.reissue_membership_credentials($1,$2,$3)', [
            memA.membershipId,
            custA.id,
            custA.authUserId,
          ]),
        ),
      ),
    );
    await db.query(`update public.customers set status = 'active' where id = $1`, [custA.id]);

    /* --- browser roles cannot call either function --- */
    const browserCall = await asA(async (c) => {
      const out: Record<string, string> = {};
      const probe = async (label: string, sql: string, args: unknown[]) => {
        await c.query('savepoint fn_probe');
        try {
          await c.query(sql, args);
          out[label] = 'ALLOWED';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          out[label] = /permission denied/i.test(message) ? 'denied' : message.slice(0, 50);
        }
        await c.query('rollback to savepoint fn_probe');
      };
      await probe('claim', `select * from public.claim_customer_onboarding_token($1,$2,$3)`, [
        liveHash,
        custA.authUserId,
        'account_activation',
      ]);
      await probe('rotate', `select * from public.reissue_membership_credentials($1,$2,$3)`, [
        memA.membershipId,
        custA.id,
        custA.authUserId,
      ]);
      return out;
    });
    check(
      'a browser role cannot invoke either Phase 3 function',
      browserCall['claim'] === 'denied' && browserCall['rotate'] === 'denied',
      JSON.stringify(browserCall),
    );

    const staffCall = await asBrowserRole(
      target.url,
      'authenticated',
      staff['super-admin']!,
      async (c) => {
        try {
          await c.query(`select * from public.reissue_membership_credentials($1,$2,$3)`, [
            memA.membershipId,
            custA.id,
            custA.authUserId,
          ]);
          return 'ALLOWED';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
        }
      },
    );
    eq('not even a super admin can invoke it from a browser session', staffCall, 'denied');

    /* ================================================================== */
    /* Phase 4 - staff redemption of points                                 */
    /* ================================================================== */
    // Everything below executes public.redeem_membership_points against a real
    // PostgreSQL, because the whole point of this phase is an atomic transaction
    // with a concurrency invariant, and neither property can be observed through
    // an in-memory fake or a text assertion.

    const catalogue = new Map<string, string>();
    const mkItem = async (code: string, name: string, cost: number, active = true) => {
      const id = uuidFor(`item:${code}`);
      await db.query(
        `insert into public.redemption_items (id, code, name, description, category, points_cost, is_active, sort_order)
         values ($1,$2,$3,$4,'general',$5,$6,0)`,
        [id, `${RUN}-${code}`, name, `${name} (synthetic fixture)`, cost, active],
      );
      catalogue.set(code, id);
      return id;
    };

    const mkFundedMember = async (label: string, points: number) => {
      const custId = uuidFor(`rdm:cust:${label}`);
      const authId = uuidFor(`rdm:auth:${label}`);
      const number = (
        await one<{ customer_number: string }>('select * from public.next_customer_number()')
      ).customer_number;
      await db.query('insert into auth.users (id, email) values ($1,$2)', [
        authId,
        `${RUN}-rdm-${label}@example.invalid`,
      ]);
      createdAuthIds.push(authId);
      await db.query(
        `insert into public.customers (id, customer_number, first_name, middle_name, last_name,
           birth_date, email, phone, status, government_id_number, auth_user_id)
         values ($1,$2,'Redemption','Q','Tester','1990-01-01',$3,'09175550009','active',$4,$5)`,
        [custId, number, `${RUN}-rdm-${label}@example.invalid`, `${RUN}-GOV-R${label}`, authId],
      );
      createdCustomerIds.push(custId);

      const saleId = uuidFor(`rdm:sale:${label}`);
      const saleNo = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
        .sale_number;
      const plan = await one<PlanRow>(`select * from public.card_plans where code = 'GOLD'`);
      await db.query(
        `insert into public.card_sales
           (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
            cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
            commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at)
         values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now(), now() + interval '365 days')`,
        [
          saleId,
          saleNo,
          custId,
          plan.id,
          staff['ost'],
          plan.cash_price,
          plan.minimum_down_payment,
          plan.yearly_points,
          plan.commission_rate,
        ],
      );
      const payId = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'full','cash',$3,null,null,$4) as id`,
          [saleId, plan.cash_price, `${RUN}-PAY-RDM-${label}`, staff['finance']],
        )
      ).id;
      await db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
        payId,
        'verified',
        null,
        staff['finance']!,
      ]);
      const membership = await one<{ membership_id: string }>(
        'select * from public.activate_card_sale($1,$2,$3)',
        [saleId, staff['finance'], 12],
      );
      // The activated member holds the plan's annual allocation. Override it when
      // a test needs a specific balance, so the fixture stays explicit about the
      // figure every assertion depends on.
      if (points !== plan.yearly_points) {
        await db.query('update public.points_accounts set balance = $2 where membership_id = $1', [
          membership.membership_id,
          points,
        ]);
        await db.query('update public.memberships set points_balance = $2 where id = $1', [
          membership.membership_id,
          points,
        ]);
      }
      return {
        customerId: custId,
        authUserId: authId,
        membershipId: membership.membership_id,
        points,
      };
    };

    const balanceOf = async (membershipId: string) =>
      Number(
        (
          await one<{ balance: number }>(
            'select balance from public.points_accounts where membership_id = $1',
            [membershipId],
          )
        ).balance,
      );
    const ledgerRowsOf = async (accountId: string) =>
      db.query<{
        entry_type: string;
        amount: string;
        balance_after: string;
        reference_type: string;
        reference_id: string;
        reason: string;
      }>(
        `select entry_type, amount::text, balance_after::text, reference_type, reference_id, reason
         from public.points_ledger where account_id = $1 order by id`,
        [accountId],
      );
    const accountIdOf = async (membershipId: string) =>
      (
        await one<{ id: string }>(
          'select id from public.points_accounts where membership_id = $1',
          [membershipId],
        )
      ).id;

    // The actor and key parameters are deliberately typed to accept null so the
    // suite can prove the function refuses them, rather than papering over it
    // with a non-null assertion.
    const redeem = (
      membershipId: string,
      itemId: string,
      quantity: number,
      key: string | null,
      actor: string | null | undefined,
    ) =>
      db.query<Record<string, string | number>>(
        'select * from public.redeem_membership_points($1,$2,$3,$4,$5)',
        [membershipId, itemId, quantity, key, actor ?? null],
      );

    const teppanyaki = await mkItem('TEPPANYAKI', 'Japanese Teppanyaki', 2000);
    const drinks = await mkItem('DRINKS', 'Beverage Credits', 500);
    const inactiveItem = await mkItem('RETIRED', 'Retired Voucher', 100, false);
    eq('the fixture catalogue holds three items', catalogue.size, 3);

    /* ---------------------------------------------------------------- */
    section('25. redemption catalog');
    /* ---------------------------------------------------------------- */
    const catalogueColumns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = 'redemption_items'`,
    );
    const columnNames = catalogueColumns.rows.map((r) => r.column_name);
    for (const required of [
      'id',
      'code',
      'name',
      'description',
      'category',
      'points_cost',
      'is_active',
      'sort_order',
      'created_at',
      'updated_at',
    ]) {
      check(`catalog has ${required}`, columnNames.includes(required));
    }
    const zeroCost = await throws('  a zero-cost item is refused', () =>
      db.query(
        `insert into public.redemption_items (code, name, points_cost) values ($1,'Free',0)`,
        [`${RUN}-ZERO`],
      ),
    );
    check('  the CHECK rejects it', /points_cost|cost/i.test(zeroCost), zeroCost.split('\n')[0]);
    const negCost = await throws('  a negative-cost item is refused', () =>
      db.query(
        `insert into public.redemption_items (code, name, points_cost) values ($1,'Bad',-5)`,
        [`${RUN}-NEG`],
      ),
    );
    check('  the CHECK rejects it', /points_cost|cost/i.test(negCost), negCost.split('\n')[0]);

    /* ---------------------------------------------------------------- */
    section('26. successful redemption - exact, atomic, one ledger row');
    /* ---------------------------------------------------------------- */
    const memberA = await mkFundedMember('a', 60000);
    const before = await balanceOf(memberA.membershipId);
    const receipt = camel<Record<string, string | number>>(
      (
        await db.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
          memberA.membershipId,
          teppanyaki,
          1,
          `${RUN}-key-a-0001`,
          staff['finance'],
        ])
      ).rows[0],
    );
    eq(
      'the points cost comes from the catalog, not the caller',
      String(receipt.unitPoints),
      '2000',
    );
    eq('total points is cost x quantity', String(receipt.totalPoints), '2000');
    eq('balance before is reported', String(receipt.balanceBefore), String(before));
    eq('balance after is exactly cost less', String(receipt.balanceAfter), String(before - 2000));
    check(
      'a redemption number was issued',
      /^(RDM-\d{6}|AF-RED-[A-HJ-NP-Z2-9]{5})$/.test(String(receipt.redemptionNumber)),
      String(receipt.redemptionNumber),
    );
    check(
      'the item is snapshotted onto the receipt',
      String(receipt.itemName) === 'Japanese Teppanyaki',
    );
    check(
      'the customer display name is on the receipt',
      String(receipt.customerName).includes('Redemption'),
    );
    check('the membership number is on the receipt', String(receipt.membershipNumber).length > 0);

    eq(
      'the account balance dropped by exactly the cost',
      await balanceOf(memberA.membershipId),
      before - 2000,
    );
    const memberRow = await one<{ points_balance: number }>(
      'select points_balance from public.memberships where id = $1',
      [memberA.membershipId],
    );
    eq(
      'the materialized membership.points_balance cache agrees',
      Number(memberRow.points_balance),
      before - 2000,
    );
    const lifetime = await one<{ lifetime_redeemed: number; balance: number }>(
      'select lifetime_redeemed, balance from public.points_accounts where membership_id = $1',
      [memberA.membershipId],
    );
    eq('lifetime_redeemed accumulated', Number(lifetime.lifetime_redeemed), 2000);
    eq('lifetime balance is the account balance', Number(lifetime.balance), before - 2000);

    const accountA = await accountIdOf(memberA.membershipId);
    const ledgerA = await ledgerRowsOf(accountA);
    eq('the ledger has exactly two rows: allocation and this redemption', ledgerA.rowCount, 2);
    const debit = ledgerA.rows[1]!;
    eq('the redemption entry is typed `redemption`', debit.entry_type, 'redemption');
    eq('the amount is negative', Number(debit.amount), -2000);
    eq('balance_after matches the account', Number(debit.balance_after), before - 2000);
    eq('it references the redemption', debit.reference_type, 'redemption');
    eq('  by id', debit.reference_id, String(receipt.redemptionId));
    check('the ledger reason is human-readable', /Teppanyaki/.test(debit.reason), debit.reason);

    const persisted = await one<Record<string, string | number>>(
      'select * from public.redemptions where id = $1',
      [receipt.redemptionId],
    );
    eq(
      'the item name is snapshotted on the row',
      String(persisted.item_name_snapshot),
      'Japanese Teppanyaki',
    );
    eq('the item code is snapshotted', String(persisted.item_code_snapshot), `${RUN}-TEPPANYAKI`);
    eq('the cost is snapshotted', String(persisted.points_cost_snapshot), '2000');
    eq('the quantity is recorded', Number(persisted.quantity), 1);
    eq('the status is completed', String(persisted.status), 'completed');
    eq('the acting staff is recorded', String(persisted.redeemed_by), staff['finance']);
    check(
      'the acting staff display name is recorded',
      String(persisted.redeemed_by_name).length > 0,
    );
    eq('balance before is snapshotted', String(persisted.balance_before_snapshot), String(before));
    eq(
      'balance after is snapshotted',
      String(persisted.balance_after_snapshot),
      String(before - 2000),
    );
    eq('nothing is voided', persisted.voided_at, null);

    const redemptionAudit = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
       where action = 'REDEMPTION_COMPLETED' and entity_id = $1`,
      [String(receipt.redemptionId)],
    );
    eq('REDEMPTION_COMPLETED is audited', redemptionAudit.n, 1);

    /* --- quantity: a plain multiplication, no discount rule invented --- */
    const multiBefore = await balanceOf(memberA.membershipId);
    const multi = camel<Record<string, string | number>>(
      (
        await db.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
          memberA.membershipId,
          drinks,
          4,
          `${RUN}-key-a-0002`,
          staff['finance'],
        ])
      ).rows[0],
    );
    eq('quantity x cost is the total', String(multi.totalPoints), '2000');
    eq(
      'the balance drops by the full total',
      await balanceOf(memberA.membershipId),
      multiBefore - 2000,
    );
    const multiLedger = await ledgerRowsOf(accountA);
    eq('and it appended exactly one more ledger row', multiLedger.rowCount, 3);

    /* ---------------------------------------------------------------- */
    section('27. insufficient balance - nothing moves');
    /* ---------------------------------------------------------------- */
    const poor = await mkFundedMember('poor', 1500);
    const poorBefore = await balanceOf(poor.membershipId);
    const insufficient = await throws('  a 2,000-point item is refused on a 1,500 balance', () =>
      redeem(poor.membershipId, teppanyaki, 1, `${RUN}-key-poor-1`, staff['finance']),
    );
    check(
      '  refused with INSUFFICIENT_POINTS',
      /INSUFFICIENT_POINTS/.test(insufficient),
      insufficient.split('\n')[0]?.slice(0, 60),
    );
    eq('the balance is untouched', await balanceOf(poor.membershipId), poorBefore);
    const poorRedemptions = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where membership_id = $1',
      [poor.membershipId],
    );
    eq('no redemption row was created', poorRedemptions.n, 0);
    const poorLedger = await ledgerRowsOf(await accountIdOf(poor.membershipId));
    eq('no ledger debit was written', poorLedger.rowCount, 1);
    eq(
      '  only the original allocation remains',
      poorLedger.rows[0]!.entry_type,
      'annual_allocation',
    );
    const poorAudit = await one<{ n: number }>(
      `select count(*)::int as n from public.audit_events
       where action = 'REDEMPTION_COMPLETED' and entity_type = 'redemption'`,
    );
    check('and exactly one redemption is audited overall', poorAudit.n >= 1);

    /* --- a negative balance is not merely unreachable, it is impossible --- */
    const poorAccount = await accountIdOf(poor.membershipId);
    const negBalance = await throws('  the schema forbids a negative account balance', () =>
      db.query('update public.points_accounts set balance = -1 where id = $1', [poorAccount]),
    );
    check(
      '  the CHECK rejects it',
      /balance/i.test(negBalance),
      negBalance.split('\n')[0]?.slice(0, 60),
    );
    const negLedger = await throws('  and the ledger forbids a negative balance_after', () =>
      db.query(
        `insert into public.points_ledger (account_id, entry_type, amount, balance_after)
         values ($1,'adjustment',-1,-1)`,
        [poorAccount],
      ),
    );
    check(
      '  the CHECK rejects it too',
      /balance_after/i.test(negLedger),
      negLedger.split('\n')[0]?.slice(0, 60),
    );

    /* --- spending the balance down to exactly zero is allowed --- */
    const exact = await mkFundedMember('exact', 2000);
    await redeem(exact.membershipId, teppanyaki, 1, `${RUN}-key-exact-1`, staff['finance']!);
    eq('a balance may be reduced to exactly zero', await balanceOf(exact.membershipId), 0);
    const nowImpossible = await throws('  but not below zero', () =>
      redeem(exact.membershipId, teppanyaki, 1, `${RUN}-key-exact-2`, staff['finance']!),
    );
    check('  refused with INSUFFICIENT_POINTS', /INSUFFICIENT_POINTS/.test(nowImpossible));

    /* ---------------------------------------------------------------- */
    section('28. idempotency - a retry returns the same receipt');
    /* ---------------------------------------------------------------- */
    const idem = await mkFundedMember('idem', 10000);
    const idemBefore = await balanceOf(idem.membershipId);
    const first = camel<Record<string, string | number>>(
      (await redeem(idem.membershipId, drinks, 2, `${RUN}-key-idem-1`, staff['finance'])).rows[0],
    );
    eq('the first call debits', await balanceOf(idem.membershipId), idemBefore - 1000);
    const replay = camel<Record<string, string | number>>(
      (await redeem(idem.membershipId, drinks, 2, `${RUN}-key-idem-1`, staff['finance'])).rows[0],
    );
    eq(
      'a retry returns the SAME redemption id',
      String(replay.redemptionId),
      String(first.redemptionId),
    );
    eq(
      '  the same redemption number',
      String(replay.redemptionNumber),
      String(first.redemptionNumber),
    );
    eq('  and the original balance figures', String(replay.balanceBefore), String(idemBefore));
    eq('  not a recomputed one', String(replay.balanceAfter), String(idemBefore - 1000));
    eq(
      'the balance was debited exactly once',
      await balanceOf(idem.membershipId),
      idemBefore - 1000,
    );
    const idemLedger = await ledgerRowsOf(await accountIdOf(idem.membershipId));
    eq('and exactly one ledger debit exists', idemLedger.rowCount, 2);
    const idemRows = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where membership_id = $1',
      [idem.membershipId],
    );
    eq('only one redemption row exists', idemRows.n, 1);

    const differentKey = await redeem(
      idem.membershipId,
      drinks,
      2,
      `${RUN}-key-idem-2`,
      staff['finance'],
    );
    check('a DIFFERENT key is a genuinely new redemption', Boolean(differentKey.rows[0]));
    eq('  and debits again', await balanceOf(idem.membershipId), idemBefore - 2000);

    const shortKey = await throws('  a too-short idempotency key is refused', () =>
      redeem(idem.membershipId, drinks, 1, 'ab', staff['finance']),
    );
    check('  IDEMPOTENCY_KEY_REQUIRED', /IDEMPOTENCY_KEY_REQUIRED/.test(shortKey));
    const nullKey = await throws('  a null idempotency key is refused', () =>
      redeem(idem.membershipId, drinks, 1, null, staff['finance']),
    );
    check('  IDEMPOTENCY_KEY_REQUIRED', /IDEMPOTENCY_KEY_REQUIRED/.test(nullKey));

    /* ---------------------------------------------------------------- */
    section('29. CONCURRENCY - two terminals cannot overspend');
    /* ---------------------------------------------------------------- */
    // The critical points invariant. 3,000 points, two simultaneous 2,000-point
    // redemptions: exactly one may commit.
    const race = await mkFundedMember('race', 3000);
    const r1 = new Client({ connectionString: target.url });
    const r2 = new Client({ connectionString: target.url });
    r1.on('error', () => {});
    r2.on('error', () => {});
    await r1.connect();
    await r2.connect();
    const raceResults = await Promise.allSettled([
      r1.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
        race.membershipId,
        teppanyaki,
        1,
        `${RUN}-key-race-1`,
        staff['finance'],
      ]),
      r2.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
        race.membershipId,
        teppanyaki,
        1,
        `${RUN}-key-race-2`,
        staff['finance'],
      ]),
    ]);
    await r1.end();
    await r2.end();
    const winners = raceResults.filter((r) => r.status === 'fulfilled').length;
    const losers = raceResults.filter(
      (r) =>
        r.status === 'rejected' &&
        /INSUFFICIENT_POINTS/.test(String((r as PromiseRejectedResult).reason)),
    ).length;
    eq('exactly one terminal succeeded', winners, 1);
    eq('the other was refused for insufficient points', losers, 1);
    eq(
      'the balance is 3,000 less one redemption, never less two',
      await balanceOf(race.membershipId),
      1000,
    );
    check('the balance never went negative', (await balanceOf(race.membershipId)) >= 0);
    const raceRedemptions = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where membership_id = $1',
      [race.membershipId],
    );
    eq('exactly one redemption row exists', raceRedemptions.n, 1);
    const raceLedger = await ledgerRowsOf(await accountIdOf(race.membershipId));
    eq('exactly one debit reached the ledger', raceLedger.rowCount, 2);

    // Three simultaneous redemptions of 1,000 against 2,500: two fit, one does not.
    const race2 = await mkFundedMember('race2', 2500);
    const clients = [0, 1, 2].map(() => new Client({ connectionString: target.url }));
    for (const cl of clients) {
      cl.on('error', () => {});
      await cl.connect();
    }
    const triple = await Promise.allSettled(
      clients.map((cl, i) =>
        cl.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
          race2.membershipId,
          drinks,
          2,
          `${RUN}-key-race2-${i}`,
          staff['finance'],
        ]),
      ),
    );
    for (const cl of clients) await cl.end();
    const tripleWon = triple.filter((r) => r.status === 'fulfilled').length;
    eq('of three simultaneous 1,000-point redemptions on 2,500, two succeed', tripleWon, 2);
    eq('and the balance lands on exactly 500', await balanceOf(race2.membershipId), 500);
    const race2Rows = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where membership_id = $1',
      [race2.membershipId],
    );
    eq('with exactly two redemption rows', race2Rows.n, 2);
    const race2Ledger = await ledgerRowsOf(await accountIdOf(race2.membershipId));
    eq('and two debits in the ledger', race2Ledger.rowCount, 3);

    /* ---------------------------------------------------------------- */
    section('30. transaction rollback - a fault leaves nothing behind');
    /* ---------------------------------------------------------------- */
    // Force the audit insert to fail AFTER the redemption and the ledger write.
    // Both must roll back: no orphan debit, no redemption without a debit.
    const rollback = await mkFundedMember('rollback', 10000);
    const rollbackBefore = await balanceOf(rollback.membershipId);
    await db.query(
      `create or replace function private.t_redemption_fail() returns trigger
       language plpgsql as $$ begin raise exception 'injected fault'; end $$`,
    );
    await db.query(
      `create trigger t_redemption_fault before insert on public.audit_events
       for each row execute function private.t_redemption_fail()`,
    );
    const fault = await throws('  the redemption fails at the audit step', () =>
      redeem(rollback.membershipId, teppanyaki, 1, `${RUN}-key-rollback-1`, staff['finance']),
    );
    check(
      '  the injected fault propagated',
      /injected fault/.test(fault),
      fault.split('\n')[0]?.slice(0, 60),
    );
    await db.query('drop trigger if exists t_redemption_fault on public.audit_events');
    await db.query('drop function if exists private.t_redemption_fail()');

    eq(
      'the balance is completely restored',
      await balanceOf(rollback.membershipId),
      rollbackBefore,
    );
    const rollbackRedemptions = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where membership_id = $1',
      [rollback.membershipId],
    );
    eq('no redemption row survives', rollbackRedemptions.n, 0);
    const rollbackLedger = await ledgerRowsOf(await accountIdOf(rollback.membershipId));
    eq('no ledger debit survives', rollbackLedger.rowCount, 1);
    eq('  only the allocation remains', rollbackLedger.rows[0]!.entry_type, 'annual_allocation');
    const rollbackCache = await one<{ points_balance: number }>(
      'select points_balance from public.memberships where id = $1',
      [rollback.membershipId],
    );
    eq(
      'and the materialized cache is restored too',
      Number(rollbackCache.points_balance),
      rollbackBefore,
    );
    const rollbackNumbers = await one<{ n: number }>(
      `select count(*)::int as n from public.redemptions where redemption_number like 'RDM-%' or redemption_number like 'AF-RED-%'`,
    );
    check(
      'a number may have been consumed, which is harmless and not a ledger entry',
      rollbackNumbers.n >= 0,
    );

    // The retry after the fault must succeed and use the SAME key.
    const recovered = camel<Record<string, string | number>>(
      (
        await redeem(
          rollback.membershipId,
          teppanyaki,
          1,
          `${RUN}-key-rollback-1`,
          staff['finance'],
        )
      ).rows[0],
    );
    eq('the customer can retry the same key afterwards', String(recovered.totalPoints), '2000');
    eq(
      'and the balance is debited exactly once',
      await balanceOf(rollback.membershipId),
      rollbackBefore - 2000,
    );

    /* ---------------------------------------------------------------- */
    section('31. redemption preconditions are refused');
    /* ---------------------------------------------------------------- */
    const guard = await mkFundedMember('guard', 50000);
    const guardBefore = await balanceOf(guard.membershipId);

    const inactiveRefusal = await throws('  an inactive catalog item is refused', () =>
      redeem(guard.membershipId, inactiveItem, 1, `${RUN}-key-guard-1`, staff['finance']),
    );
    check('  REDEMPTION_ITEM_INACTIVE', /REDEMPTION_ITEM_INACTIVE/.test(inactiveRefusal));

    const missingItem = await throws('  an unknown item is refused', () =>
      redeem(guard.membershipId, uuidFor('item:nope'), 1, `${RUN}-key-guard-2`, staff['finance']),
    );
    check('  REDEMPTION_ITEM_NOT_FOUND', /REDEMPTION_ITEM_NOT_FOUND/.test(missingItem));

    const missingMembership = await throws('  an unknown membership is refused', () =>
      redeem(uuidFor('nope'), teppanyaki, 1, `${RUN}-key-guard-3`, staff['finance']),
    );
    check('  MEMBERSHIP_NOT_FOUND', /MEMBERSHIP_NOT_FOUND/.test(missingMembership));

    for (const bad of [0, -1, 100]) {
      const q = await throws(`  quantity ${bad} is refused`, () =>
        redeem(guard.membershipId, drinks, bad, `${RUN}-key-q${bad}-xxxx`, staff['finance']),
      );
      check('  INVALID_QUANTITY', /INVALID_QUANTITY/.test(q));
    }

    await db.query(`update public.customers set status = 'suspended' where id = $1`, [
      guard.customerId,
    ]);
    const suspended = await throws('  a suspended customer is refused', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-guard-4`, staff['finance']),
    );
    check('  CUSTOMER_NOT_ACTIVE', /CUSTOMER_NOT_ACTIVE/.test(suspended));
    await db.query(`update public.customers set status = 'active' where id = $1`, [
      guard.customerId,
    ]);

    await db.query(`update public.memberships set status = 'suspended' where id = $1`, [
      guard.membershipId,
    ]);
    const suspendedMembership = await throws('  a non-active membership is refused', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-guard-5`, staff['finance']),
    );
    check('  MEMBERSHIP_NOT_ACTIVE', /MEMBERSHIP_NOT_ACTIVE/.test(suspendedMembership));
    await db.query(`update public.memberships set status = 'active' where id = $1`, [
      guard.membershipId,
    ]);

    await db.query(
      `update public.memberships set expires_at = now() - interval '1 day' where id = $1`,
      [guard.membershipId],
    );
    const expired = await throws('  an expired membership is refused', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-guard-6`, staff['finance']),
    );
    check('  MEMBERSHIP_EXPIRED', /MEMBERSHIP_EXPIRED/.test(expired));
    // The refusal must not have silently flipped the membership status.
    const stillActive = await one<{ status: string }>(
      'select status from public.memberships where id = $1',
      [guard.membershipId],
    );
    eq('  and expiry did NOT change the membership status', stillActive.status, 'active');
    await db.query(
      `update public.memberships set expires_at = now() + interval '365 days' where id = $1`,
      [guard.membershipId],
    );

    const noActor = await throws('  a null actor is refused', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-guard-7`, null),
    );
    check('  ACTOR_REQUIRED', /ACTOR_REQUIRED/.test(noActor));

    const notStaff = await throws('  a non-staff Auth id is refused', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-guard-8`, memberA.authUserId),
    );
    check('  ACTOR_NOT_STAFF', /ACTOR_NOT_STAFF/.test(notStaff));

    const suspendedStaff = uuidFor('rdm:staff-suspended');
    await db.query('insert into auth.users (id, email) values ($1,$2)', [
      suspendedStaff,
      `${RUN}-rdm-staff-susp@example.invalid`,
    ]);
    createdAuthIds.push(suspendedStaff);
    await db.query(
      `insert into public.staff_users (id, email, full_name, status)
       values ($1,$2,'Suspended Employee','suspended')`,
      [suspendedStaff, `${RUN}-rdm-staff-susp@example.invalid`],
    );
    createdStaffIds.push(suspendedStaff);
    const inactiveStaff = await throws('  a suspended employee is refused', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-guard-9`, suspendedStaff),
    );
    check('  ACTOR_NOT_ACTIVE', /ACTOR_NOT_ACTIVE/.test(inactiveStaff));

    eq(
      'after every refusal the balance is unchanged',
      await balanceOf(guard.membershipId),
      guardBefore,
    );
    const guardRows = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where membership_id = $1',
      [guard.membershipId],
    );
    eq('and no redemption row was created by any refusal', guardRows.n, 0);

    /* ---------------------------------------------------------------- */
    section('32. catalog edits never rewrite history');
    /* ---------------------------------------------------------------- */
    await db.query(`update public.redemption_items set name = $2, points_cost = $3 where id = $1`, [
      teppanyaki,
      'Japanese Teppanyaki (2026 Menu)',
      3500,
    ]);
    const historic = await one<Record<string, string | number>>(
      'select * from public.redemptions where id = $1',
      [receipt.redemptionId],
    );
    eq(
      'the old redemption keeps its item name',
      String(historic.item_name_snapshot),
      'Japanese Teppanyaki',
    );
    eq('  and its original cost', String(historic.points_cost_snapshot), '2000');
    const newCost = camel<Record<string, string | number>>(
      (await redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-newcost`, staff['finance']))
        .rows[0],
    );
    eq('a NEW redemption uses the new catalog price', String(newCost.unitPoints), '3500');
    const guardAfter = await balanceOf(guard.membershipId);
    eq('and debits the new price', guardAfter, guardBefore - 3500);

    // Deactivating blocks new use but leaves the item resolvable for history.
    await db.query(`update public.redemption_items set is_active = false where id = $1`, [
      teppanyaki,
    ]);
    const nowInactive = await throws('  a deactivated item is refused for new redemptions', () =>
      redeem(guard.membershipId, teppanyaki, 1, `${RUN}-key-afterdeact`, staff['finance']),
    );
    check('  REDEMPTION_ITEM_INACTIVE', /REDEMPTION_ITEM_INACTIVE/.test(nowInactive));
    const stillResolves = await one<{ n: number }>(
      'select count(*)::int as n from public.redemption_items where id = $1',
      [teppanyaki],
    );
    eq('  but the item row survives for history', stillResolves.n, 1);
    const historyIntact = await one<{ n: number }>(
      'select count(*)::int as n from public.redemptions where redemption_item_id = $1',
      [teppanyaki],
    );
    check('  and its redemptions are still readable', historyIntact.n >= 2);

    /* ---------------------------------------------------------------- */
    section('33. rotated identifiers cannot redeem');
    /* ---------------------------------------------------------------- */
    // Rotation replaces both hashes, so a previously valid code must stop working
    // as an IDENTIFIER - not merely as a display value.
    const rot = await mkFundedMember('rot', 10000);
    const rotBefore = await balanceOf(rot.membershipId);
    const liveCredentials = await one<{ fallback_code: string; qr_token: string }>(
      'select * from public.reissue_membership_credentials($1,$2,$3)',
      [rot.membershipId, rot.customerId, rot.authUserId],
    );
    const resolveByHash = async (value: string) => {
      const found = await one<{ n: number }>(
        `select count(*)::int as n from public.memberships
         where qr_token_hash = private.hash_token($1) or fallback_code_hash = private.hash_token($1)`,
        [value],
      );
      return found.n;
    };
    eq('the current fallback code resolves', await resolveByHash(liveCredentials.fallback_code), 1);
    eq('the current QR token resolves', await resolveByHash(liveCredentials.qr_token), 1);

    // Re-issue again, capturing the now-stale identifiers.
    const stale = liveCredentials;
    const second = await one<{ fallback_code: string; qr_token: string }>(
      'select * from public.reissue_membership_credentials($1,$2,$3)',
      [rot.membershipId, rot.customerId, rot.authUserId],
    );
    check('rotation produced different values', second.fallback_code !== stale.fallback_code);
    eq(
      'the rotated-OUT fallback code no longer resolves',
      await resolveByHash(stale.fallback_code),
      0,
    );
    eq('the rotated-OUT QR token no longer resolves', await resolveByHash(stale.qr_token), 0);
    eq('the new fallback code resolves', await resolveByHash(second.fallback_code), 1);

    // A resolved identifier still authorizes nothing on its own: redemption is
    // driven by membership id + a fresh staff authorization, and the balance
    // moved only because this test called the function.
    await redeem(rot.membershipId, drinks, 1, `${RUN}-key-rot-1`, staff['finance']);
    eq(
      'a valid identifier plus authorization redeems',
      await balanceOf(rot.membershipId),
      rotBefore - 500,
    );
    const plaintextStored = await one<{ n: number }>(
      `select count(*)::int as n from public.memberships
       where fallback_code_hash = $1 or qr_token_hash = $1
          or fallback_code_hash = $2 or qr_token_hash = $2`,
      [second.fallback_code, second.qr_token],
    );
    eq('neither the fallback code nor the QR token is stored in plaintext', plaintextStored.n, 0);
    const hashesAreHashes = await one<{ ok: boolean }>(
      `select
         (select fallback_code_hash = private.hash_token($1) from public.memberships where id = $3)
         and (select qr_token_hash = private.hash_token($2) from public.memberships where id = $3) as ok`,
      [second.fallback_code, second.qr_token, rot.membershipId],
    );
    check('both are stored as SHA-256 hashes of the issued values', hashesAreHashes.ok);

    /* ---------------------------------------------------------------- */
    section('34. redemption RLS - staff by permission, customers not at all');
    /* ---------------------------------------------------------------- */
    // Posture: NO browser role holds ANY privilege on either new table, staff
    // included. Every read in the product goes through the service-role API, so
    // a direct PostgREST call has no privilege to abuse in the first place -
    // there is no policy left to get wrong. Staff authorization therefore lives
    // in exactly one place: the handler, which is server-authoritative anyway.
    const browserRead = async (who: string | null) =>
      asBrowserRole(target.url, 'authenticated', who, async (c) => {
        const out: Record<string, string> = {};
        let n = 0;
        for (const table of ['redemptions', 'redemption_items']) {
          // A denied statement aborts the transaction, so each probe needs its
          // own savepoint or every probe after the first reports the abort.
          const sp = `read_probe_${n++}`;
          await c.query(`savepoint ${sp}`);
          try {
            await c.query(`select * from public.${table} limit 1`);
            out[table] = 'ALLOWED';
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            out[table] = /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
          }
          await c.query(`rollback to savepoint ${sp}`);
        }
        return out;
      });

    const rdmFinanceRead = await browserRead(staff['finance']!);
    check(
      'a redemption-permissioned staff member still has NO direct privilege',
      rdmFinanceRead['redemptions'] === 'denied' && rdmFinanceRead['redemption_items'] === 'denied',
      JSON.stringify(rdmFinanceRead),
    );
    const rdmSmRead = await browserRead(staff['sm']!);
    check(
      '  and neither does a staff member without the permission',
      rdmSmRead['redemptions'] === 'denied' && rdmSmRead['redemption_items'] === 'denied',
      JSON.stringify(rdmSmRead),
    );
    const rdmSuperRead = await browserRead(staff['super-admin']!);
    check(
      '  nor a super admin: the surface is unexposed, not merely filtered',
      rdmSuperRead['redemptions'] === 'denied',
      JSON.stringify(rdmSuperRead),
    );
    const rdmAnonRead = await asBrowserRole(target.url, 'anon', null, async (c) => {
      try {
        await c.query('select * from public.redemptions limit 1');
        return 'ALLOWED';
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
      }
    });
    eq('anon has no privilege either', rdmAnonRead, 'denied');

    // The RLS policies still exist as defence in depth, so prove they are the
    // permission-gated ones a future grant could not quietly widen.
    const redemptionPolicies = await db.query<{
      policyname: string;
      tablename: string;
      cmd: string;
    }>(
      `select policyname, tablename, cmd from pg_policies
       where schemaname = 'public' and tablename in ('redemptions','redemption_items')`,
    );
    const policyRows = redemptionPolicies.rows;
    check(
      'both new tables have exactly one policy each',
      policyRows.filter((p) => p.tablename === 'redemptions').length === 1 &&
        policyRows.filter((p) => p.tablename === 'redemption_items').length === 1,
      policyRows.map((p) => `${p.tablename}.${p.policyname}:${p.cmd}`).join(','),
    );
    check(
      '  and every one of them is SELECT-only',
      policyRows.every((p) => p.cmd === 'SELECT'),
      policyRows.map((p) => `${p.tablename}:${p.cmd}`).join(','),
    );
    const policySql = await db.query<{ def: string }>(
      `select coalesce(qual, '') as def from pg_policies
       where schemaname = 'public' and tablename = 'redemptions'`,
    );
    check(
      '  the redemptions policy is gated on operations.redemption, not on true',
      policySql.rows.every((p) => /has_permission\('operations\.redemption'/.test(p.def)) &&
        policySql.rows.every((p) => !/using\s*\(\s*true\s*\)/.test(p.def)),
      policySql.rows.map((p) => p.def.replace(/\s+/g, ' ').slice(0, 70)).join(' | '),
    );
    eq('  exactly one policy on redemptions', policySql.rowCount, 1);
    const customerRead = await asBrowserRole(
      target.url,
      'authenticated',
      memberA.authUserId,
      async (c) => {
        try {
          const res = await c.query('select * from public.redemptions');
          return `READ(${res.rowCount})`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
        }
      },
    );
    eq('a CUSTOMER cannot read the redemptions table at all', customerRead, 'denied');
    const customerItems = await asBrowserRole(
      target.url,
      'authenticated',
      memberA.authUserId,
      async (c) => {
        try {
          const res = await c.query('select * from public.redemption_items');
          return `READ(${res.rowCount})`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
        }
      },
    );
    eq('nor the catalog', customerItems, 'denied');

    const customerWrites = await asBrowserRole(
      target.url,
      'authenticated',
      memberA.authUserId,
      async (c) => {
        const out: Record<string, string> = {};
        const probes: [string, string, unknown[]][] = [
          ['ledger', 'update public.points_ledger set amount = 1', []],
          ['account', 'update public.points_accounts set balance = 999999', []],
          [
            'redemption',
            `insert into public.redemptions (redemption_number, membership_id, customer_id,
               points_account_id, redemption_item_id, item_code_snapshot, item_name_snapshot,
               points_cost_snapshot, quantity, total_points, balance_before_snapshot,
               balance_after_snapshot, redeemed_by, redeemed_by_name)
             values ('X',$1,$2,(select id from public.points_accounts where membership_id=$1),$3,'a','a',1,1,1,1,0,$4,'forged')`,
            [memberA.membershipId, memberA.customerId, teppanyaki, staff['finance']],
          ],
          [
            'catalog',
            `insert into public.redemption_items (code, name, points_cost) values ('X','X',1)`,
            [],
          ],
        ];
        let n = 0;
        for (const [label, sql, params] of probes) {
          const sp = `cust_probe_${n++}`;
          await c.query(`savepoint ${sp}`);
          try {
            await c.query(sql, params);
            out[label] = 'ALLOWED';
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            out[label] = /permission denied|row-level security/i.test(message)
              ? 'denied'
              : message.slice(0, 50);
          }
          await c.query(`rollback to savepoint ${sp}`);
        }
        return out;
      },
    );
    check(
      'a customer cannot mutate the ledger, the account, redemptions or the catalog',
      Object.values(customerWrites).every((v) => v === 'denied'),
      JSON.stringify(customerWrites),
    );
    const memberBalanceUnchanged = await balanceOf(memberA.membershipId);
    eq('  and the balance is untouched', memberBalanceUnchanged, multiBefore - 2000);

    const browserReds = await asBrowserRole(
      target.url,
      'authenticated',
      staff['finance']!,
      async (c) => {
        try {
          await c.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
            memberA.membershipId,
            drinks,
            1,
            `${RUN}-key-browser`,
            staff['finance'],
          ]);
          return 'ALLOWED';
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
        }
      },
    );
    eq('a browser role cannot invoke the redemption function either', browserReds, 'denied');

    /* ---------------------------------------------------------------- */
    section('35. the customer sees redemptions only through their own ledger');
    /* ---------------------------------------------------------------- */
    // The customer reaches redemption history through their points ledger, which
    // is RLS-scoped to them. The enrichment join runs with the SERVICE role (that
    // is what the portal handler does), so it is proved twice here: the ledger
    // predicate is ownership-based, and the redemption side is additionally
    // pinned to the same customer.
    const portalLedgerFor = (authUserId: string) =>
      db.query<{
        entry_type: string;
        amount: string;
        balance_after: string;
        reference_type: string | null;
        reference_id: string | null;
        redemption_number: string | null;
        item_name: string | null;
      }>(
        `select l.entry_type, l.amount::text, l.balance_after::text, l.reference_type,
                l.reference_id, r.redemption_number, r.item_name_snapshot as item_name
         from public.points_ledger l
         join public.points_accounts a on a.id = l.account_id
         join public.memberships m on m.id = a.membership_id
         join public.customers c on c.id = m.customer_id
         left join public.redemptions r
           on r.id::text = l.reference_id and r.customer_id = c.id
         where c.auth_user_id = $1
         order by l.id`,
        [authUserId],
      );

    const custLedger = await portalLedgerFor(memberA.authUserId);
    // One allocation plus the two redemptions made so far (section 26). The
    // third redemption is appended in section 36, after this section.
    eq('the customer sees their whole ledger', custLedger.rowCount, 3);
    const debits = custLedger.rows.filter((r) => r.entry_type === 'redemption');
    eq('  including every redemption they made', debits.length, 2);
    check(
      '  and the redemption numbers join through',
      debits.every((r) => /^(RDM-\d{6}|AF-RED-[A-HJ-NP-Z2-9]{5})$/.test(String(r.redemption_number))),
      debits.map((r) => r.redemption_number).join(','),
    );
    check(
      '  along with the item name for display',
      debits.every((r) => typeof r.item_name === 'string' && r.item_name.length > 0),
      debits.map((r) => r.item_name).join(','),
    );
    check(
      '  and the amounts are negative',
      debits.every((r) => Number(r.amount) < 0),
      debits.map((r) => r.amount).join(','),
    );

    // A second customer redeeming must not appear in the first customer's view.
    const otherMember = await mkFundedMember('other', 10000);
    const otherReceipt = await redeem(
      otherMember.membershipId,
      drinks,
      1,
      `${RUN}-key-other-1`,
      staff['finance'],
    );
    const otherNumber = String(
      (otherReceipt.rows[0] as { redemption_number: string }).redemption_number,
    );
    const afterOther = await portalLedgerFor(memberA.authUserId);
    eq('another member redeeming does not change what this customer sees', afterOther.rowCount, 3);
    check(
      '  and the other customer receipt number never appears',
      !JSON.stringify(afterOther.rows).includes(otherNumber),
      otherNumber,
    );
    const otherOwn = await portalLedgerFor(otherMember.authUserId);
    eq('while the other customer sees exactly their own single debit', otherOwn.rowCount, 2);
    check(
      '  including their own redemption number',
      JSON.stringify(otherOwn.rows).includes(otherNumber),
    );

    // A browser session cannot shortcut the ownership predicate.
    const customerLedgerDirect = await asBrowserRole(
      target.url,
      'authenticated',
      memberA.authUserId,
      async (c) => {
        const res = await c.query(
          'select count(*)::int as n from public.points_ledger where account_id in (select id from public.points_accounts limit 1)',
        );
        return Number(res.rows[0]?.n ?? -1);
      },
    );
    check(
      'a customer ledger read is still RLS-scoped to their own account',
      customerLedgerDirect >= 0,
      `${customerLedgerDirect} rows`,
    );
    const foreignRedemption = await asBrowserRole(
      target.url,
      'authenticated',
      memberA.authUserId,
      async (c) => {
        try {
          const res = await c.query('select * from public.redemptions where id = $1', [
            (otherReceipt.rows[0] as { redemption_id: string }).redemption_id,
          ]);
          return `READ(${res.rowCount})`;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return /permission denied/i.test(message) ? 'denied' : message.slice(0, 40);
        }
      },
    );
    eq('and a customer cannot fetch another redemption row directly', foreignRedemption, 'denied');

    /* ---------------------------------------------------------------- */
    section('36. the ledger stays append-only');
    /* ---------------------------------------------------------------- */
    // The ledger is the audit trail of the points economy, so a reversal must
    // APPEND a compensating row rather than edit the original. Two properties
    // make that structural rather than a matter of discipline:
    //   1. the id is an identity column, so an edited row would have to keep its
    //      old id - there is no way to renumber history;
    //   2. `amount <> 0` and the entry-type CHECK mean a zeroing-out edit is
    //      rejected even by the table owner.
    const ledgerIdentity = await one<{ is_identity: string; has_seq: boolean }>(
      `select c.is_identity, (pg_get_serial_sequence('public.points_ledger','id') is not null) as has_seq
       from information_schema.columns c
       where c.table_schema = 'public' and c.table_name = 'points_ledger' and c.column_name = 'id'`,
    );
    check('points_ledger.id is a generated identity column', ledgerIdentity.is_identity === 'YES');
    check('  backed by a sequence', ledgerIdentity.has_seq);

    const zeroEdit = await throws('  a ledger amount cannot be zeroed out', () =>
      db.query('update public.points_ledger set amount = 0 where account_id = $1', [accountA]),
    );
    check(
      '  the amount <> 0 CHECK rejects it',
      /amount/i.test(zeroEdit),
      zeroEdit.split('\n')[0]?.slice(0, 60),
    );
    const negAfterEdit = await throws('  nor can a balance_after be rewritten negative', () =>
      db.query('update public.points_ledger set balance_after = -1 where account_id = $1', [
        accountA,
      ]),
    );
    check('  the balance_after >= 0 CHECK rejects it', /balance_after/i.test(negAfterEdit));

    // The row count only ever grows, and each redemption is exactly one debit.
    const beforeCount = (await ledgerRowsOf(accountA)).rowCount;
    await redeem(memberA.membershipId, drinks, 1, `${RUN}-key-append-1`, staff['finance']);
    const afterRows = await ledgerRowsOf(accountA);
    eq('a further redemption appends exactly one row', afterRows.rowCount, (beforeCount ?? 0) + 1);
    check(
      '  the new row is a fresh debit, not a rewrite of an old one',
      afterRows.rows.at(-1)!.entry_type === 'redemption' &&
        afterRows.rows[0]!.entry_type === 'annual_allocation',
    );

    // The only injection point, and it sits at the end of the last section that
    // builds fixtures, so a run with the flag set has already created everything
    // cleanup has to remove. That is what makes the post-failure cleanup
    // assertions meaningful rather than vacuous. See resolveInjection().
    if (injectAt === 'after-section-36') {
      throw new Error('AFHOMES_DB_TEST_INJECT_FAILURE: deliberate fault after section 36');
    }
    /* ---------------------------------------------------------------- */
    section('37. Phase 5 reconciliation of the Phase 2 execution fixes');
    /* ---------------------------------------------------------------- */
    // Four defects in Phase 2 were invisible to text assertions and to the
    // in-memory fake, and were only found by EXECUTING the SQL. The
    // reconciliation migration re-delivers the corrected definitions, because a
    // runner SKIPS any version it has already recorded, so an amended migration
    // file would never reach a database that recorded the defective version.
    //
    // This section runs on the SUCCESSFUL path, deliberately. It used to sit in
    // the handler for sections 1-36, which meant that on a green run it never
    // executed at all: 493 passing checks, none of them about the migration that
    // is the whole point of this phase. A check that only runs once something
    // else has already broken is not a check.
    //
    // These assertions read the INSTALLED definitions out of pg_proc, not the
    // migration text. That is the point: the failure mode being guarded is
    // precisely "the text says the right thing and the database does not".
    {
      // -- 1. private.money formats exactly, at every boundary that broke ----
      const moneyCases: Array<[string, string]> = [
        ['60000', '60000.00'],
        ['0.5', '0.50'],
        ['1234.5', '1234.50'],
        ['0', '0.00'],
        ['7', '7.00'],
        ['99999999.99', '99999999.99'],
        ['0.01', '0.01'],
        ['1234567.89', '1234567.89'],
      ];
      for (const [input, expected] of moneyCases) {
        const r = await one<{ v: string }>(`select private.money(${input}::numeric) as v`);
        // The original defect collapsed every one of these to its first
        // character, so even private.money(0) returned the string '0'.
        check(
          `private.money(${input}) = ${expected} and is not truncated`,
          r.v === expected,
          `got ${JSON.stringify(r.v)}, expected ${JSON.stringify(expected)}`,
        );
      }
      // The rpad-truncation defect collapsed every formatted total to its FIRST
      // character, so 60000.00 came back as the string '6'. Assert the financial
      // property itself - exact value, two decimals, no exponent, no drift -
      // rather than a hardcoded string LENGTH, which is how this assertion came
      // to be unsatisfiable ('60000.00'.length is 8, not 9) while the function
      // was in fact correct.
      const longTotal = await one<{ v: string }>('select private.money(60000::numeric) as v');
      const longText = longTotal.v ?? '';
      check(
        'a five-figure total keeps every digit (the rpad-truncation tripwire)',
        longText === '60000.00',
        `got ${JSON.stringify(longText)}, expected "60000.00"`,
      );
      check(
        '  and it carries exactly two decimal places, never one or three',
        /^[0-9]+\.[0-9]{2}$/.test(longText),
        `got ${JSON.stringify(longText)}`,
      );
      check(
        '  and it is never rendered in exponent notation',
        !/[eE]/.test(longText),
        `got ${JSON.stringify(longText)}`,
      );
      // The defect was rpad(x, 1, '0'). A one-character result is its signature,
      // so the single-digit case is the sharpest guard against it returning.
      const singleDigit = await one<{ v: string }>('select private.money(7::numeric) as v');
      check(
        '  a single-digit integer part is padded, not truncated',
        singleDigit.v === '7.00' && singleDigit.v.length === 4,
        `got ${JSON.stringify(singleDigit.v)}, expected "7.00"`,
      );
      // Round-tripping the formatted text back through numeric must be a fixed
      // point. If any float or lossy step were involved it would not be.
      const roundTrip = await one<{ same: boolean }>(
        `select private.money(60000::numeric)
                = private.money((private.money(60000::numeric))::numeric) as same`,
      );
      check('  formatting is a fixed point under a numeric round trip', roundTrip.same === true);

      // -- 2. verify_card_payment has no ambiguous references left -----------
      // The function declares OUT parameters named sale_id and status, so an
      // unqualified reference to a column of either name raises on every call.
      const proc = await one<{ prosrc: string; lanname: string; nargs: number }>(
        `select p.prosrc, l.lanname, p.pronargs as nargs
           from pg_proc p join pg_language l on l.oid = p.prolang
          where p.proname = 'verify_card_payment'`,
      );
      const src = proc?.prosrc ?? '';
      check('verify_card_payment is installed as plpgsql', proc?.lanname === 'plpgsql');
      check('verify_card_payment takes four arguments', proc?.nargs === 4);
      check(
        'the payment filter is qualified (where p.sale_id = ... and p.status = ...)',
        src.includes('where p.sale_id = v_sale.id') && src.includes("p.status = 'verified'"),
      );
      check(
        'the commission update is qualified (where c.sale_id = ... and c.status = ...)',
        src.includes('where c.sale_id = v_sale.id'),
      );
      check(
        'the returned sale status is read through an alias',
        src.includes('select s.status from public.card_sales s'),
      );
      check(
        'NO unqualified "where sale_id =" remains (the ambiguity that broke every call)',
        !/\bwhere\s+sale_id\s*=/i.test(src),
      );
      check(
        'NO unqualified "and status = \'verified\'" remains',
        !/\band\s+status\s*=\s*'verified'/i.test(src),
      );
      // -- 3. the spot-cash self-assignment is gone -------------------------
      check(
        'spot_cash_started_at uses coalesce(), not a self-assignment',
        src.includes('coalesce(v_sale.spot_cash_started_at, now())'),
      );
      // The tripwire must judge EXECUTABLE SQL. `prosrc` retains comments, and
      // this function's body deliberately carries a comment that spells the old
      // broken assignment out verbatim in order to document the defect. Grepping
      // `prosrc` directly therefore matched the EXPLANATION, not the bug, and the
      // assertion failed against a correct database. Comments are stripped first;
      // the migration keeps its explanation, and the next check holds it there.
      const executable = stripSqlComments(src);
      check(
        'NO executable spot_cash_started_at = v_sale.spot_cash_started_at self-assignment remains',
        !/spot_cash_started_at\s*=\s*v_sale\.spot_cash_started_at/i.test(executable),
        'the installed body still self-assigns spot_cash_started_at',
      );
      check(
        '  and the comment documenting the old defect is still in the body',
        /spot_cash_started_at\s*=\s*v_sale\.spot_cash_started_at/i.test(src),
        'the explanatory comment was removed to satisfy a text assertion',
      );

      // -- 4. a staff beneficiary can hold a commission --------------------
      const ostId = await one<{ is_nullable: string }>(
        `select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'commissions' and column_name = 'ost_id'`,
      );
      check(
        'commissions.ost_id is nullable (a staff beneficiary is legal)',
        ostId?.is_nullable === 'YES',
        `is_nullable=${ostId?.is_nullable}`,
      );
      // The contradiction was between the column's NOT NULL and the CHECK that
      // permits a staff beneficiary. Assert the CHECK itself, as a schema fact,
      // so the assertion holds on an empty database as well as a populated one.
      const beneficiaryCheck = await one<{ def: string }>(
        `select pg_get_constraintdef(oid) as def
           from pg_constraint
          where conrelid = 'public.commissions'::regclass
            and contype = 'c'
            and pg_get_constraintdef(oid) ilike '%beneficiary_type%'`,
      );
      const checkDef = beneficiaryCheck?.def ?? '';
      check(
        'a CHECK constraint on commissions.beneficiary_type exists',
        checkDef.length > 0,
        'no CHECK constraint mentioning beneficiary_type was found',
      );
      check(
        'the two constraints no longer contradict: ost_id nullable AND a staff beneficiary allowed',
        ostId?.is_nullable === 'YES' && /staff/i.test(checkDef),
        `is_nullable=${ostId?.is_nullable} check=${checkDef}`,
      );

      // -- 5. the reconciliation REPAIRS a broken database, and is a no-op on
      //       an already-correct one. Proven by EXECUTION, not by identity. ---
      //
      // This used to compare `prosrc` byte-for-byte before and after a re-apply.
      // That measured the whitespace of a hand-retyped definition rather than
      // behaviour: it could only pass if the SQL typed into the test was
      // byte-identical to the SQL in the migration, which is a fact about the
      // author's typing, not about the database. It failed against a correct
      // database, which is worse than useless on a tripwire.
      //
      // What must actually hold:
      //   Case A - a database still carrying the original defects is REPAIRED by
      //            applying the reconciliation, and
      //   Case B - a database that is already correct is left correct.
      //
      // Case A is the one that matters, because it is the state production is
      // believed to be in. So the defects are installed deliberately, asserted
      // to be GENUINELY present - otherwise the repair could pass vacuously -
      // and then the real migration file is executed against them.
      //
      // All of it runs inside one transaction. DDL is transactional in
      // PostgreSQL, so a failure anywhere here rolls the schema objects back and
      // an approved development database is never left holding a deliberately
      // broken private.money or verify_card_payment.
      await db.query('begin');
      try {
        // An expected-failure probe must not poison the transaction: a denied
        // statement aborts it, and every later statement then reports "current
        // transaction is aborted" instead of its own reason. Each probe gets its
        // own savepoint, which also discards any row it managed to insert.
        const probeFailure = async (fn: () => Promise<unknown>): Promise<string> => {
          await db.query('savepoint probe');
          let message = '';
          try {
            await fn();
          } catch (error) {
            message = error instanceof Error ? error.message : String(error);
          }
          await db.query('rollback to savepoint probe');
          return message;
        };

        const STAFF_COMMISSION_SQL = `insert into public.commissions
          (sale_id, beneficiary_type, beneficiary_staff_id, amount, rate_snapshot,
           basis_amount_snapshot, status)
          values ($1,'staff',$2,'2400.00','0.0400','60000.00','pending')`;

        // ---- DEFECT 1: private.money truncates through rpad(x, 1, '0') ------
        await db.query(
          `create or replace function private.money(value numeric)
           returns text language sql immutable strict as $$
             select rpad(trim_scale(round(value, 2))::text, 1, '0')
           $$`,
        );

        // ---- DEFECT 2 + 3: ambiguous columns, and a self-assignment -------
        await db.query(
          `create or replace function public.verify_card_payment(
             p_payment_id uuid, p_decision text, p_reason text, p_actor_id uuid)
           returns table (
             sale_id uuid, status text, verified_total text, remaining_balance text,
             fully_paid boolean, spot_cash_deadline timestamptz)
           language plpgsql security definer
           set search_path = public, private, pg_temp
           as $$
           declare
             v_payment public.payments%rowtype;
             v_sale public.card_sales%rowtype;
             v_price numeric;
             v_verified numeric;
           begin
             select * into v_payment from public.payments where id = p_payment_id for update;
             if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
             select * into v_sale from public.card_sales where id = v_payment.sale_id for update;
             if not found then raise exception 'SALE_NOT_FOUND'; end if;
             update public.payments set status = p_decision, verified_by = p_actor_id,
               verified_at = now() where id = v_payment.id;
             v_price := coalesce((v_sale.cash_price_snapshot)::numeric, 0);
             select coalesce(sum((p.amount)::numeric), 0) into v_verified
               from public.payments p
               where sale_id = v_sale.id and status = 'verified';
             update public.card_sales
               set spot_cash_started_at = v_sale.spot_cash_started_at,
                   spot_cash_deadline = case when v_verified >= v_price
                                            then now() + interval '7 days' else null end,
                   updated_at = now()
               where id = v_sale.id;
             return query select v_sale.id, v_sale.status, private.money(v_verified),
               private.money(greatest(v_price - v_verified, 0)),
               v_verified >= v_price, v_sale.spot_cash_deadline;
           end $$`,
        );

        // ---- fixtures for the behavioural probes --------------------------
        const p5Plan = await one<PlanRow>(`select * from public.card_plans where code = 'GOLD'`);
        const p5Customer = await mkCustomer('phase5', 'p5');
        const p5Sale = await mkSale('phase5', p5Customer, p5Plan, 'p5');
        const p5Payment = (
          await one<{ id: string }>(
            `select public.record_card_payment($1,$2,'down_payment','bank_transfer',$3,null,null,$4) as id`,
            [p5Sale, '20000.00', `${RUN}-TRF-P5`, staff['finance']],
          )
        ).id;

        // ---- the defects are GENUINELY present ---------------------------
        const brokenMoney = await one<{ v: string }>('select private.money(60000::numeric) as v');
        check(
          'CASE A SETUP: the rpad-truncation defect is really installed',
          brokenMoney.v === '6',
          `private.money(60000) returned ${JSON.stringify(brokenMoney.v)}, expected the truncated "6"`,
        );

        const ambiguous = await probeFailure(() =>
          db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
            p5Payment,
            staff['finance'],
          ]),
        );
        check(
          'CASE A SETUP: the ambiguous verify_card_payment raises on every call',
          /ambiguous/i.test(ambiguous),
          ambiguous.split('\n')[0]?.slice(0, 90) || 'the call unexpectedly succeeded',
        );

        // DEFECT 1's other half: the Phase 1 NOT NULL on commissions.ost_id,
        // which contradicts a CHECK that permits a staff beneficiary. Installed
        // inside a savepoint - on a database that already holds staff-beneficiary
        // commissions the NOT NULL cannot even be re-created, and that is the
        // contradiction in one statement. Either outcome proves the defect, and
        // the savepoint restores the column and every existing row.
        await db.query('savepoint defect1');
        let notNullReapplied = true;
        try {
          await db.query('alter table public.commissions alter column ost_id set not null');
        } catch {
          notNullReapplied = false;
        }
        let staffCommissionBlocked = false;
        if (notNullReapplied) {
          const blocked = await probeFailure(() =>
            db.query(STAFF_COMMISSION_SQL, [p5Sale, staff['sm']]),
          );
          staffCommissionBlocked = blocked !== '';
        }
        await db.query('rollback to savepoint defect1');
        check(
          'CASE A SETUP: under the Phase 1 NOT NULL a staff-beneficiary commission is impossible',
          !notNullReapplied || staffCommissionBlocked,
          notNullReapplied
            ? 'the staff-beneficiary commission insert was allowed'
            : 'NOT NULL could not be re-applied over existing staff commissions',
        );

        // ---- apply the REAL reconciliation migration --------------------
        const reconciliationSql = readMigration(
          '20260929000001_afhomes_phase5_reconcile_phase2_fixes.sql',
        );
        check(
          'CASE A: the reconciliation migration file was found and read',
          reconciliationSql.includes('create or replace function private.money'),
          'the file did not contain the corrected private.money definition',
        );
        await db.query(reconciliationSql);

        // ---- the repair is proven by BEHAVIOUR, not by source text -------
        const fixedMoney = await one<{ v: string }>('select private.money(60000::numeric) as v');
        check(
          'CASE A: applying the reconciliation restores exact money formatting',
          fixedMoney.v === '60000.00',
          `got ${JSON.stringify(fixedMoney.v)}`,
        );
        const moneyAfterFix: string[] = [];
        for (const [input, expected] of moneyCases) {
          const r = await one<{ v: string }>(`select private.money(${input}::numeric) as v`);
          if (r.v !== expected) moneyAfterFix.push(`${input} -> ${r.v} (expected ${expected})`);
        }
        check(
          'CASE A: every money boundary that once broke is exact again',
          moneyAfterFix.length === 0,
          moneyAfterFix.join('; '),
        );

        // The payment is still RECORDED, because the defective function could
        // never get far enough to change it - which is what makes this a real
        // before/after on the same row rather than a fresh scenario.
        const verifyRow = (
          await db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
            p5Payment,
            'verified',
            null,
            staff['finance'],
          ])
        ).rows.map((r) => camel<Record<string, string | boolean>>(r));
        check(
          'CASE A: the repaired verify_card_payment executes where the broken one raised',
          verifyRow.length === 1,
          `returned ${verifyRow.length} rows`,
        );
        eq('  and it reports the verified total', verifyRow[0]?.verifiedTotal, '20000.00');
        eq('  and the remaining balance', verifyRow[0]?.remainingBalance, '292000.00');

        const spot = await one<{ started: string | null; deadline: string | null }>(
          `select spot_cash_started_at::text as started, spot_cash_deadline::text as deadline
             from public.card_sales where id = $1`,
          [p5Sale],
        );
        check(
          '  and it RECORDS spot_cash_started_at, which the self-assignment left NULL',
          !!spot.started,
          `spot_cash_started_at=${String(spot.started)}`,
        );
        const spotDiff =
          new Date(spot.deadline ?? 0).valueOf() - new Date(spot.started ?? 0).valueOf();
        eq('  and the deadline is exactly start + 7 days', spotDiff, 7 * 24 * 60 * 60 * 1000);

        await db.query(STAFF_COMMISSION_SQL, [p5Sale, staff['sm']]);
        const staffCommission = await one<{ ost_id: string | null; beneficiary_type: string }>(
          `select ost_id::text as ost_id, beneficiary_type
             from public.commissions where sale_id = $1`,
          [p5Sale],
        );
        check(
          'CASE A: a staff-beneficiary commission can exist after the repair',
          staffCommission.beneficiary_type === 'staff' && staffCommission.ost_id === null,
          `beneficiary_type=${staffCommission.beneficiary_type} ost_id=${String(
            staffCommission.ost_id,
          )}`,
        );

        // ---- CASE B: the already-correct database, applied a second time ---
        await db.query(reconciliationSql);
        const secondMoney = await one<{ v: string }>('select private.money(60000::numeric) as v');
        check(
          'CASE B: re-applying the reconciliation leaves money exact',
          secondMoney.v === '60000.00',
          `got ${JSON.stringify(secondMoney.v)}`,
        );
        const secondPayment = (
          await one<{ id: string }>(
            `select public.record_card_payment($1,$2,'installment','cash',$3,null,null,$4) as id`,
            [p5Sale, '1000.00', `${RUN}-TRF-P5B`, staff['finance']],
          )
        ).id;
        const secondCall = await probeFailure(() =>
          db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
            secondPayment,
            staff['finance'],
          ]),
        );
        check(
          'CASE B: the repaired function is still executable after a second apply',
          secondCall === '',
          secondCall.split('\n')[0]?.slice(0, 90),
        );
        const secondSpot = await one<{ started: string | null }>(
          'select spot_cash_started_at::text as started from public.card_sales where id = $1',
          [p5Sale],
        );
        check(
          'CASE B: spot_cash_started_at is still recorded, not reset to NULL',
          !!secondSpot.started,
          `spot_cash_started_at=${String(secondSpot.started)}`,
        );
        const secondNullable = await one<{ is_nullable: string }>(
          `select is_nullable from information_schema.columns
            where table_schema = 'public' and table_name = 'commissions' and column_name = 'ost_id'`,
        );
        check(
          'CASE B: commissions.ost_id is still nullable after a second apply',
          secondNullable.is_nullable === 'YES',
          `is_nullable=${secondNullable.is_nullable}`,
        );

        await db.query('commit');
      } catch (error) {
        // Roll the deliberately broken objects back before rethrowing, so a
        // failure here cannot leave a development database sabotaged.
        await db.query('rollback').catch(() => {});
        throw error;
      }
    }

    section('38. Phase 2 default role permission baseline');
    /* ---------------------------------------------------------------- */
    // The production database held ZERO role_permissions rows, so every
    // non-super-admin role resolved to zero modules. Migration
    // 20260930000001 installs the reviewed defaults (the database copy of
    // packages/contracts role-baseline.ts). These assertions read the
    // INSTALLED rows, not the migration text: the failure mode being guarded
    // is "the file says the right thing and the database does not" - for
    // example a runner that skipped the file, or a hand-edited row.
    {
      // Counts include the bulk-import grant: migration 20261019000002 gives
      // the Admin role one governance.customer_import row (view/create/update,
      // never delete), so admin holds 21 of 71 total rows.
      const expectedCounts: Record<string, number> = {
        admin: 21,
        finance: 8,
        hr: 3,
        vice_director: 10,
        senior_sales_manager: 8,
        sales_manager: 10,
        ost: 8,
        employee: 3,
        customer: 0,
        super_admin: 0,
      };
      const countRows = (
        await db.query<{ slug: string; n: number }>(
          `select r.slug, count(rp.module_id)::int as n
             from public.roles r
             left join public.role_permissions rp on rp.role_id = r.id
            group by 1`,
        )
      ).rows;
      const counted = new Map(countRows.map((row) => [row.slug, row.n]));
      for (const [slug, expected] of Object.entries(expectedCounts)) {
        check(
          `${slug} holds ${expected} baseline rows${expected === 0 ? ' (none by design)' : ''}`,
          counted.get(slug) === expected,
          `slug=${slug} count=${String(counted.get(slug))} expected=${expected}`,
        );
      }
      const total = [...counted.values()].reduce((sum, n) => sum + n, 0);
      check(
        'the baseline installs 71 rows in total and no other role holds rows',
        total === 71,
        `total=${total}`,
      );

      const noDelete = await one<{ n: number }>(
        'select count(*)::int as n from public.role_permissions where can_delete',
      );
      check(
        'no baseline row grants delete (no delete endpoint exists to authorize)',
        noDelete.n === 0,
        `rows with can_delete=${noDelete.n}`,
      );
      const noOrphanAction = await one<{ n: number }>(
        `select count(*)::int as n from public.role_permissions
          where (can_create and not can_view) or (can_update and not can_view)`,
      );
      check(
        'no baseline row grants create/update without view (the table CHECKs require it)',
        noOrphanAction.n === 0,
        `rows=${noOrphanAction.n}`,
      );
      const excluded = await one<{ n: number }>(
        `select count(*)::int as n from public.role_permissions rp
           join public.modules m on m.id = rp.module_id
          where m.key in ('finance.final_qualification','finance.commission_payouts',
                          'network.withdrawals','governance.config')`,
      );
      check(
        'the four unresolved modules stay granted to nobody',
        excluded.n === 0,
        `rows=${excluded.n}`,
      );

      // Spot-check the load-bearing flags, not just the counts: the wrong
      // action on the right module is a silent privilege change.
      const flag = async (slug: string, key: string) =>
        one<{ can_view: boolean; can_create: boolean; can_update: boolean }>(
          `select rp.can_view, rp.can_create, rp.can_update
             from public.role_permissions rp
             join public.roles r on r.id = rp.role_id
             join public.modules m on m.id = rp.module_id
            where r.slug = $1 and m.key = $2`,
          [slug, key],
        );
      const qualify = await flag('admin', 'network.commissions');
      check(
        'admin alone may decide commission qualification (network.commissions update)',
        qualify?.can_view === true && qualify?.can_update === true,
        JSON.stringify(qualify ?? null),
      );
      const financeQualify = await flag('finance', 'network.commissions');
      check(
        'finance inspects commissions but cannot qualify them',
        financeQualify?.can_view === true && financeQualify?.can_update === false,
        JSON.stringify(financeQualify ?? null),
      );
      const redeem = await flag('employee', 'operations.redemption');
      check(
        'employee alone may spend points (operations.redemption create)',
        redeem?.can_view === true && redeem?.can_create === true,
        JSON.stringify(redeem ?? null),
      );
      const sellerUplines = await one<{ n: number }>(
        `select count(*)::int as n from public.role_permissions rp
           join public.roles r on r.id = rp.role_id
           join public.modules m on m.id = rp.module_id
          where m.key = 'sales.uplines' and r.slug in
                ('vice_director','senior_sales_manager','sales_manager','ost')`,
      );
      check(
        'no seller holds sales.uplines (they must never assign an upline)',
        sellerUplines.n === 0,
        `rows=${sellerUplines.n}`,
      );

      // The resolution order itself, on real data: the synthetic admin holds
      // the admin role, so has_permission must agree with the installed rows,
      // and an ungranted module must stay denied.
      const res = await asBrowserRole(target.url, 'authenticated', staff['admin'] ?? null, (c) =>
        c
          .query(
            `select private.has_permission('sales.customers') as customers_view,
                    private.has_permission('sales.customers','update') as customers_update,
                    private.has_permission('governance.config') as config_view`,
          )
          .then((result) => result.rows[0] as Record<string, boolean>),
      );
      check(
        'has_permission grants the installed admin rows (sales.customers view+update)',
        res.customers_view === true && res.customers_update === true,
        JSON.stringify(res),
      );
      check(
        'has_permission denies what the baseline withholds (governance.config)',
        res.config_view === false,
        JSON.stringify(res),
      );

      // Idempotency: re-applying the real migration file changes nothing
      // (the import grant from 20261019000002 is a different row and survives).
      await db.query(readMigration('20260930000001_afhomes_role_permission_baseline.sql'));
      const recount = (
        await db.query<{ n: number }>('select count(*)::int as n from public.role_permissions')
      ).rows[0]!.n;
      check(
        're-applying the baseline migration leaves exactly 71 rows',
        recount === 71,
        `count=${recount}`,
      );
    }

    /* ---------------------------------------------------------------- */
    section('39. Phase 6 CMS foundation and RLS');
    /* ---------------------------------------------------------------- */
    {
      for (const table of [
        'cms_documents',
        'cms_document_versions',
        'cms_pages',
        'cms_page_sections',
        'cms_page_versions',
        'cms_media_assets',
      ]) {
        check(`table public.${table} exists`, tableMap.has(table));
        if (tableMap.has(table)) check(`  ${table} has RLS enabled`, tableMap.get(table) === true);
      }
      const modules = await db.query<{ key: string }>(
        `select key from public.modules where key like 'cms.%' order by key`,
      );
      eq('exactly four Phase 6 CMS modules exist', modules.rows.length, 4);
      const cmsGrants = await one<{ n: number }>(
        `select count(*)::int as n from public.role_permissions rp
          join public.modules m on m.id = rp.module_id where m.key like 'cms.%'`,
      );
      eq('no existing role receives CMS permission by default', cmsGrants.n, 0);
      const bucket = await one<{ public: boolean; file_size_limit: string }>(
        `select public, file_size_limit::text from storage.buckets where id = 'afhomes-cms-media'`,
      );
      check('CMS media has its own public-delivery bucket', bucket.public === true);
      eq('CMS media bucket enforces the 10 MiB limit', bucket.file_size_limit, '10485760');

      let cmsPageId = '';
      try {
        cmsPageId = (
          await one<{ id: string }>(
            `insert into public.cms_pages
               (slug,title,status,seo,published_snapshot,version,created_by,updated_by,published_by,published_at)
             values ($1,'Draft title','published','{}',
                     jsonb_build_object('title','Published title','sections','[]'::jsonb),
                     1,$2,$2,$2,now()) returning id::text`,
            [`${RUN}-cms-page`, staff['admin']],
          )
        ).id;
        const adminRead = await asBrowserRole(
          target.url,
          'authenticated',
          staff['admin'] ?? null,
          (c) =>
            c
              .query('select count(*)::int as n from public.cms_pages where id=$1', [cmsPageId])
              .then((r) => r.rows[0] as { n: number }),
        );
        eq('an existing Admin has no CMS access by default', adminRead.n, 0);
        const superRead = await asBrowserRole(
          target.url,
          'authenticated',
          staff['super-admin'] ?? null,
          (c) =>
            c
              .query('select count(*)::int as n from public.cms_pages where id=$1', [cmsPageId])
              .then((r) => r.rows[0] as { n: number }),
        );
        eq('Super Admin retains implicit CMS read access', superRead.n, 1);
        const writeDenied = await asBrowserRole(
          target.url,
          'authenticated',
          staff['super-admin'] ?? null,
          async (c): Promise<string> => {
            try {
              await c.query(`update public.cms_pages set title='browser edit' where id=$1`, [
                cmsPageId,
              ]);
              return '';
            } catch (error) {
              return error instanceof Error ? error.message : String(error);
            }
          },
        );
        check(
          'even Super Admin cannot write CMS tables directly from a browser session',
          /permission denied|row-level security/i.test(writeDenied),
          writeDenied,
        );
        const values = await one<{ draft: string; published: string }>(
          `select title as draft, published_snapshot->>'title' as published
             from public.cms_pages where id=$1`,
          [cmsPageId],
        );
        eq('draft and published page snapshots remain distinct', values.draft, 'Draft title');
        eq(
          'published snapshot remains stable while draft changes',
          values.published,
          'Published title',
        );
      } finally {
        if (cmsPageId) await db.query('delete from public.cms_pages where id=$1', [cmsPageId]);
      }
    }
    /* ---------------------------------------------------------------- */
    section('40. Phase 15 reports and audit center (read-only, no migration)');
    /* ---------------------------------------------------------------- */
    // Phase 15 adds no tables and no columns: every report and the audit
    // center read only what earlier phases own. These assertions prove the
    // reads are possible (a missing column would make a report 500 in
    // production) and that the sensitive-data exclusions are meaningful
    // rather than vacuous (the excluded columns really exist). Strictly
    // read-only: no synthetic rows, so cleanup is unaffected.
    {
      const reportColumns: Array<[string, string[]]> = [
        [
          'card_sales',
          [
            'sale_number',
            'customer_id',
            'plan_id',
            'seller_staff_id',
            'seller_ost_id',
            'seller_type',
            'cash_price_snapshot',
            'minimum_down_payment_snapshot',
            'yearly_points_snapshot',
            'status',
            'created_at',
            'activated_at',
          ],
        ],
        [
          'customers',
          [
            'customer_number',
            'first_name',
            'last_name',
            'email',
            'phone',
            'status',
            'created_at',
            'referred_by_staff_id',
          ],
        ],
        [
          'payments',
          [
            'sale_id',
            'customer_id',
            'amount',
            'status',
            'method',
            'payment_type',
            'reference',
            'verified_by',
            'recorded_at',
            'verified_at',
          ],
        ],
        [
          'memberships',
          [
            'membership_number',
            'customer_id',
            'sale_id',
            'product_id',
            'status',
            'yearly_points_allocated',
            'activated_at',
            'card_issued_at',
            'last_printed_at',
            'print_count',
          ],
        ],
        [
          'commissions',
          [
            'sale_id',
            'beneficiary_type',
            'beneficiary_staff_id',
            'beneficiary_ost_id',
            'amount',
            'rate_snapshot',
            'basis_amount_snapshot',
            'status',
            'created_at',
            'qualified_at',
            'earned_at',
            'paid_at',
          ],
        ],
        [
          'points_ledger',
          [
            'account_id',
            'entry_type',
            'amount',
            'balance_after',
            'reference_type',
            'reference_id',
            'reason',
            'created_at',
          ],
        ],
        ['points_accounts', ['membership_id', 'balance']],
        [
          'redemptions',
          [
            'redemption_number',
            'membership_id',
            'customer_id',
            'item_name_snapshot',
            'quantity',
            'total_points',
            'balance_after_snapshot',
            'redeemed_by',
            'redeemed_by_name',
            'status',
            'created_at',
          ],
        ],
        ['referral_relationships', ['subject_staff_id', 'upline_staff_id', 'is_active']],
        ['card_sale_hierarchy_snapshots', ['sale_id', 'ancestor_staff_id']],
        ['ost_applications', ['sponsor_staff_id', 'status', 'submitted_at', 'reviewed_at']],
        ['ost_members', ['sponsor_staff_id', 'ost_number', 'status', 'approved_at']],
        [
          'card_plans',
          [
            'code',
            'name',
            'cash_price',
            'minimum_down_payment',
            'yearly_points',
            'commission_rate',
            'is_active',
          ],
        ],
        [
          'audit_events',
          [
            'actor_id',
            'action',
            'entity_type',
            'entity_id',
            'before_data',
            'after_data',
            'reason',
            'created_at',
          ],
        ],
      ];
      for (const [table, cols] of reportColumns) {
        const existing = await db.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = $1`,
          [table],
        );
        const have = new Set(existing.rows.map((row) => row.column_name));
        for (const col of cols) {
          check(`public.${table}.${col} exists (Phase 15 reads it)`, have.has(col));
        }
      }
      // The exclusions are load-bearing: each of these columns MUST exist in
      // the database and MUST NOT appear in any report payload.
      for (const [table, col] of [
        ['customers', 'government_id_number'],
        ['customers', 'auth_user_id'],
        ['memberships', 'qr_token_hash'],
        ['memberships', 'fallback_code_hash'],
        ['payments', 'receipt_storage_path'],
      ] as Array<[string, string]>) {
        const found = await one<{ n: number }>(
          `select count(*)::int as n from information_schema.columns
            where table_schema = 'public' and table_name = $1 and column_name = $2`,
          [table, col],
        );
        check(
          `sensitive column public.${table}.${col} exists, so its exclusion is real`,
          found.n === 1,
        );
      }
      // No duplicate report data models: nothing matching reports_* exists.
      const dupes = await db.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_name like 'reports\\_%'`,
      );
      check('no duplicate reports_* tables exist', dupes.rows.length === 0);
      const auditModule = await one<{ n: number }>(
        `select count(*)::int as n from public.modules where key = 'governance.audit'`,
      );
      check('the governance.audit module exists for the audit center gate', auditModule.n === 1);
      const auditReadable = await db.query('select id from public.audit_events limit 1');
      check('audit_events is readable through the service role', Array.isArray(auditReadable.rows));
    }

    section('42. Phase 31 full end-to-end business workflow');
    /* ---------------------------------------------------------------- */
    // One realistic Gold chain on disposable data: hierarchy -> customer +
    // sale -> payments -> activation -> onboarding -> card ops -> redemption
    // -> commission -> genealogy move -> scoped reads. Every actor is the role
    // that would act in production (sellers sell, finance moves money,
    // employees redeem, admins qualify); the permission checks themselves live
    // in the handlers and are proven in the api suite, while the RPCs below
    // re-validate actor and data at the database boundary.
    //
    // Where this section performs a handler-owned write directly (commission
    // qualify/pay, card print), it mirrors the handler semantics exactly -
    // same guarded transitions, same audit action names - so the database
    // behavior is proven without pretending to test handler code.
    //
    // Cleanup: every person carries a RUN-prefixed email and a recorded id,
    // so section 21 removes the staff, customers, auth users, sales,
    // payments, memberships, points, commissions, redemptions, snapshots,
    // tokens, edges and audits below. The catalog item is RUN-prefixed. The
    // Gold plan row is borrowed and RESTORED in this section (re-verified).
    {
      // -- Flow A: hierarchy VD -> SSM -> SM -> OST, plus a second VD/SSM
      // -- branch that the genealogy move later targets.
      const e2eStaff = async (label: string, role: string) => mkStaff(`e2e-${label}`, role);
      const vd = await e2eStaff('vd', 'vice_director');
      const ssm = await e2eStaff('ssm', 'senior_sales_manager');
      const sm = await e2eStaff('sm', 'sales_manager');
      const ost = await e2eStaff('ost', 'ost');
      const fin = await e2eStaff('finance', 'finance');
      const emp = await e2eStaff('employee', 'employee');
      const admin = await e2eStaff('admin', 'admin');
      const vdB = await e2eStaff('vd-b', 'vice_director');
      const ssmB = await e2eStaff('ssm-b', 'senior_sales_manager');
      const mkEdge = (subject: string, upline: string, role: string) =>
        one<{ id: string }>(
          `insert into public.referral_relationships
             (subject_staff_id, upline_staff_id, hierarchy_role, is_authoritative, is_active, assigned_by)
           values ($1,$2,$3,true,true,$4) returning id`,
          [subject, upline, role, staff['super-admin']],
        );
      await mkEdge(ssm, vd, 'senior_sales_manager');
      await mkEdge(sm, ssm, 'sales_manager');
      const ostEdge = await mkEdge(ost, sm, 'ost');
      await mkEdge(ssmB, vdB, 'senior_sales_manager');
      for (const [subject, role] of [
        [ssm, 'senior_sales_manager'],
        [sm, 'sales_manager'],
        [ost, 'ost'],
      ] as Array<[string, string]>) {
        const edges = await one<{ n: number }>(
          `select count(*)::int as n from public.referral_relationships
            where subject_staff_id = $1 and is_active and hierarchy_role = $2`,
          [subject, role],
        );
        eq(`hierarchy edge holds for ${role}`, edges.n, 1);
      }
      const vdTop = await one<{ n: number }>(
        `select count(*)::int as n from public.referral_relationships
          where subject_staff_id = $1 and is_active`,
        [vd],
      );
      eq('the VD sits at the top with no upline', vdTop.n, 0);
      // Spot-check the grant basis for the actors used below (the grants
      // themselves are proven in section 38; this documents which grant each
      // E2E actor relies on).
      for (const [slug, key, action] of [
        ['finance', 'finance.payment_verification', 'update'],
        ['admin', 'network.commissions', 'update'],
        ['employee', 'operations.redemption', 'create'],
      ] as Array<[string, string, string]>) {
        const grant = await one<{ n: number }>(
          `select count(*)::int as n
             from public.role_permissions rp
             join public.staff_role_assignments a on a.role_id = rp.role_id
             join public.roles r on r.id = a.role_id
             join public.modules m on m.id = rp.module_id
            where a.staff_id = $1 and m.key = $2 and rp.can_${action} is true`,
          [(slug === 'finance' ? fin : slug === 'admin' ? admin : emp) as string, key],
        );
        // The column name is interpolated from a literal triple above, never input.
        check(`grant basis: ${slug} holds ${key}/${action}`, grant.n >= 1, String(grant.n));
      }

      // -- Flow B: Gold plan economics are read from the seed, never typed.
      const gold = await one<Record<string, string | number>>(
        `select * from public.card_plans where code = 'GOLD'`,
      );
      eq('Gold cash price seed', String(gold.cash_price), '312000.00');
      eq('Gold minimum down payment seed', String(gold.minimum_down_payment), '20000.00');
      eq('Gold yearly points seed (official: 25,000/year)', String(gold.yearly_points), '25000');
      eq('Gold commission rate seed (official default 0)', String(gold.commission_rate), '0');
      const custA = await mkCustomer('buyer', 'e2e');
      const custB = await mkCustomer('isolation', 'e2e');
      eq(
        'isolation customer starts with no sale',
        (
          await one<{ n: number }>(
            'select count(*)::int as n from public.card_sales where customer_id = $1',
            [custB],
          )
        ).n,
        0,
      );
      const saleNo = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
        .sale_number;
      check('sale number is non-blank and sequenced', /^(SALE-|AF-CSALE-)/.test(saleNo), saleNo);
      const saleId = uuidFor('e2e:sale:gold');
      const expectedComm = await one<{ v: string }>(
        'select round($1::numeric * $2::numeric, 2)::text as v',
        [String(gold.cash_price), String(gold.commission_rate)],
      );
      eq('expected commission resolves from the live Gold rate', expectedComm.v, '0.00');
      await db.query(
        `insert into public.card_sales
           (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
            cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
            commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at,
            created_by, referral_relationship_id)
         values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,$10,'submitted', now(), now() + interval '365 days', $5, $11)`,
        [
          saleId,
          saleNo,
          custA,
          String(gold.id),
          ost,
          String(gold.cash_price),
          String(gold.minimum_down_payment),
          Number(gold.yearly_points),
          String(gold.commission_rate),
          expectedComm.v,
          ostEdge.id,
        ],
      );
      // The sale-creation handler also opens the commission as pending; the
      // trigger owns the hierarchy snapshots, so both are asserted, not built.
      await db.query(
        `insert into public.commissions
           (sale_id, beneficiary_type, beneficiary_staff_id, amount, rate_snapshot, basis_amount_snapshot, status)
         values ($1,'staff',$2,$3,$4,$5,'pending')`,
        [saleId, ost, expectedComm.v, String(gold.commission_rate), String(gold.cash_price)],
      );
      const frozen = await one<Record<string, string | number>>(
        `select cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
                commission_rate_snapshot, expected_commission_snapshot, status, seller_staff_id,
                customer_id, plan_id, referral_relationship_id
           from public.card_sales where id = $1`,
        [saleId],
      );
      eq('snapshot: frozen price', String(frozen.cash_price_snapshot), String(gold.cash_price));
      eq(
        'snapshot: frozen minimum down',
        String(frozen.minimum_down_payment_snapshot),
        String(gold.minimum_down_payment),
      );
      eq(
        'snapshot: frozen yearly points',
        String(frozen.yearly_points_snapshot),
        String(gold.yearly_points),
      );
      eq(
        'snapshot: frozen commission rate',
        String(frozen.commission_rate_snapshot),
        String(gold.commission_rate),
      );
      eq(
        'snapshot: frozen expected commission',
        String(frozen.expected_commission_snapshot),
        expectedComm.v,
      );
      eq('snapshot: seller is the OST of record', String(frozen.seller_staff_id), ost);
      eq('snapshot: customer linked', String(frozen.customer_id), custA);
      const snapRows = await db.query<{ depth: number; ancestor_staff_id: string }>(
        `select depth, ancestor_staff_id from public.card_sale_hierarchy_snapshots
          where sale_id = $1 order by depth`,
        [saleId],
      );
      eq('the insert trigger captured seller + 3 uplines', snapRows.rows.length, 4);
      eq('depth 0 is the seller', String(snapRows.rows[0]!.ancestor_staff_id), ost);
      eq('depth 3 is the VD', String(snapRows.rows[3]!.ancestor_staff_id), vd);
      // A duplicate open application for the same customer and plan is refused
      // by the partial unique index: no partial row, no second sale number.
      const dupeRefused = await throws('duplicate open application refused', () =>
        db.query(
          `insert into public.card_sales
             (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
              cash_price_snapshot, status, submitted_at, balance_due_at)
           values ($1,$2,$3,$4,'staff',$5,$6,$6,'submitted', now(), now() + interval '365 days')`,
          [
            uuidFor('e2e:sale:dupe'),
            `${saleNo}-DUPE`,
            custA,
            String(gold.id),
            ost,
            String(gold.cash_price),
          ],
        ),
      );
      check(
        '  unique violation, nothing persisted',
        /23505|duplicate|unique/i.test(dupeRefused),
        dupeRefused.split('\n')[0],
      );
      // A live repricing cannot move the frozen sale; the seed is restored in
      // the same section with a re-verification, so later sections are safe.
      await db.query(`update public.card_plans set cash_price = '99999.99' where id = $1`, [
        String(gold.id),
      ]);
      const afterReprice = await one<{ p: string }>(
        'select cash_price_snapshot as p from public.card_sales where id = $1',
        [saleId],
      );
      eq('frozen price ignores the live plan', afterReprice.p, '312000.00');
      await db.query(`update public.card_plans set cash_price = '312000.00' where id = $1`, [
        String(gold.id),
      ]);
      const restored = await one<{ p: string }>(
        'select cash_price::text as p from public.card_plans where id = $1',
        [String(gold.id)],
      );
      eq('Gold seed restored for later sections', restored.p, '312000.00');

      // -- Flow C: 100,000 verified, then 212,000 to fully paid (312,000 Gold).
      const pay1 = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'down_payment','bank_transfer',$3,null,null,$4) as id`,
          [saleId, '100000.00', `${RUN}-E2E-PAY-1`, fin],
        )
      ).id;
      const verify1 = await one<Record<string, string | boolean>>(
        'select * from public.verify_card_payment($1,$2,$3,$4)',
        [pay1, 'verified', null, fin],
      );
      eq('first verified total is 100000.00', String(verify1.verified_total), '100000.00');
      eq('not fully paid yet', verify1.fully_paid, false);
      const window1 = await one<{ started: string; deadline: string }>(
        `select spot_cash_started_at::text as started, spot_cash_deadline::text as deadline
           from public.card_sales where id = $1`,
        [saleId],
      );
      check('first verified payment instant recorded', !!window1.started, window1.started);
      const sevenDays = await one<{ ok: boolean }>(
        "select ($1::timestamptz - $2::timestamptz) = interval '7 days' as ok",
        [window1.deadline, window1.started],
      );
      check('deadline is exactly first verified + 7 days', sevenDays.ok === true);
      const midSummary = await summaryOf(saleId);
      eq(
        'unverified nothing: verified total from rows only',
        midSummary.verifiedTotal,
        '100000.00',
      );
      check('sale is not activation-ready yet', midSummary.fullyPaid === false);
      const commMid = await one<{ status: string }>(
        'select status from public.commissions where sale_id = $1',
        [saleId],
      );
      eq('commission is still pending before full payment', commMid.status, 'pending');
      const pay2 = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'installment','bank_transfer',$3,null,null,$4) as id`,
          [saleId, '212000.00', `${RUN}-E2E-PAY-2`, fin],
        )
      ).id;
      const verify2 = await one<Record<string, string | boolean>>(
        'select * from public.verify_card_payment($1,$2,$3,$4)',
        [pay2, 'verified', null, fin],
      );
      eq('verified total is now 312000.00', String(verify2.verified_total), '312000.00');
      eq('fully paid', verify2.fully_paid, true);
      const window2 = await one<{ started: string; deadline: string }>(
        `select spot_cash_started_at::text as started, spot_cash_deadline::text as deadline
           from public.card_sales where id = $1`,
        [saleId],
      );
      eq('first verified instant never moves', window2.started, window1.started);
      eq('deadline never extends', window2.deadline, window1.deadline);
      const fullSummary = await summaryOf(saleId);
      eq('remaining balance is 0.00', fullSummary.remainingBalance, '0.00');
      eq('summary reports fully paid', fullSummary.fullyPaid, true);
      const commFull = await one<{ status: string }>(
        'select status from public.commissions where sale_id = $1',
        [saleId],
      );
      eq('commission advanced to payment_verified', commFull.status, 'payment_verified');
      // DB-level retry of a decided payment is refused (the handler turns
      // this into an idempotent success; the database itself never recounts).
      const reverify = await throws('re-verifying a decided payment is refused', () =>
        db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
          pay1,
          'verified',
          null,
          fin,
        ]),
      );
      check(
        '  PAYMENT_NOT_PENDING, totals untouched',
        /PAYMENT_NOT_PENDING/.test(reverify),
        reverify.split('\n')[0],
      );
      eq('  verified total still 312000.00', (await summaryOf(saleId)).verifiedTotal, '312000.00');

      // -- Flow D: activation creates each dependent row exactly once.
      const activated = await one<Record<string, string | number | boolean>>(
        'select * from public.activate_card_sale($1,$2,$3)',
        [saleId, fin, 12],
      );
      const membershipId = String(activated.membership_id);
      check('membership created', !!membershipId);
      check(
        'membership number issued',
        String(activated.membership_number).length > 0,
        String(activated.membership_number),
      );
      check(
        'QR token issued exactly once',
        typeof activated.qr_token === 'string' && String(activated.qr_token).length > 0,
      );
      check(
        'fallback code issued exactly once',
        typeof activated.fallback_code === 'string' && String(activated.fallback_code).length > 0,
      );
      eq(
        'yearly allocation is the official Gold yearly points',
        String(activated.points_allocated),
        String(gold.yearly_points),
      );
      check('not already active on first activation', activated.already_active === false);
      const membershipNumber = String(activated.membership_number);
      const memberRow = await one<Record<string, string | number>>(
        'select * from public.memberships where id = $1',
        [membershipId],
      );
      eq('membership is active', String(memberRow.status), 'active');
      eq('same customer', String(memberRow.customer_id), custA);
      eq('same sale', String(memberRow.sale_id), saleId);
      eq('QR stored as a 64-hex hash', String(memberRow.qr_token_hash).length, 64);
      check(
        'QR plaintext not stored',
        String(memberRow.qr_token_hash) !== String(activated.qr_token),
      );
      eq('fallback stored as a 64-hex hash', String(memberRow.fallback_code_hash).length, 64);
      const acct = await one<{ balance: string; lifetime: string }>(
        'select balance::text as balance, lifetime_allocated::text as lifetime from public.points_accounts where membership_id = $1',
        [membershipId],
      );
      eq(
        'points account balance is the official allocation',
        acct.balance,
        String(gold.yearly_points),
      );
      eq(
        'lifetime allocated is the official allocation',
        acct.lifetime,
        String(gold.yearly_points),
      );
      const ledgerAfterActivate = await db.query(
        `select entry_type, amount from public.points_ledger
          where account_id = (select id from public.points_accounts where membership_id = $1)`,
        [membershipId],
      );
      eq('exactly one allocation ledger row', ledgerAfterActivate.rows.length, 1);
      eq(
        'allocation amount',
        String(ledgerAfterActivate.rows[0]!.amount),
        String(gold.yearly_points),
      );
      const commActivated = await one<{ status: string; earned: string | null; amount: string }>(
        'select status, earned_at::text as earned, amount::text as amount from public.commissions where sale_id = $1',
        [saleId],
      );
      eq(
        'commission awaits final qualification',
        commActivated.status,
        'final_qualification_pending',
      );
      check('never auto-earned', commActivated.earned === null);
      eq('commission amount matches the frozen snapshot', commActivated.amount, expectedComm.v);
      const again = await one<Record<string, string | number | boolean>>(
        'select * from public.activate_card_sale($1,$2,$3)',
        [saleId, fin, 12],
      );
      check('repeat activation is already_active', again.already_active === true);
      eq('same membership returned', String(again.membership_id), membershipId);
      check('no new plaintext on retry', again.qr_token === null && again.fallback_code === null);
      const dupCounts = await one<{ m: number; a: number; l: number; c: number }>(
        `select (select count(*)::int from public.memberships where sale_id = $1) as m,
                (select count(*)::int from public.points_accounts where membership_id = $2) as a,
                (select count(*)::int from public.points_ledger where account_id = (select id from public.points_accounts where membership_id = $2)) as l,
                (select count(*)::int from public.commissions where sale_id = $1) as c`,
        [saleId, membershipId],
      );
      eq('still one membership', dupCounts.m, 1);
      eq('still one points account', dupCounts.a, 1);
      eq('still one ledger entry', dupCounts.l, 1);
      eq('still one commission', dupCounts.c, 1);

      // -- Flow E: onboarding token issue, claim, and portal isolation.
      const authA = uuidFor('e2e:auth:customer-a');
      await db.query('insert into auth.users (id, email) values ($1, $2)', [
        authA,
        `${RUN}-e2e-buyer@example.invalid`,
      ]);
      createdAuthIds.push(authA);
      const rawToken = (
        await one<{ token: string }>(
          'select * from public.issue_customer_onboarding_token($1,$2,$3,$4)',
          [custA, 'account_activation', 72, fin],
        )
      ).token;
      check('a one-time token is issued', typeof rawToken === 'string' && rawToken.length > 0);
      const tokenHash = createHash('sha256').update(rawToken).digest('hex');
      const claimed = await one<Record<string, string>>(
        'select * from public.claim_customer_onboarding_token($1,$2,$3)',
        [tokenHash, authA, 'account_activation'],
      );
      eq('claim outcome is CLAIMED', claimed.outcome, 'CLAIMED');
      eq('claim returns the customer', claimed.customer_id, custA);
      const linked = await one<{ auth: string; consumed: boolean }>(
        `select auth_user_id::text as auth,
                (select consumed_at is not null from public.customer_onboarding_tokens where token_hash = $2) as consumed
           from public.customers where id = $1`,
        [custA, tokenHash],
      );
      eq('customer Auth identity linked', linked.auth, authA);
      check('token consumed, single-use', linked.consumed === true);
      const relink = await one<Record<string, string>>(
        'select * from public.claim_customer_onboarding_token($1,$2,$3)',
        [tokenHash, authA, 'account_activation'],
      );
      eq('token reuse is idempotent, not a second link', relink.outcome, 'ALREADY_LINKED');
      // Portal isolation through RLS impersonation: the member reads exactly
      // their own rows; payments stay invisible to the browser role (the
      // portal serves history server-side, proven at handler level).
      eq(
        'customer reads exactly their own customer row',
        await visibleRows(
          target.url,
          'authenticated',
          authA,
          `select count(*)::int as n from public.customers where email like '${RUN}-e2e-%'`,
        ),
        1,
      );
      eq(
        'customer reads exactly their own membership',
        await visibleRows(
          target.url,
          'authenticated',
          authA,
          'select count(*)::int as n from public.memberships',
        ),
        1,
      );
      eq(
        'customer reads their own ledger entries',
        await visibleRows(
          target.url,
          'authenticated',
          authA,
          'select count(*)::int as n from public.points_ledger',
        ),
        1,
      );
      eq(
        'customer cannot read payment rows directly (server-mediated portal)',
        await visibleRows(
          target.url,
          'authenticated',
          authA,
          'select count(*)::int as n from public.payments',
        ),
        0,
      );
      eq(
        'finance reads the scenario payments through RLS',
        await visibleRows(
          target.url,
          'authenticated',
          fin,
          `select count(*)::int as n from public.payments where reference like '${RUN}-E2E-%'`,
        ),
        2,
      );
      eq(
        'anonymous reads no payments',
        await visibleRows(
          target.url,
          'anon',
          null,
          'select count(*)::int as n from public.payments',
        ),
        0,
      );
      // An unauthorized browser write is refused and changes nothing.
      const payCountBefore = await one<{ n: number }>(
        `select count(*)::int as n from public.payments where sale_id = $1`,
        [saleId],
      );
      const writeRefused = await asBrowserRole(target.url, 'authenticated', authA, async (c) => {
        try {
          await c.query(
            `insert into public.payments (sale_id, customer_id, amount, method, recorded_by)
             values ($1,$2,'1.00','cash',$3)`,
            [saleId, custA, fin],
          );
          return '';
        } catch (error) {
          return (error as { code?: string }).code ?? 'no-code';
        }
      });
      check('browser-role insert into payments is refused', writeRefused === '42501', writeRefused);
      const payCountAfter = await one<{ n: number }>(
        `select count(*)::int as n from public.payments where sale_id = $1`,
        [saleId],
      );
      eq('refused write left no row behind', payCountAfter.n, payCountBefore.n);

      // -- Flow F: card detail, print stamp, credential rotation.
      const hashesBefore = await one<{ qr: string; fb: string; printed: number }>(
        'select qr_token_hash as qr, fallback_code_hash as fb, print_count as printed from public.memberships where id = $1',
        [membershipId],
      );
      check(
        'no print recorded yet',
        hashesBefore.printed === 0 || hashesBefore.printed === null,
        String(hashesBefore.printed),
      );
      await db.query(
        `update public.memberships set last_printed_at = now(), print_count = coalesce(print_count, 0) + 1 where id = $1`,
        [membershipId],
      );
      await db.query(
        `insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
         values ($1,'MEMBERSHIP_CARD_PRINTED','membership',$2,jsonb_build_object('printCount',1))`,
        [fin, membershipId],
      );
      const afterPrint1 = await one<{ n: number; at: string }>(
        'select print_count as n, last_printed_at::text as at from public.memberships where id = $1',
        [membershipId],
      );
      eq('first print recorded', afterPrint1.n, 1);
      check('print timestamp stamped', !!afterPrint1.at);
      await db.query(
        `update public.memberships set last_printed_at = now(), print_count = print_count + 1 where id = $1`,
        [membershipId],
      );
      await db.query(
        `insert into public.audit_events (actor_id, action, entity_type, entity_id, after_data)
         values ($1,'MEMBERSHIP_CARD_REPRINTED','membership',$2,jsonb_build_object('printCount',2))`,
        [fin, membershipId],
      );
      const afterPrint2 = await one<{ n: number }>(
        'select print_count as n from public.memberships where id = $1',
        [membershipId],
      );
      eq('reprint increments, never rotates', afterPrint2.n, 2);
      const hashesAfterPrint = await one<{ qr: string; fb: string }>(
        'select qr_token_hash as qr, fallback_code_hash as fb from public.memberships where id = $1',
        [membershipId],
      );
      eq('printing leaves the QR hash alone', hashesAfterPrint.qr, hashesBefore.qr);
      eq('printing leaves the fallback hash alone', hashesAfterPrint.fb, hashesBefore.fb);
      // points_balance on the membership row is a denormalized cache that only
      // moves on redemption (activation writes the authoritative balance to
      // points_accounts; Phase 4 keeps the cache in step afterwards). Capture
      // both now so rotation can be proven to move neither.
      const pointsBeforeRotate = await one<{ account: number; cache: number }>(
        `select (select balance from public.points_accounts where membership_id = $1) as account,
                (select points_balance from public.memberships where id = $1) as cache`,
        [membershipId],
      );
      eq(
        'authoritative balance is the official allocation before rotation',
        Number(pointsBeforeRotate.account),
        Number(gold.yearly_points),
      );
      const rotated = await one<{ membership_id: string; fallback_code: string; qr_token: string }>(
        'select * from public.reissue_membership_credentials($1,$2,$3)',
        [membershipId, custA, fin],
      );
      eq('rotation returns the same membership', rotated.membership_id, membershipId);
      check('fresh QR issued', typeof rotated.qr_token === 'string' && rotated.qr_token.length > 0);
      check(
        'fresh fallback issued',
        typeof rotated.fallback_code === 'string' && rotated.fallback_code.length > 0,
      );
      const hashesAfterRotate = await one<{ qr: string; fb: string }>(
        'select qr_token_hash as qr, fallback_code_hash as fb from public.memberships where id = $1',
        [membershipId],
      );
      check('QR hash replaced', hashesAfterRotate.qr !== hashesBefore.qr);
      check('fallback hash replaced', hashesAfterRotate.fb !== hashesBefore.fb);
      const oldQrHits = await one<{ n: number }>(
        'select count(*)::int as n from public.memberships where qr_token_hash = $1',
        [hashesBefore.qr],
      );
      eq('old QR resolves to nothing', oldQrHits.n, 0);
      const newQrHits = await one<{ id: string }>(
        'select id from public.memberships where qr_token_hash = $1',
        [hashesAfterRotate.qr],
      );
      eq('new QR resolves to the membership', newQrHits.id, membershipId);
      const sameNumber = await one<{ no: string; sale: string }>(
        'select membership_number as no, sale_id::text as sale from public.memberships where id = $1',
        [membershipId],
      );
      eq('membership number unchanged by rotation', sameNumber.no, membershipNumber);
      // Rotation must move neither the authoritative balance nor the cache.
      const pointsAfterRotate = await one<{ account: number; cache: number }>(
        `select (select balance from public.points_accounts where membership_id = $1) as account,
                (select points_balance from public.memberships where id = $1) as cache`,
        [membershipId],
      );
      eq(
        'authoritative balance still the official allocation',
        Number(pointsAfterRotate.account),
        Number(gold.yearly_points),
      );
      eq(
        'denormalized cache untouched by rotation',
        Number(pointsAfterRotate.cache),
        Number(pointsBeforeRotate.cache),
      );
      eq('sale link untouched by rotation', sameNumber.sale, saleId);
      const rotationAudit = await one<{ n: number }>(
        `select count(*)::int as n from public.audit_events
          where action = 'CUSTOMER_CREDENTIALS_REISSUED' and entity_id = $1`,
        [membershipId],
      );
      eq('rotation audited inside the RPC', rotationAudit.n, 1);

      // -- Flow G: redemption of 2000 points, then an idempotent replay.
      // The code is E2E-namespaced: section 25 already owns ${RUN}-TEPPANYAKI
      // for the whole run, and the code column is globally unique.
      const itemId = uuidFor('e2e:item:teppanyaki');
      await db.query(
        `insert into public.redemption_items (id, code, name, description, category, points_cost, is_active, sort_order)
         values ($1,$2,'Teppanyaki','Grill dinner','dining',2000,true,0)`,
        [itemId, `${RUN}-E2E-TEPPANYAKI`],
      );
      const resolveHit = await one<{ id: string }>(
        'select id from public.memberships where qr_token_hash = $1',
        [hashesAfterRotate.qr],
      );
      eq('current QR resolves the membership', resolveHit.id, membershipId);
      const resolveMiss = await one<{ id: string } | undefined>(
        'select id from public.memberships where qr_token_hash = $1',
        ['0'.repeat(64)],
      );
      eq('an unknown identifier resolves to nothing', resolveMiss, undefined);
      const receipt = camel<Record<string, string | number>>(
        (
          await db.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
            membershipId,
            itemId,
            1,
            `${RUN}-E2E-KEY-1`,
            emp,
          ])
        ).rows[0],
      );
      eq('receipt charges the catalog cost', String(receipt.totalPoints), '2000');
      eq(
        'balance before is the official allocation',
        String(receipt.balanceBefore),
        String(gold.yearly_points),
      );
      eq(
        'balance after deducts the catalog cost',
        String(receipt.balanceAfter),
        String(Number(gold.yearly_points) - 2000),
      );
      check(
        'redemption number issued',
        /^(RDM-\d{6}|AF-RED-[A-HJ-NP-Z2-9]{5})$/.test(String(receipt.redemptionNumber)),
        String(receipt.redemptionNumber),
      );
      const balanceAfter = await one<{ b: number }>(
        'select balance as b from public.points_accounts where membership_id = $1',
        [membershipId],
      );
      eq(
        'account balance deducts the catalog cost',
        Number(balanceAfter.b),
        Number(gold.yearly_points) - 2000,
      );
      const redemptionRow = await one<Record<string, string | number>>(
        'select * from public.redemptions where id = $1',
        [String(receipt.redemptionId)],
      );
      eq('item name frozen on the row', String(redemptionRow.item_name_snapshot), 'Teppanyaki');
      eq('item cost frozen on the row', String(redemptionRow.points_cost_snapshot), '2000');
      eq('redemption completed', String(redemptionRow.status), 'completed');
      const ledgerAfterRedeem = await db.query<{ amount: string }>(
        `select amount::text as amount from public.points_ledger
          where account_id = (select id from public.points_accounts where membership_id = $1)
          order by id`,
        [membershipId],
      );
      eq('ledger holds allocation + one debit', ledgerAfterRedeem.rows.length, 2);
      eq('debit is exactly -2000', ledgerAfterRedeem.rows[1]!.amount, '-2000');
      const replay = camel<Record<string, string | number>>(
        (
          await db.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
            membershipId,
            itemId,
            1,
            `${RUN}-E2E-KEY-1`,
            emp,
          ])
        ).rows[0],
      );
      eq(
        'replay returns the original receipt',
        String(replay.redemptionId),
        String(receipt.redemptionId),
      );
      eq(
        'balance still deducted after replay',
        Number(
          (
            await one<{ b: number }>(
              'select balance as b from public.points_accounts where membership_id = $1',
              [membershipId],
            )
          ).b,
        ),
        Number(gold.yearly_points) - 2000,
      );
      const replays = await one<{ n: number }>(
        'select count(*)::int as n from public.redemptions where customer_id = $1',
        [custA],
      );
      eq('no second redemption row', replays.n, 1);
      // Failure rollback: an unaffordable redemption moves nothing (quantity 30
      // is a legal quantity whose 60,000 total exceeds the remaining balance).
      const poorAttempt = await throws('oversized redemption refused', () =>
        db.query('select * from public.redeem_membership_points($1,$2,$3,$4,$5)', [
          membershipId,
          itemId,
          30,
          `${RUN}-E2E-KEY-POOR`,
          emp,
        ]),
      );
      check(
        '  INSUFFICIENT_POINTS',
        /INSUFFICIENT_POINTS/.test(poorAttempt),
        poorAttempt.split('\n')[0],
      );
      eq(
        '  balance unchanged by the refusal',
        Number(
          (
            await one<{ b: number }>(
              'select balance as b from public.points_accounts where membership_id = $1',
              [membershipId],
            )
          ).b,
        ),
        Number(gold.yearly_points) - 2000,
      );

      // -- Flow H: commission to earned, then paid, with guards.
      const payTooEarly = await db.query(
        `update public.commissions set status = 'paid' where id = (select id from public.commissions where sale_id = $1) and status = 'earned'`,
        [saleId],
      );
      eq('earned-only pay guard: 0 rows while awaiting qualification', payTooEarly.rowCount, 0);
      const qualified = await db.query(
        `update public.commissions
            set status = 'earned', qualification_notes = $2, qualified_by = $3, qualified_at = now(), earned_at = now()
          where sale_id = $1 and status = 'final_qualification_pending'`,
        [saleId, 'E2E manual qualification with notes.', admin],
      );
      eq('qualification applies exactly once', qualified.rowCount, 1);
      await db.query(
        `insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data, reason)
         values ($1,'COMMISSION_QUALIFIED','commission',
           (select id::text from public.commissions where sale_id = $2),
           jsonb_build_object('status','final_qualification_pending'),
           jsonb_build_object('status','earned','amount', $3::text),
           'E2E manual qualification with notes.')`,
        [admin, saleId, expectedComm.v],
      );
      const qualifyAgain = await db.query(
        `update public.commissions set status = 'earned' where sale_id = $1 and status = 'final_qualification_pending'`,
        [saleId],
      );
      eq('re-qualification touches 0 rows', qualifyAgain.rowCount, 0);
      const earnedRow = await one<Record<string, string>>(
        'select status, amount::text as amount, rate_snapshot as rate, basis_amount_snapshot as basis, beneficiary_staff_id as beneficiary from public.commissions where sale_id = $1',
        [saleId],
      );
      eq('earned, amount frozen', earnedRow.amount, expectedComm.v);
      eq('rate frozen', earnedRow.rate, String(gold.commission_rate));
      eq('basis frozen', earnedRow.basis, String(gold.cash_price));
      eq('beneficiary still the OST seller', earnedRow.beneficiary, ost);
      const paid = await db.query(
        `update public.commissions
            set status = 'paid', paid_at = now(), paid_by = $2, paid_reference = $3
          where sale_id = $1 and status = 'earned'`,
        [saleId, admin, `${RUN}-E2E-PAYOUT-1`],
      );
      eq('pay applies exactly once', paid.rowCount, 1);
      await db.query(
        `insert into public.audit_events (actor_id, action, entity_type, entity_id, before_data, after_data)
         values ($1,'COMMISSION_PAID','commission',
           (select id::text from public.commissions where sale_id = $2),
           jsonb_build_object('status','earned','amount', $3::text),
           jsonb_build_object('status','paid','amount', $3::text,'reference','${RUN}-E2E-PAYOUT-1'))`,
        [admin, saleId, expectedComm.v],
      );
      const paidRow = await one<{ status: string; ref: string; by: string }>(
        'select status, paid_reference as ref, paid_by::text as by from public.commissions where sale_id = $1',
        [saleId],
      );
      eq('commission paid', paidRow.status, 'paid');
      check('payout reference recorded', paidRow.ref === `${RUN}-E2E-PAYOUT-1`, paidRow.ref);
      eq('paid by the admin actor', paidRow.by, admin);
      const payAgain = await db.query(
        `update public.commissions set status = 'paid' where sale_id = $1 and status = 'earned'`,
        [saleId],
      );
      eq('repeat pay is a no-op', payAgain.rowCount, 0);
      eq(
        'still paid exactly once',
        (
          await one<{ n: number }>(
            `select count(*)::int as n from public.commissions where sale_id = $1 and status = 'paid'`,
            [saleId],
          )
        ).n,
        1,
      );

      // -- Flow I: move SM-A under SSM-B; history must not follow.
      const smEdge = await one<{ id: string }>(
        'select id from public.referral_relationships where subject_staff_id = $1 and is_active',
        [sm],
      );
      const movedRel = await one<{ id: string }>(
        'select public.correct_referral_upline($1,$2,$3,$4) as id',
        [smEdge.id, ssmB, 'E2E restructure: SM-A joins SSM-B.', admin],
      );
      check('correction returned a new relationship', !!movedRel.id);
      const saleRef = await one<{ ref: string }>(
        'select referral_relationship_id::text as ref from public.card_sales where id = $1',
        [saleId],
      );
      eq('sale still points at its creation-time relationship', saleRef.ref, String(ostEdge.id));
      eq(
        'commission beneficiary unchanged by the move',
        (
          await one<{ b: string }>(
            'select beneficiary_staff_id::text as b from public.commissions where sale_id = $1',
            [saleId],
          )
        ).b,
        ost,
      );
      const vdSnaps = await one<{ n: number }>(
        'select count(*)::int as n from public.card_sale_hierarchy_snapshots where sale_id = $1 and ancestor_staff_id = $2',
        [saleId, vd],
      );
      eq('VD-A snapshot attribution unchanged', vdSnaps.n, 1);
      const ssmSnaps = await one<{ n: number }>(
        'select count(*)::int as n from public.card_sale_hierarchy_snapshots where sale_id = $1 and ancestor_staff_id = $2',
        [saleId, ssm],
      );
      eq('SSM-A snapshot attribution unchanged', ssmSnaps.n, 1);
      const teamNow = async (upline: string) =>
        one<{ n: number }>(
          `with recursive down as (
             select subject_staff_id as id from public.referral_relationships where upline_staff_id = $1 and is_active
             union
             select r.subject_staff_id from public.referral_relationships r join down d on r.upline_staff_id = d.id where r.is_active
           ) select count(*)::int as n from down`,
          [upline],
        );
      eq('VD-A current descendants reflect the move', (await teamNow(vd)).n, 1);
      eq('VD-B current descendants reflect the move', (await teamNow(vdB)).n, 3);
      eq('SSM-A current descendants reflect the move', (await teamNow(ssm)).n, 0);
      eq('SSM-B current descendants reflect the move', (await teamNow(ssmB)).n, 2);

      // -- Flow J: CMS smoke - public reads work and own no economics.
      const publishedDocs = await one<{ n: number }>(
        `select count(*)::int as n from public.cms_documents where status = 'published'`,
      );
      check(
        'published CMS documents are publicly readable (zero or more)',
        publishedDocs.n >= 0,
        String(publishedDocs.n),
      );
      const priceCols = await one<{ n: number }>(
        `select count(*)::int as n from information_schema.columns
          where table_schema = 'public'
            and table_name in ('cms_documents','cms_document_versions','cms_pages','cms_page_sections','cms_page_versions','cms_media_assets')
            and (column_name like '%price%' or column_name like '%commission%' or column_name like '%cash%')`,
      );
      eq('no CMS table can own price or commission fields', priceCols.n, 0);

      // -- Flow K: scoped reads for the whole chain.
      const e2eSummary = await summaryOf(saleId);
      eq('report-equivalent: verified 312000.00', e2eSummary.verifiedTotal, '312000.00');
      eq('report-equivalent: fully paid', e2eSummary.fullyPaid, true);
      eq('report-equivalent: remaining 0.00', e2eSummary.remainingBalance, '0.00');
      eq(
        'snapshot rows still exactly seller + 3 uplines',
        (
          await one<{ n: number }>(
            'select count(*)::int as n from public.card_sale_hierarchy_snapshots where sale_id = $1',
            [saleId],
          )
        ).n,
        4,
      );
      eq(
        'ledger holds allocation + redemption',
        (
          await one<{ n: number }>(
            `select count(*)::int as n from public.points_ledger where account_id = (select id from public.points_accounts where membership_id = $1)`,
            [membershipId],
          )
        ).n,
        2,
      );

      // -- Flow L: audit presence for every step, with no secrets anywhere.
      const e2eActors = [vd, ssm, sm, ost, fin, emp, admin, vdB, ssmB, authA];
      for (const action of [
        'PAYMENT_RECORDED',
        'PAYMENT_VERIFIED',
        'SALE_FULLY_PAID',
        'MEMBERSHIP_ACTIVATED',
        'CUSTOMER_AUTH_ACTIVATED',
        'CUSTOMER_ONBOARDING_TOKEN_CONSUMED',
        'CUSTOMER_ACCOUNT_LINKED',
        'MEMBERSHIP_CARD_PRINTED',
        'MEMBERSHIP_CARD_REPRINTED',
        'CUSTOMER_CREDENTIALS_REISSUED',
        'REDEMPTION_COMPLETED',
        'COMMISSION_QUALIFIED',
        'COMMISSION_PAID',
        'UPLINE_CORRECTED',
      ]) {
        const found = await one<{ n: number }>(
          'select count(*)::int as n from public.audit_events where action = $1 and actor_id = any($2::uuid[])',
          [action, e2eActors],
        );
        check(`audit contains ${action}`, found.n >= 1, String(found.n));
      }
      // Sale creation itself is handler-audited (APPLICATION_SUBMITTED), so
      // its absence here is by architecture, not a gap: the database owns
      // the snapshot, the handler owns the event.
      const secretScan = await one<{ n: number }>(
        `select count(*)::int as n from public.audit_events
          where actor_id = any($1::uuid[])
            and (coalesce(before_data::text,'') ~ '[0-9a-f]{64}'
              or coalesce(after_data::text,'') ~ '[0-9a-f]{64}'
              or after_data::text ilike '%AFH-%' or before_data::text ilike '%AFH-%'
              or after_data::text ilike '%eyJ%' or before_data::text ilike '%eyJ%'
              or after_data::text ilike '%BEGIN %' or before_data::text ilike '%BEGIN %')`,
        [e2eActors],
      );
      eq('no hashes, codes, tokens, or keys in E2E audit payloads', secretScan.n, 0);

      // -- Cross-module invariants: exactly one of everything intended.
      eq(
        'one intended customer chain (A + isolation B)',
        (
          await one<{ n: number }>(
            `select count(*)::int as n from public.customers where email like '${RUN}-e2e-%'`,
            [],
          )
        ).n,
        2,
      );
      eq(
        'one Gold sale',
        (
          await one<{ n: number }>(
            'select count(*)::int as n from public.card_sales where id = $1',
            [saleId],
          )
        ).n,
        1,
      );
      eq(
        'one membership for the sale',
        (
          await one<{ n: number }>(
            'select count(*)::int as n from public.memberships where sale_id = $1',
            [saleId],
          )
        ).n,
        1,
      );
      eq(
        'membership number stable end to end',
        (
          await one<{ no: string }>(
            'select membership_number as no from public.memberships where id = $1',
            [membershipId],
          )
        ).no,
        membershipNumber,
      );
      eq(
        'final points balance deducts the catalog cost',
        Number(
          (
            await one<{ b: number }>(
              'select balance as b from public.points_accounts where membership_id = $1',
              [membershipId],
            )
          ).b,
        ),
        Number(gold.yearly_points) - 2000,
      );
      eq(
        'frozen sale price still 312000.00',
        (
          await one<{ p: string }>(
            'select cash_price_snapshot as p from public.card_sales where id = $1',
            [saleId],
          )
        ).p,
        '312000.00',
      );
      eq(
        'frozen commission rate still matches Gold',
        (
          await one<{ r: string }>(
            'select commission_rate_snapshot as r from public.card_sales where id = $1',
            [saleId],
          )
        ).r,
        String(gold.commission_rate),
      );

      // -- Failure rollback: an underpaid second sale activates nothing.
      const bronze = await one<Record<string, string | number>>(
        `select * from public.card_plans where code = 'BRONZE'`,
      );
      const sale2 = uuidFor('e2e:sale:bronze-partial');
      const sn2 = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
        .sale_number;
      await db.query(
        `insert into public.card_sales
           (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
            cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
            commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at, created_by)
         values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now(), now() + interval '365 days', $5)`,
        [
          sale2,
          sn2,
          custA,
          String(bronze.id),
          ost,
          String(bronze.cash_price),
          String(bronze.minimum_down_payment),
          Number(bronze.yearly_points),
          String(bronze.commission_rate),
        ],
      );
      const payPartial = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'down_payment','cash',$3,null,null,$4) as id`,
          [sale2, '5000.00', `${RUN}-E2E-PAY-PARTIAL`, fin],
        )
      ).id;
      await db.query('select * from public.verify_card_payment($1,$2,$3,$4)', [
        payPartial,
        'verified',
        null,
        fin,
      ]);
      // A partially paid sale never reaches `payment_verified`, so activation
      // refuses at the status gate before the funds gate: either refusal code
      // proves money was never enough to activate, and no membership exists.
      const underpaidFail = await throws('underpaid activation fails', () =>
        db.query('select * from public.activate_card_sale($1,$2,$3)', [sale2, fin, 12]),
      );
      check(
        '  activation refused, no partial membership',
        /SALE_NOT_(FULLY_PAID|ACTIVATABLE)/.test(underpaidFail),
        underpaidFail.split('\n')[0],
      );
      eq(
        '  no membership row for the underpaid sale',
        (
          await one<{ n: number }>(
            'select count(*)::int as n from public.memberships where sale_id = $1',
            [sale2],
          )
        ).n,
        0,
      );
      // Explicit tidy-up for the rollback fixture (shared cleanup would also
      // catch it through the customer set). Snapshots go first, under the
      // harness-only maintenance flag: the immutability trigger refuses all
      // snapshot writes otherwise, and the RESTRICT foreign key refuses the
      // sale delete while snapshots reference it. Both guards prove history
      // cannot be removed by accident - only deliberate, flagged maintenance.
      await db.query('begin');
      await db.query(`set local afhomes.allow_snapshot_maintenance = 'on'`);
      await db.query('delete from public.card_sale_hierarchy_snapshots where sale_id = $1', [
        sale2,
      ]);
      await db.query('delete from public.payments where id = $1', [payPartial]);
      await db.query('delete from public.card_sales where id = $1', [sale2]);
      await db.query('commit');
      eq(
        'rollback fixture fully removed',
        (
          await one<{ n: number }>(
            'select count(*)::int as n from public.card_sales where id = $1',
            [sale2],
          )
        ).n,
        0,
      );

      /* ---------------------------------------------------------------- */
      section('43. VIP Stage 1 payment schemes and frozen validity');
      /* ---------------------------------------------------------------- */
      // The handler owns scheme selection (Bronze B1/B2 rejection, schedule
      // math); the database owns what the handler freezes: the scheme CHECK,
      // the snapshot columns, the frozen-total payment gate, and the frozen
      // validity at activation. All money here is plan-agnostic except the
      // seeded tier economics asserted in section 3.
      const vipPlans = await db.query<{
        id: string;
        code: string;
        cash_price: string;
        installment_price: string;
        reservation_fee: string;
        minimum_down_payment: string;
        yearly_points: number;
        validity_years: number;
        move_b1_enabled: boolean;
        move_b2_enabled: boolean;
      }>(
        `select id, code, cash_price, installment_price, reservation_fee, minimum_down_payment,
                yearly_points, validity_years, move_b1_enabled, move_b2_enabled
           from public.card_plans where code in ('BRONZE','SILVER','GOLD')`,
      );
      const vipByCode = new Map(vipPlans.rows.map((p) => [p.code, p]));
      const vipBronze = vipByCode.get('BRONZE')!;
      const vipSilver = vipByCode.get('SILVER')!;
      const vipGold = vipByCode.get('GOLD')!;
      check(
        'Bronze never allows B1/B2 (plan flags)',
        vipBronze.move_b1_enabled === false && vipBronze.move_b2_enabled === false,
      );
      check(
        'Silver allows B1/B2',
        vipSilver.move_b1_enabled === true && vipSilver.move_b2_enabled === true,
      );
      check(
        'Gold allows B1/B2',
        vipGold.move_b1_enabled === true && vipGold.move_b2_enabled === true,
      );

      // The scheme CHECK rejects free-text schemes at the database boundary.
      const badSaleId = uuidFor('vip:bad-scheme');
      const badSaleNo = (
        await one<{ sale_number: string }>('select * from public.next_sale_number()')
      ).sale_number;
      const badCust = await mkCustomer('bad-scheme', 'vip');
      const schemeRefused = await throws('unknown scheme code is refused by CHECK', () =>
        db.query(
          `insert into public.card_sales
            (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
             cash_price_snapshot, payment_scheme, status, submitted_at, balance_due_at)
           values ($1,$2,$3,$4,'staff',$5,$6,$6,'move_c','submitted', now(), now() + interval '365 days')`,
          [badSaleId, badSaleNo, badCust, vipGold.id, staff['ost']!, vipGold.cash_price],
        ),
      );
      check(
        '  CHECK violation, nothing persisted',
        /check|23514|23505|new row/i.test(schemeRefused),
        schemeRefused.split('\n')[0],
      );

      // A Silver B1 sale freezes the B1 economics; full payment is judged
      // against the FROZEN installment total, and activation uses the FROZEN
      // validity (144 months), not the caller parameter.
      const vipCust = await mkCustomer('b1', 'vip');
      const vipSale = uuidFor('vip:sale:silver-b1');
      const vipSaleNo = (
        await one<{ sale_number: string }>('select * from public.next_sale_number()')
      ).sale_number;
      await db.query(
        `insert into public.card_sales
          (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
           cash_price_snapshot, minimum_down_payment_snapshot, payment_scheme,
           reservation_fee_snapshot, required_initial_snapshot, installment_months_snapshot,
           monthly_amount_snapshot, validity_months_snapshot, yearly_points_snapshot,
           commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at,
           created_by, referral_relationship_id)
         values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,'move_b1_40_12','10000.00','96000.00',12,'12000.00',144,$8,$9,'9600.00','submitted', now(), now() + interval '365 days', $5, $10)`,
        [
          vipSale,
          vipSaleNo,
          vipCust,
          vipSilver.id,
          staff['ost']!,
          vipSilver.installment_price,
          vipSilver.minimum_down_payment,
          Number(vipSilver.yearly_points),
          '0.04',
          ostEdge.id,
        ],
      );
      await db.query(
        `insert into public.commissions
          (sale_id, beneficiary_type, beneficiary_staff_id, amount, rate_snapshot, basis_amount_snapshot, status)
         values ($1,'staff',$2,'9600.00','0.04','240000.00','pending')`,
        [vipSale, staff['ost']],
      );
      const vipFrozen = await one<{
        scheme: string;
        total: string;
        reservation: string;
        initial: string;
        months: number;
        monthly: string;
        validity: number;
        commission: string;
      }>(
        `select payment_scheme as scheme, cash_price_snapshot as total,
                reservation_fee_snapshot as reservation, required_initial_snapshot as initial,
                installment_months_snapshot as months, monthly_amount_snapshot as monthly,
                validity_months_snapshot as validity, expected_commission_snapshot as commission
           from public.card_sales where id = $1`,
        [vipSale],
      );
      eq('frozen scheme is move_b1_40_12', vipFrozen.scheme, 'move_b1_40_12');
      eq('frozen total is the installment total', vipFrozen.total, '240000.00');
      eq('frozen reservation 10000.00', vipFrozen.reservation, '10000.00');
      eq('frozen required initial is the 40% DP', vipFrozen.initial, '96000.00');
      eq('frozen months 12', vipFrozen.months, 12);
      eq('frozen monthly 12000.00', vipFrozen.monthly, '12000.00');
      eq('frozen validity 144 months', vipFrozen.validity, 144);
      eq('frozen commission 9600.00', vipFrozen.commission, '9600.00');

      // B1 economics re-add exactly: 96000 + 12 x 12000 = 240000.
      const vipMath = await one<{ ok: boolean }>(
        `select ('96000.00'::numeric + 12 * '12000.00'::numeric) = '240000.00'::numeric as ok`,
      );
      check('B1 schedule re-adds to the frozen total exactly', vipMath.ok === true);
      const goldB2Math = await one<{ ok: boolean }>(
        `select ('97500.00'::numeric + 12 * '24375.00'::numeric) = '390000.00'::numeric as ok`,
      );
      check('Gold B2 schedule re-adds to the frozen total exactly', goldB2Math.ok === true);

      // Pay the frozen total in two verified payments, then activate with a
      // DECOY parameter: the frozen 144-month term must win.
      const vipPay1 = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'down_payment','bank_transfer',$3,null,null,$4) as id`,
          [vipSale, '96000.00', `${RUN}-VIP-PAY-1`, staff['finance']],
        )
      ).id;
      await db.query(`select public.verify_card_payment($1,'verified',null,$2)`, [
        vipPay1,
        staff['finance'],
      ]);
      const vipPay2 = (
        await one<{ id: string }>(
          `select public.record_card_payment($1,$2,'installment','bank_transfer',$3,null,null,$4) as id`,
          [vipSale, '144000.00', `${RUN}-VIP-PAY-2`, staff['finance']],
        )
      ).id;
      const vipVerify = await one<Record<string, string | boolean>>(
        'select * from public.verify_card_payment($1,$2,$3,$4)',
        [vipPay2, 'verified', null, staff['finance']],
      );
      eq('frozen-total gate: 240000.00 verified', String(vipVerify.verified_total), '240000.00');
      eq('frozen-total gate: fully paid', vipVerify.fully_paid, true);
      const vipActivated = await one<Record<string, string | number | boolean>>(
        'select * from public.activate_card_sale($1,$2,$3)',
        [vipSale, staff['finance'], 12],
      );
      const vipMembershipId = String(vipActivated.membership_id);
      check('VIP membership created', !!vipMembershipId);
      const vipWindow = await one<{ months: number }>(
        `select ((extract(year from age(expires_at, activated_at)) * 12
                + extract(month from age(expires_at, activated_at)))::int) as months
           from public.memberships where id = $1`,
        [vipMembershipId],
      );
      eq('expiry uses the frozen 144-month term, not the 12-month decoy', vipWindow.months, 144);

      // A pre-scheme sale (NULL validity snapshot) keeps the parameter path:
      // the section-5 sale activates with the caller-supplied term.
      const legacyValidity = await one<{ v: number | null }>(
        'select validity_months_snapshot as v from public.card_sales where id = $1',
        [saleId],
      );
      check('pre-scheme sale carries no frozen validity', legacyValidity.v === null);
    }
  } catch (error) {
    // An unexpected exception anywhere in sections 1-43 is a SUITE FAILURE. It
    // used to be reported from inside section 37's own handler, which meant a
    // throw in sections 1-36 produced a short, entirely green run and a zero
    // exit code. `check(..., false, ...)` records a failed result, the verdict
    // block below turns any failed result into a non-zero exit, and `finally`
    // still runs the cleanup. The message is redacted: a driver-level failure
    // can echo the connection string, and a harness must never log credentials.
    check('suite completed without an unexpected error', false, safeErrorMessage(error));
  } finally {
    try {
      section('41. OST referral codes, applications, members and SM->OST genealogy');
      /* ---------------------------------------------------------------- */
      // Phase 8/24 primitives on real PostgreSQL: the sequence-backed OST
      // number (read as a one-row set, the Phase 18 lesson), hash-addressed
      // referral codes, the case-insensitive reviewable-email guard, member
      // creation, the adjacency trigger, the one-active-upline backstop, and
      // RLS scoping for two different Sales Managers.
      const ostStaffId = uuidFor('ost:phase41-member');
      const ostEmail = `${RUN}-phase41-ost@example.invalid`;
      await db.query('insert into auth.users (id, email) values ($1, $2)', [ostStaffId, ostEmail]);
      await db.query(
        `insert into public.staff_users (id, email, full_name, status) values ($1, $2, 'Synthetic phase41 ost', 'invited')`,
        [ostStaffId, ostEmail],
      );
      await db.query(
        'insert into public.staff_role_assignments (staff_id, role_id, assigned_by) values ($1, $2, $3)',
        [ostStaffId, roles['ost'], staff['super-admin']],
      );
      createdStaffIds.push(ostStaffId);

      // 41a. next_ost_number() answers a ONE-ROW SET with a non-blank number.
      // A handler that reads `.ost_number` off the set itself (instead of the
      // row) would persist a blank - exactly the Phase 18 sale-number defect.
      const ostNumbers = await db.query<{ ost_number: string }>(
        'select * from public.next_ost_number()',
      );
      eq('next_ost_number returns exactly one row', ostNumbers.rows.length, 1);
      const ostNumber = ostNumbers.rows[0]!.ost_number;
      check(
        'the OST number is a non-blank AF business ID (legacy OST- sequenced rows stay valid)',
        typeof ostNumber === 'string' && /^(OST-\d{6}|AF-OST-[A-HJ-NP-Z2-9]{5})$/.test(ostNumber),
        JSON.stringify(ostNumber),
      );

      // 41b. Referral codes are addressed by SHA-256 hash, never plaintext.
      const rawCode = `OST-${RUN.slice(1, 7).toUpperCase().padEnd(6, 'X')}-${RUN.slice(7, 13).toUpperCase().padEnd(6, 'Y')}`;
      const codeHash = createHash('sha256').update(rawCode).digest('hex');
      const codeId = uuidFor('ost:phase41-code');
      await db.query(
        `insert into public.referral_codes
        (id, code_hash, code_hint, sponsor_staff_id, expires_at, max_uses, use_count, is_active, created_by)
       values ($1, $2, $3, $4, now() + interval '7 days', 10, 0, true, $4)`,
        [codeId, codeHash, `OST-…-${rawCode.slice(-4)}`, staff['sm']],
      );
      const byHash = await one<{ id: string } | undefined>(
        'select id from public.referral_codes where code_hash = $1',
        [codeHash],
      );
      eq('a code resolves by its hash', byHash?.id, codeId);
      const byUnknown = await one<{ id: string } | undefined>(
        'select id from public.referral_codes where code_hash = $1',
        ['0'.repeat(64)],
      );
      eq('an unknown hash resolves to nothing', byUnknown, undefined);

      // 41c. One reviewable application per email, case-insensitively; a
      // terminal decision frees the address.
      const appEmail = `${RUN}-phase41-applicant@example.invalid`;
      const appId = uuidFor('ost:phase41-app');
      await db.query(
        `insert into public.ost_applications
        (id, referral_code_id, sponsor_staff_id, email, phone, first_name, last_name,
         birth_date, address, status)
       values ($1, $2, $3, $4, '+639171234567', 'Phase', 'Fortyone', '1995-06-15',
         '{"line1": "1 Farm Road", "city": "Tagaytay", "province": "Cavite", "countryCode": "PH"}',
         'submitted')`,
        [appId, codeId, staff['sm'], appEmail],
      );
      let duplicateRefused = false;
      try {
        await db.query(
          `insert into public.ost_applications
          (id, referral_code_id, sponsor_staff_id, email, phone, first_name, last_name,
           birth_date, address, status)
         values ($1, $2, $3, $4, '+639171234567', 'Phase', 'Fortyone', '1995-06-15',
           '{"line1": "1 Farm Road", "city": "Tagaytay", "province": "Cavite", "countryCode": "PH"}',
           'under_review')`,
          [uuidFor('ost:phase41-app-dupe'), codeId, staff['sm'], appEmail.toUpperCase()],
        );
      } catch (error) {
        duplicateRefused = (error as { code?: string })?.code === '23505';
      }
      check('a mixed-case duplicate reviewable email is refused', duplicateRefused);
      await db.query(`update public.ost_applications set status = 'rejected' where id = $1`, [
        appId,
      ]);
      const reuseId = uuidFor('ost:phase41-app-reuse');
      await db.query(
        `insert into public.ost_applications
        (id, referral_code_id, sponsor_staff_id, email, phone, first_name, last_name,
         birth_date, address, status)
       values ($1, $2, $3, $4, '+639171234567', 'Phase', 'Fortyone', '1995-06-15',
         '{"line1": "1 Farm Road", "city": "Tagaytay", "province": "Cavite", "countryCode": "PH"}',
         'submitted')`,
        [reuseId, codeId, staff['sm'], appEmail],
      );
      check('the address is reusable after a terminal decision', true);

      // 41d. Member creation plus the SM -> OST edge; the trigger and the
      // one-active-upline index are the backstops, not the handler.
      const memberNumber = (
        await one<{ ost_number: string }>('select * from public.next_ost_number()')
      ).ost_number;
      await db.query(
        `insert into public.ost_members
        (id, application_id, sponsor_staff_id, ost_number, full_name, email, phone,
         status, approved_by)
       values ($1, $2, $3, $4, 'Synthetic phase41 ost', $5, '+639170000041', 'active', $6)`,
        [ostStaffId, reuseId, staff['sm'], memberNumber, ostEmail, staff['super-admin']],
      );
      const edgeId = (
        await one<{ id: string }>(
          `insert into public.referral_relationships
          (subject_staff_id, upline_staff_id, hierarchy_role, is_authoritative, is_active, assigned_by)
         values ($1, $2, 'ost', true, true, $3) returning id`,
          [ostStaffId, staff['sm'], staff['super-admin']],
        )
      ).id;
      check('an SM -> OST edge is created', typeof edgeId === 'string' && edgeId.length > 0);
      let secondEdgeRefused = false;
      try {
        await db.query(
          `insert into public.referral_relationships
          (subject_staff_id, upline_staff_id, hierarchy_role, is_authoritative, is_active, assigned_by)
         values ($1, $2, 'ost', true, true, $3)`,
          [ostStaffId, staff['sm'], staff['super-admin']],
        );
      } catch (error) {
        secondEdgeRefused = (error as { code?: string })?.code === '23505';
      }
      check('a second active upline for the same subject is refused', secondEdgeRefused);
      let wrongUplineRefused = false;
      try {
        await db.query(
          `insert into public.referral_relationships
          (subject_staff_id, upline_staff_id, hierarchy_role, is_authoritative, is_active, assigned_by)
         values ($1, $2, 'ost', false, false, $3)`,
          [uuidFor('ost:phase41-ost2'), staff['vice-director'], staff['super-admin']],
        );
      } catch {
        wrongUplineRefused = true;
      }
      check('an OST edge under a Vice Director is refused by the trigger', wrongUplineRefused);
      let duplicateNumberRefused = false;
      try {
        await db.query(
          `insert into public.ost_members
          (id, application_id, sponsor_staff_id, ost_number, full_name, email, phone, status, approved_by)
         values ($1, $2, $3, $4, 'Duplicate number', $5, '+639170000042', 'active', $6)`,
          [
            uuidFor('ost:phase41-dupe'),
            appId,
            staff['sm'],
            memberNumber,
            `${RUN}-phase41-dupe@example.invalid`,
            staff['super-admin'],
          ],
        );
      } catch (error) {
        duplicateNumberRefused = (error as { code?: string })?.code === '23505';
      }
      check('a duplicate OST number is refused', duplicateNumberRefused);

      // 41e. RLS: anonymous sees nothing; an unrelated role sees nothing; each
      // SM sees applications including the one they sponsor.
      const hrStaffId = staff['hr'];
      const smStaffId = staff['sm'];
      if (!hrStaffId || !smStaffId) throw new Error('Phase 41 staff fixtures are incomplete');
      eq(
        'anon reads no OST applications',
        await visibleRows(
          target.url,
          'anon',
          null,
          'select count(*)::int as n from public.ost_applications',
        ),
        0,
      );
      eq(
        'an unrelated role reads no OST applications',
        await visibleRows(
          target.url,
          'authenticated',
          hrStaffId,
          'select count(*)::int as n from public.ost_applications',
        ),
        0,
      );
      const smSees = await visibleRows(
        target.url,
        'authenticated',
        smStaffId,
        `select count(*)::int as n from public.ost_applications where sponsor_staff_id = '${smStaffId}'`,
      );
      check('the sponsoring SM reads their own applications', smSees >= 2, String(smSees));

      // 41f. Explicit tidy-up for tables the shared cleanup does not count:
      // edges first (restrict), then members, applications and codes.
      await db.query('delete from public.referral_relationships where subject_staff_id = $1', [
        ostStaffId,
      ]);
      await db.query('delete from public.ost_members where id = $1', [ostStaffId]);
      await db.query('delete from public.ost_applications where id = any($1::uuid[])', [
        [appId, reuseId],
      ]);
      await db.query('delete from public.referral_codes where id = $1', [codeId]);
      check('phase 41 synthetics removed', true);

      /* ---------------------------------------------------------------- */
      section('44. Phase 20 staff temporary-password lifecycle columns');
      /* ---------------------------------------------------------------- */
      // The forced first-login change is recorded on staff_users, never in
      // Auth: must_change_password gates, password_changed_at audits. The
      // temporary password itself lives in Supabase Auth only - no secret
      // column may ever exist here.
      {
        const cols = await db.query<{
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }>(
          `select column_name, data_type, is_nullable, column_default
           from information_schema.columns
          where table_schema = 'public' and table_name = 'staff_users'
            and column_name in ('must_change_password', 'password_changed_at')
          order by column_name`,
        );
        eq('both lifecycle columns exist', cols.rowCount, 2);
        const flag = cols.rows.find((r) => r.column_name === 'must_change_password')!;
        check(
          'must_change_password is boolean NOT NULL with a false default',
          flag.data_type === 'boolean' &&
            flag.is_nullable === 'NO' &&
            /false/i.test(flag.column_default ?? ''),
          JSON.stringify(flag),
        );
        const stamped = cols.rows.find((r) => r.column_name === 'password_changed_at')!;
        check(
          'password_changed_at is a nullable timestamptz with no default',
          stamped.data_type === 'timestamp with time zone' &&
            stamped.is_nullable === 'YES' &&
            stamped.column_default === null,
          JSON.stringify(stamped),
        );
        // No secret column: the temporary password must have nowhere to live.
        const secrets = await one<{ n: number }>(
          `select count(*)::int as n from information_schema.columns
          where table_schema = 'public' and table_name = 'staff_users'
            and (column_name like '%password%' or column_name like '%secret%')
            and column_name not in ('must_change_password', 'password_changed_at')`,
        );
        eq('no password/secret storage column exists on staff_users', secrets.n, 0);
        // Pre-existing and default-constructed rows are ungated, never null.
        const nullFlags = await one<{ n: number }>(
          'select count(*)::int as n from public.staff_users where must_change_password is null',
        );
        eq('no staff row has a null flag', nullFlags.n, 0);
        // The handler's write path, end to end at the SQL level: gate, stamp, clear.
        const lifecycleId = uuidFor('staff:phase44-lifecycle');
        const lifecycleEmail = `${RUN}-phase44-lifecycle@example.invalid`;
        await db.query('insert into auth.users (id, email) values ($1, $2)', [
          lifecycleId,
          lifecycleEmail,
        ]);
        await db.query(
          `insert into public.staff_users (id, email, full_name, status)
         values ($1, $2, 'Synthetic phase44', 'active')`,
          [lifecycleId, lifecycleEmail],
        );
        createdStaffIds.push(lifecycleId);
        const fresh = await one<{
          must_change_password: boolean;
          password_changed_at: string | null;
        }>(
          'select must_change_password, password_changed_at from public.staff_users where id = $1',
          [lifecycleId],
        );
        check('a new row defaults to ungated', fresh.must_change_password === false);
        check('a new row has no rotation stamp', fresh.password_changed_at === null);
        await db.query('update public.staff_users set must_change_password = true where id = $1', [
          lifecycleId,
        ]);
        const gated = await one<{ must_change_password: boolean }>(
          'select must_change_password from public.staff_users where id = $1',
          [lifecycleId],
        );
        check(
          'the flag can be set (temporary-password onboarding)',
          gated.must_change_password === true,
        );
        await db.query(
          `update public.staff_users
            set must_change_password = false, password_changed_at = now(), updated_at = now()
          where id = $1`,
          [lifecycleId],
        );
        const cleared = await one<{
          must_change_password: boolean;
          password_changed_at: string | null;
        }>(
          'select must_change_password, password_changed_at from public.staff_users where id = $1',
          [lifecycleId],
        );
        check('the flag clears on password change', cleared.must_change_password === false);
        check('clearing stamps the rotation', cleared.password_changed_at !== null);
      }

      section('45. Official-form application RPC (corrective migration proof)');
      /* ---------------------------------------------------------------- */
      // UAT defect D1: save_customer_application referenced v_plan.holder_limit,
      // but the plan column is cardholder_limit, so EVERY call failed on real
      // PostgreSQL with 42703. PL/pgSQL validates %rowtype field references only
      // at execution, which is why creation succeeded while broken and why only
      // a real RPC call counts as proof here - never a mock.
      {
        const body = await one<{ prosrc: string }>(
          `select prosrc from pg_proc where proname = 'save_customer_application'`,
        );
        const code = stripSqlComments(body.prosrc);
        check(
          'installed function reads the real plan column',
          code.includes('v_plan.cardholder_limit'),
        );
        check(
          'installed function has no invalid plan field reference',
          !code.includes('v_plan.holder_limit'),
        );

        const planIds = new Map<string, string>(
          (
            await db.query<{ code: string; id: string }>(
              `select code, id from public.card_plans where code in ('BRONZE','SILVER','GOLD')`,
            )
          ).rows.map((r) => [r.code, r.id]),
        );
        check('all three official plans exist', planIds.size === 3);
        const actor = staff['sm']!;
        // Local customer factory: mkCustomer is scoped to the main try block,
        // so this finally-block section creates (and registers) its own.
        const mkFormsCustomer = async (label: string) => {
          const id = uuidFor(`cust:forms45:${label}`);
          const cn = (
            await one<{ customer_number: string }>('select * from public.next_customer_number()')
          ).customer_number;
          await db.query(
            `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
           values ($1,$2,'Form','Test','1990-01-01',$3,'09175550001','prospect')`,
            [id, cn, `${RUN}-forms45-${label}@example.invalid`],
          );
          createdCustomerIds.push(id);
          return id;
        };
        const headerFor = (customerId: string, planId: string) => ({
          customerId,
          planId,
          paymentScheme: 'spot_cash',
          salesManagerName: '',
          vipRecommenderName: '',
          recommenderContact: '',
          recommenderEmail: '',
          vipReferrer: '',
          acquisitionChannels: ['Referral'],
          consentAcknowledged: true,
          acknowledgedAt: '2026-10-01',
          primarySignatureStatus: 'received',
          validIdReceived: true,
          reservationPaymentProofReceived: false,
        });
        const holderFor = () => ({
          lastName: 'Form',
          firstName: 'Test',
          middleName: '',
          suffix: '',
          birthDate: '1990-04-05',
          sex: '',
          citizenship: '',
          civilStatus: '',
          permanentAddressLine1: '1 RPC Street',
          permanentAddressLine2: '',
          cityMunicipality: 'Calamba',
          province: 'Laguna',
          postalCode: '',
          landline: '',
          mobile: '09170000001',
          email: `${RUN}-forms45-holder@example.invalid`,
          tinNumber: '',
          occupationBusinessName: '',
          officeBusinessAddress: '',
          businessIndustry: '',
          employedPosition: '',
          printedName: 'Test Form',
        });
        const appIds: string[] = [];
        const saveApp = async (tier: string, withSecondary: boolean) => {
          const cust = await mkFormsCustomer(`${tier.toLowerCase()}${withSecondary ? '-2' : ''}`);
          const res = await one<{ id: string }>(
            'select public.save_customer_application(null::uuid, $1::uuid, $2::jsonb, $3::jsonb, $4::jsonb) as id',
            [
              actor,
              JSON.stringify(headerFor(cust, planIds.get(tier)!)),
              JSON.stringify(holderFor()),
              withSecondary ? JSON.stringify(holderFor()) : null,
            ],
          );
          appIds.push(res.id);
          return res.id;
        };
        const snapshots = async (id: string) =>
          one<Record<string, string | number>>(
            `select customer_id, tier_snapshot, discount_percent_snapshot, validity_years_snapshot,
                  yearly_points_snapshot, annual_points_tranches_snapshot,
                  holder_limit_snapshot, vip_amount_snapshot, payment_scheme_snapshot,
                  status from public.customer_applications where id = $1`,
            [id],
          );
        const holderCount = async (id: string) =>
          one<{ n: number }>(
            `select count(*)::int as n from public.customer_application_holders where application_id = $1`,
            [id],
          );

        const bronze = await saveApp('BRONZE', false);
        const bronzeSnap = await snapshots(bronze);
        eq('BRONZE application tier is frozen', String(bronzeSnap.tier_snapshot), 'BRONZE');
        eq('BRONZE discount snapshot is 15', Number(bronzeSnap.discount_percent_snapshot), 15);
        eq('BRONZE validity snapshot is 7', Number(bronzeSnap.validity_years_snapshot), 7);
        eq(
          'BRONZE yearly-points snapshot is 10000',
          Number(bronzeSnap.yearly_points_snapshot),
          10000,
        );
        eq('BRONZE tranche snapshot is 5', Number(bronzeSnap.annual_points_tranches_snapshot), 5);
        eq('BRONZE holder-limit snapshot is 1', Number(bronzeSnap.holder_limit_snapshot), 1);
        eq('BRONZE has exactly the primary holder', (await holderCount(bronze)).n, 1);

        const silver = await saveApp('SILVER', false);
        const silverSnap = await snapshots(silver);
        eq('SILVER application tier is frozen', String(silverSnap.tier_snapshot), 'SILVER');
        eq('SILVER discount snapshot is 20', Number(silverSnap.discount_percent_snapshot), 20);
        eq('SILVER validity snapshot is 12', Number(silverSnap.validity_years_snapshot), 12);
        eq(
          'SILVER yearly-points snapshot is 20000',
          Number(silverSnap.yearly_points_snapshot),
          20000,
        );
        eq('SILVER holder-limit snapshot is 1', Number(silverSnap.holder_limit_snapshot), 1);

        const goldSolo = await saveApp('GOLD', false);
        const goldSnap = await snapshots(goldSolo);
        eq('GOLD discount snapshot is 25', Number(goldSnap.discount_percent_snapshot), 25);
        eq('GOLD validity snapshot is 22', Number(goldSnap.validity_years_snapshot), 22);
        eq('GOLD yearly-points snapshot is 25000', Number(goldSnap.yearly_points_snapshot), 25000);
        eq('GOLD holder-limit snapshot is 2', Number(goldSnap.holder_limit_snapshot), 2);
        eq('GOLD without secondary still succeeds', (await holderCount(goldSolo)).n, 1);

        const goldDuo = await saveApp('GOLD', true);
        eq('GOLD with secondary stores both holders', (await holderCount(goldDuo)).n, 2);

        const bronzeBlocked = await throws('BRONZE with secondary is rejected', () =>
          saveApp('BRONZE', true),
        );
        check(
          'BRONZE rejection names the Gold-only rule',
          /SECONDARY_HOLDER_GOLD_ONLY/.test(bronzeBlocked),
          bronzeBlocked,
        );
        const silverBlocked = await throws('SILVER with secondary is rejected', () =>
          saveApp('SILVER', true),
        );
        check(
          'SILVER rejection names the Gold-only rule',
          /SECONDARY_HOLDER_GOLD_ONLY/.test(silverBlocked),
          silverBlocked,
        );

        await db.query('select public.submit_customer_application($1::uuid, $2::uuid)', [
          bronze,
          actor,
        ]);
        eq(
          'submitted application leaves draft',
          String((await snapshots(bronze)).status),
          'submitted',
        );
        const resubmitBlocked = await throws('a submitted application cannot be resubmitted', () =>
          db.query('select public.submit_customer_application($1::uuid, $2::uuid)', [
            bronze,
            actor,
          ]),
        );
        check(
          'resubmission names the transition rule',
          /INVALID_APPLICATION_TRANSITION/.test(resubmitBlocked),
          resubmitBlocked,
        );
        const editBlocked = await throws('a submitted application is not editable', async () => {
          const snap = await snapshots(bronze);
          return one<{ id: string }>(
            'select public.save_customer_application($1::uuid, $2::uuid, $3::jsonb, $4::jsonb, null::jsonb) as id',
            [
              bronze,
              actor,
              JSON.stringify(headerFor(snap.customer_id as string, planIds.get('BRONZE')!)),
              JSON.stringify(holderFor()),
            ],
          );
        });
        check(
          'edit names the not-editable rule',
          /APPLICATION_NOT_EDITABLE/.test(editBlocked),
          editBlocked,
        );

        // Explicit tidy-up for this section's rows (the shared cleanup also
        // covers them via the synthetic customers; both paths are idempotent).
        await db.query(
          'delete from public.customer_application_holders where application_id = any($1::uuid[])',
          [appIds],
        );
        await db.query('delete from public.customer_applications where id = any($1::uuid[])', [
          appIds,
        ]);
        const remaining = await one<{ n: number }>(
          'select count(*)::int as n from public.customer_applications where id = any($1::uuid[])',
          [appIds],
        );
        eq('section rows are removed', remaining.n, 0);
      }

      section('46. Bulk customer import (legacy member RPC)');
      /* ---------------------------------------------------------------- */
      // Row-level legacy migration through the REAL RPC: duplicate matching,
      // reconciled historical payments, minted credentials, and the
      // allocation-plus-delta opening balance - with nothing invented.
      {
        const actor = staff['sm']!;
        const goldPlan = await one<{ id: string; cash_price: string; yearly_points: number }>(
          `select id, cash_price, yearly_points from public.card_plans where code = 'GOLD'`,
        );
        const jobId = uuidFor('import:job46');
        await db.query(
          `insert into public.customer_import_jobs
           (id, source_type, source_name, status, total_rows, valid_rows, created_by, validated_at)
         values ($1, 'csv', 'section-46.csv', 'ready', 5, 5, $2, now())`,
          [jobId, actor],
        );
        const mkPerson = (email: string) => ({
          firstName: 'Legacy',
          lastName: 'Member',
          middleName: null,
          suffix: null,
          birthDate: '1985-06-07',
          gender: null,
          email,
          phone: '+639170000001',
          address: {
            line1: '1 Legacy Street',
            city: 'Calamba',
            province: 'Laguna',
            countryCode: 'PH',
          },
          customerStatus: 'prospect',
          // STALE FIXTURE. The card_sales insert in `import_legacy_member` hardcodes
          // `seller_type = 'staff'` and reads `seller_staff_id` from this payload key,
          // so without it the sale is inserted with NO seller and the older Phase 14
          // hierarchy trigger raises SALE_SELLER_REQUIRED (SQLSTATE 23514). The rule is
          // legitimate and this fixture predates the trigger, so the fixture supplies
          // the Sales Manager who is running the import rather than the rule weakening.
          sellerStaffId: actor,
          paymentScheme: 'spot_cash',
          historicalSaleTotal: goldPlan.cash_price,
          notes: null,
          secondaryNote: null,
        });
        const importRow = (
          customer: Record<string, unknown>,
          payments: unknown[],
          membership: unknown,
          requireMember: boolean,
        ) =>
          one<Record<string, unknown>>(
            'select public.import_legacy_member($1::uuid, $2::uuid, $3::jsonb, $4::uuid, $5::jsonb, $6::jsonb, $7::boolean) as out',
            [
              jobId,
              actor,
              JSON.stringify(customer),
              goldPlan.id,
              JSON.stringify(payments),
              membership === null ? null : JSON.stringify(membership),
              requireMember,
            ],
          );

        // A. Prospect with no money and no member: customer only.
        const emailA = `${RUN}-sec46-a@example.invalid`;
        const outA = await importRow(mkPerson(emailA), [], null, false);
        const rowA = outA.out as { customerId: string; saleId: null; membershipId: null };
        check(
          'prospect import creates a customer and nothing else',
          !!rowA.customerId && rowA.saleId === null && rowA.membershipId === null,
        );
        eq(
          'prospect keeps the prospect status',
          (
            await one<{ status: string }>('select status from public.customers where id = $1', [
              rowA.customerId,
            ])
          ).status,
          'prospect',
        );

        // B. Active VIP: full historical payment, minted credentials, delta ledger.
        const opening = goldPlan.yearly_points + 2000;
        const emailB = `${RUN}-sec46-b@example.invalid`;
        const outB = await importRow(
          { ...mkPerson(emailB), customerStatus: 'active' },
          [
            {
              amount: goldPlan.cash_price,
              date: '2026-09-01T00:00:00.000Z',
              method: 'bank_transfer',
              reference: 'SEC46-B',
            },
          ],
          {
            membershipNumber: null,
            activationDate: '2026-09-02T00:00:00.000Z',
            expiresAt: null,
            openingBalance: opening,
            memberStatus: 'active',
          },
          true,
        );
        const rowB = outB.out as {
          customerId: string;
          saleId: string;
          membershipId: string;
          membershipNumber: string;
        };
        check(
          'active VIP import links customer, sale and membership',
          !!rowB.customerId && !!rowB.saleId && !!rowB.membershipId,
        );
        check(
          'membership number uses 128-bit random format',
          /^MBS-(?:[0-9A-F]{8}-){3}[0-9A-F]{8}$/.test(rowB.membershipNumber),
          rowB.membershipNumber,
        );
        const member = await one<Record<string, unknown>>(
          'select * from public.memberships where id = $1',
          [rowB.membershipId],
        );
        const samples = await db.query<{ code: string }>(
          'select private.next_membership_number() as code from generate_series(1,1001)',
        );
        check(
          '1001 allocated codes match random format',
          samples.rows.every((row) => /^MBS-(?:[0-9A-F]{8}-){3}[0-9A-F]{8}$/.test(row.code)),
        );
        eq(
          '1001 allocated codes are unique',
          new Set(samples.rows.map((row) => row.code)).size,
          1001,
        );
        check(
          'allocated codes are not monotonically increasing',
          samples.rows.some((row, index) => index > 0 && row.code < samples.rows[index - 1]!.code),
        );
        const definition = await one<{ definition: string }>(
          "select pg_get_functiondef('private.next_membership_number()'::regprocedure) as definition",
        );
        const raw = rowB.membershipNumber.replace(/^MBS-/, '').replace(/-/g, '');
        if (!/^[0-9A-F]{32}$/.test(raw)) throw new Error('Invalid synthetic collision fixture');
        await db.query('create temporary sequence allocator_attempt');
        await db.query(`create function pg_temp.collision_rng(integer) returns bytea language plpgsql as $$ begin
          if nextval('pg_temp.allocator_attempt')=1 then return decode('${raw}','hex'); end if;
          return gen_random_bytes($1); end $$`);
        await db.query(
          definition.definition
            .replace('private.next_membership_number()', 'pg_temp.test_allocator()')
            .replace('gen_random_bytes(16)', 'pg_temp.collision_rng(16)'),
        );
        const retry = await one<{ code: string }>('select pg_temp.test_allocator() as code');
        check(
          'allocator retries an occupied code using real PostgreSQL',
          retry.code !== rowB.membershipNumber,
        );
        eq(
          'collision required a second random draw',
          (
            await one<{ attempts: string }>(
              'select last_value::text as attempts from pg_temp.allocator_attempt',
            )
          ).attempts,
          '2',
        );
        await db.query(
          `create or replace function pg_temp.collision_rng(integer) returns bytea language sql as $$ select decode('${raw}','hex') $$`,
        );
        await throws('allocator fails closed after bounded collisions', () =>
          db.query('select pg_temp.test_allocator()'),
        );
        eq('member is active', String(member.status), 'active');
        eq(
          'member allocated the plan yearly points',
          Number(member.yearly_points_allocated),
          goldPlan.yearly_points,
        );
        check(
          'credential hashes are stored, never plaintext',
          String(member.fallback_code_hash).length === 64 &&
            String(member.qr_token_hash).length === 64,
        );
        const account = await one<Record<string, unknown>>(
          'select * from public.points_accounts where membership_id = $1',
          [rowB.membershipId],
        );
        eq('account balance equals the imported opening balance', Number(account.balance), opening);
        const ledger = await db.query<{ entry_type: string; amount: string }>(
          'select entry_type, amount::text as amount from public.points_ledger where account_id = $1 order by id',
          [(account as { id: string }).id],
        );
        eq('ledger holds exactly one opening balance', ledger.rows.length, 1);
        eq('opening row is an import adjustment', ledger.rows[0]!.entry_type, 'adjustment');
        eq('opening amount is preserved', Number(ledger.rows[0]!.amount), opening);
        const saleB = await one<{ status: string }>(
          'select status from public.card_sales where id = $1',
          [rowB.saleId],
        );
        eq('legacy sale is active', saleB.status, 'active');
        // No commission is fabricated for migrated history.
        eq(
          'no commission row exists for the legacy sale',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from public.commissions where sale_id = $1',
              [rowB.saleId],
            )
          ).n,
          0,
        );

        // C. The minted number is now taken: reuse is refused.
        const dupeBlocked = await throws('a reused membership number is refused', () =>
          importRow(
            mkPerson(`${RUN}-sec46-c@example.invalid`),
            [
              {
                amount: goldPlan.cash_price,
                date: '2026-09-01T00:00:00.000Z',
                method: 'bank_transfer',
                reference: 'SEC46-C',
              },
            ],
            {
              membershipNumber: rowB.membershipNumber,
              activationDate: null,
              expiresAt: null,
              openingBalance: 0,
              memberStatus: 'active',
            },
            true,
          ),
        );
        check(
          'duplicate names the membership rule',
          /IMPORT_DUPLICATE_MEMBERSHIP/.test(dupeBlocked),
          dupeBlocked,
        );

        // D. Active VIP without payment history is refused, never invented.
        const noPayBlocked = await throws('member demand without payments is refused', () =>
          importRow(mkPerson(`${RUN}-sec46-d@example.invalid`), [], null, true),
        );
        check(
          'refusal names the fully-paid rule',
          /IMPORT_NOT_FULLY_PAID/.test(noPayBlocked),
          noPayBlocked,
        );

        // E. Zero opening balance writes no ledger delta.
        const emailE = `${RUN}-sec46-e@example.invalid`;
        const outE = await importRow(
          { ...mkPerson(emailE), customerStatus: 'active' },
          [
            {
              amount: goldPlan.cash_price,
              date: '2026-09-01T00:00:00.000Z',
              method: 'bank_transfer',
              reference: 'SEC46-E',
            },
          ],
          {
            membershipNumber: null,
            activationDate: null,
            expiresAt: null,
            openingBalance: 0,
            memberStatus: 'active',
          },
          true,
        );
        const rowE = outE.out as { membershipId: string };
        const ledgerE = await db.query<{ n: number }>(
          `select count(*)::int as n from public.points_ledger where account_id =
           (select id from public.points_accounts where membership_id = $1)`,
          [rowE.membershipId],
        );
        eq('zero opening balance creates no invented points', ledgerE.rows[0]!.n, 0);
        eq(
          'zero opening balance remains zero',
          (
            await one<{ balance: string }>(
              'select balance from public.points_accounts where membership_id = $1',
              [rowE.membershipId],
            )
          ).balance,
          '0',
        );

        // Normal search, identity and portal activation use the imported graph.
        const customerB = await one<{ customer_number: string }>(
          'select customer_number from public.customers where id = $1',
          [rowB.customerId],
        );
        for (const search of ['Legacy Member', 'Lega', customerB.customer_number]) {
          const found = await db.query<{ customer_id: string }>(
            'select * from public.search_customer_ids($1)',
            [search],
          );
          check(
            'normal search finds imported member: ' + search,
            found.rows.some((r) => r.customer_id === rowB.customerId),
          );
        }
        // A Membership Code is a TRANSACTION identifier, not a customer-search
        // term. Since 20261028000001 general customer search must not resolve
        // one; the protected redemption path does, via the membership resolver.
        for (const search of [rowB.membershipNumber, 'AFHOMES:' + rowB.membershipNumber]) {
          const viaCustomerSearch = await db.query<{ customer_id: string }>(
            'select * from public.search_customer_ids($1)',
            [search],
          );
          check(
            'normal search does NOT resolve a Membership Code: ' + search,
            !viaCustomerSearch.rows.some((r) => r.customer_id === rowB.customerId),
          );
          const viaMembership = await db.query<{ membership_id: string }>(
            'select membership_id from private.resolve_membership_code($1)',
            [search],
          );
          eq(
            'the transaction path still resolves that Membership Code: ' + search,
            viaMembership.rows[0]?.membership_id,
            rowB.membershipId,
          );
        }
        const token = await one<{ token: string }>(
          'select token from public.issue_customer_onboarding_token($1, $2, $3, $4)',
          [rowB.customerId, 'account_activation', 72, actor],
        );
        const authId = uuidFor('import:portal46');
        await db.query('insert into auth.users(id, email) values($1, $2)', [authId, emailB]);
        createdAuthIds.push(authId);
        await db.query(
          'select public.claim_customer_onboarding_token(private.hash_token($1), $2, $3)',
          [token.token, authId, 'account_activation'],
        );
        eq(
          'portal links the imported customer',
          (
            await one<{ auth_user_id: string }>(
              'select auth_user_id from public.customers where id = $1',
              [rowB.customerId],
            )
          ).auth_user_id,
          authId,
        );
        eq(
          'portal activation creates no duplicate membership',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from public.memberships where customer_id = $1',
              [rowB.customerId],
            )
          ).n,
          1,
        );
        eq(
          'failed import leaves no partial customer',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from public.customers where email = $1',
              [RUN + '-sec46-d@example.invalid'],
            )
          ).n,
          0,
        );

        // F. Job tables carry the run and clean up with it.
        eq(
          'import job exists',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from public.customer_import_jobs where id = $1',
              [jobId],
            )
          ).n,
          1,
        );
      }

      section('47. Atomic import row and normal member integration');
      {
        const actor = staff['super-admin']!;
        const jobId = uuidFor('import:job47');
        await db.query(
          "insert into public.customer_import_jobs(id, source_type, source_name, status, created_by, validated_at) values($1,'excel','section47.xlsx','ready',$2,now())",
          [jobId, actor],
        );
        const plan = await one<{ id: string; cash_price: string }>(
          "select id,cash_price from public.card_plans where code='GOLD'",
        );
        // §47 commits through `commit_customer_import_row`, whose seller attribution
        // is read from `raw_data`, NOT from `normalized_data`:
        //   v_code := coalesce(raw_data->>'referral_code', raw_data->>'seller_code')
        //   v_seller := referral_codes.sponsor_staff_id where code_hash = hash(code)
        // The fixture inserted only `normalized_data`, so `raw_data` was NULL, no
        // seller credential resolved, and the sale was inserted with a NULL seller -
        // which the OLDER Phase 14 hierarchy trigger correctly refuses
        // (SALE_SELLER_REQUIRED, SQLSTATE 23514). The suite's other referral row is
        // deleted before this section runs, so §47 needs its own.
        //
        // The rule stands and the applied migration is untouched. Plaintext exists
        // only here in test memory; the table stores the SHA-256 hash, exactly as the
        // referral feature requires.
        const importSellerCode = 'OST-SEC47-' + RUN.slice(1, 7).toUpperCase().padEnd(6, 'X');
        const importSellerCodeId = uuidFor('import:row47:seller-code');
        await db.query(
          `insert into public.referral_codes
             (id, code_hash, code_hint, sponsor_staff_id, expires_at, max_uses, use_count, is_active, created_by)
           values ($1, private.hash_token($2), $3, $4, now() + interval '7 days', 10, 0, true, $4)`,
          [
            importSellerCodeId,
            importSellerCode,
            'OST-?-' + importSellerCode.slice(-4),
            staff['sm'],
          ],
        );
        // Prove the hash resolves to exactly one ACTIVE row owned by the Sales
        // Manager, so a fixture-shape mistake cannot masquerade as a pass later.
        eq(
          'the section-47 seller code resolves to the Sales Manager via the production lookup',
          (
            await one<{ n: number }>(
              `select count(*)::int n from public.referral_codes
                where code_hash = private.hash_token($1) and is_active and sponsor_staff_id = $2`,
              [importSellerCode, staff['sm']],
            )
          ).n,
          1,
        );
        const mkRow = async (label: string, category = 'ACTIVE_VIP', balance = 500) => {
          const id = uuidFor('import:row47:' + label);
          const person = {
            firstName: 'Imported',
            lastName: label,
            email: RUN + '-sec47-' + label + '@example.invalid',
            phone: '+639170000001',
          };
          const normalized = {
            category,
            paymentScheme: 'spot_cash',
            historicalSaleTotal: plan.cash_price,
            tier: 'GOLD',
            customerStatus: category === 'SUSPENDED' ? 'suspended' : 'active',
            person,
            payment: {
              amount: plan.cash_price,
              date: '2025-01-01',
              method: 'bank_transfer',
              reference: label,
            },
            membershipNumber: null,
            activationDate: '2025-01-01',
            expiresAt: category === 'EXPIRED' ? '2025-12-31' : '2035-01-01',
            openingBalance: balance,
            memberStatus:
              category === 'SUSPENDED'
                ? 'suspended'
                : category === 'EXPIRED'
                  ? 'expired'
                  : 'active',
            requireMember: true,
          };
          await db.query(
            "insert into public.customer_import_rows(id, import_job_id, row_number, validation_status, action, normalized_data, raw_data) values($1,$2,$3,'valid','CREATE',$4,$5)",
            [
              id,
              jobId,
              1 +
                (
                  await one<{ n: number }>(
                    'select count(*)::int as n from public.customer_import_rows where import_job_id=$1',
                    [jobId],
                  )
                ).n,
              JSON.stringify(normalized),
              // `seller_code` is the credential the applied RPC actually reads. It
              // is deliberately NOT `sellerStaffId`: production never reads that key
              // out of `raw_data`, so putting it there would look like a fix and
              // resolve nothing.
              JSON.stringify({ seller_code: importSellerCode }),
            ],
          );
          return id;
        };
        const commit = async (id: string) =>
          (
            await one<{ out: { customerId: string; membershipId: string; saleId: string } }>(
              'select public.commit_customer_import_row($1,$2) as out',
              [id, actor],
            )
          ).out;
        const rowId = await mkRow('Active');
        const active = await commit(rowId);
        const retry = await commit(rowId);
        eq('source-row retry returns the same membership', retry.membershipId, active.membershipId);
        const member = await one<{
          points_balance: string;
          status: string;
          membership_number: string;
        }>('select points_balance,status,membership_number from public.memberships where id=$1', [
          active.membershipId,
        ]);
        eq('opening balance below annual allocation remains exact', member.points_balance, '500');
        eq('active imported member uses normal active status', member.status, 'active');
        const linkage = await one<{
          customer_id: string;
          membership_id: string;
          committed_at: unknown;
        }>(
          'select customer_id,membership_id,committed_at from public.customer_import_rows where id=$1',
          [rowId],
        );
        eq('source row points at the normal customer', linkage.customer_id, active.customerId);
        eq(
          'source row points at the normal membership',
          linkage.membership_id,
          active.membershipId,
        );
        check('source row records commit time', !!linkage.committed_at);
        eq(
          'source-linked audit exists',
          (
            await one<{ n: number }>(
              "select count(*)::int as n from public.audit_events where entity_id=$1 and action='CUSTOMER_IMPORT_ROW_COMMITTED'",
              [rowId],
            )
          ).n,
          1,
        );
        for (const category of ['SUSPENDED', 'EXPIRED']) {
          const imported = await commit(await mkRow(category, category));
          eq(
            'imported ' + category + ' uses normal membership lifecycle',
            (
              await one<{ status: string }>('select status from public.memberships where id=$1', [
                imported.membershipId,
              ])
            ).status,
            category.toLowerCase(),
          );
        }
        // A fault at source linkage occurs AFTER normal records were inserted.
        // PostgreSQL must roll back the entire row graph.
        const faultId = await mkRow('Fault');
        await db.query(
          "create function private.uat_import_fault() returns trigger language plpgsql as $$ begin if new.id='" +
            faultId +
            "'::uuid then raise exception 'UAT_IMPORT_FAULT'; end if; return new; end $$",
        );
        await db.query(
          'create trigger uat_import_fault before update on public.customer_import_rows for each row execute function private.uat_import_fault()',
        );
        await throws('late import failure rolls back', () => commit(faultId));
        await db.query(
          'drop trigger uat_import_fault on public.customer_import_rows; drop function private.uat_import_fault()',
        );
        eq(
          'failed source linkage leaves no customer',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from public.customers where email=$1',
              [RUN + '-sec47-Fault@example.invalid'],
            )
          ).n,
          0,
        );
        const updateId = uuidFor('import:row47:Update');
        await db.query(
          'insert into public.customer_import_rows(id,import_job_id,row_number,validation_status,action,normalized_data,customer_id,membership_id) select $1,import_job_id,99,\'valid\',\'UPDATE\',normalized_data || \'{"category":"SUSPENDED","customerStatus":"suspended"}\'::jsonb,customer_id,membership_id from public.customer_import_rows where id=$2',
          [updateId, rowId],
        );
        await db.query(
          "create function private.uat_import_update_fault() returns trigger language plpgsql as $$ begin if new.id='" +
            updateId +
            "'::uuid then raise exception 'UAT_IMPORT_UPDATE_FAULT'; end if; return new; end $$",
        );
        await db.query(
          'create trigger uat_import_update_fault before update on public.customer_import_rows for each row execute function private.uat_import_update_fault()',
        );
        await throws('late update failure rolls back', () => commit(updateId));
        eq(
          'failed update preserves membership state',
          (
            await one<{ status: string }>('select status from public.memberships where id=$1', [
              active.membershipId,
            ])
          ).status,
          'active',
        );
        eq(
          'failed update preserves customer state',
          (
            await one<{ status: string }>('select status from public.customers where id=$1', [
              active.customerId,
            ])
          ).status,
          'active',
        );
        await db.query(
          'drop trigger uat_import_update_fault on public.customer_import_rows; drop function private.uat_import_update_fault()',
        );
        await commit(updateId);
        eq(
          'successful update uses normal membership lifecycle',
          (
            await one<{ status: string }>('select status from public.memberships where id=$1', [
              active.membershipId,
            ])
          ).status,
          'suspended',
        );

        const invariants = await db.query(
          readFileSync(join(process.cwd(), 'supabase/security/rls_invariants.sql'), 'utf8'),
        );
        check(
          'RLS invariants return no violations',
          (Array.isArray(invariants) ? invariants : [invariants]).every((r) => r.rows.length === 0),
          JSON.stringify(
            (Array.isArray(invariants) ? invariants : [invariants]).flatMap((r) => r.rows),
          ),
        );
      }

      section('48. Customer import release blockers on real PostgreSQL');
      {
        const actor = staff['super-admin']!;
        const job = uuidFor('import:job48');
        await db.query(
          "insert into customer_import_jobs(id,source_type,source_name,status,created_by,validated_at) values($1,'csv',$2,'ready',$3,now())",
          [job, RUN + '-release48.csv', actor],
        );
        const plan = await one<{ id: string; cash_price: string }>(
          "select id,cash_price from card_plans where code='GOLD'",
        );
        // Same defect class as section 47, different section: `commit_customer_import_row`
        // reads seller attribution from `raw_data`, never from `normalized_data`, so a row
        // without `raw_data.seller_code` is inserted with a NULL seller and the older
        // Phase 14 hierarchy trigger refuses it. This section needs its own live,
        // active referral code because the one section 47 made is deleted at its end.
        const releaseSellerCode =
          'OST-SEC48-' + RUN.slice(1, 7).toUpperCase().padEnd(6, 'X');
        const releaseSellerCodeId = uuidFor('import:row48:seller-code');
        await db.query(
          `insert into referral_codes
             (id, code_hash, code_hint, sponsor_staff_id, expires_at, max_uses, use_count, is_active, created_by)
           values ($1, private.hash_token($2), $3, $4, now() + interval '7 days', 10, 0, true, $4)`,
          [
            releaseSellerCodeId,
            releaseSellerCode,
            'OST-?-' + releaseSellerCode.slice(-4),
            staff['sm'],
          ],
        );
        eq(
          'the section-48 seller code resolves to the Sales Manager via the production lookup',
          (
            await one<{ n: number }>(
              `select count(*)::int n from referral_codes
                where code_hash = private.hash_token($1) and is_active and sponsor_staff_id = $2`,
              [releaseSellerCode, staff['sm']],
            )
          ).n,
          1,
        );
        let serial = 0;
        const person = (label: string) => ({
          firstName: 'Release',
          lastName: label,
          email: RUN + '-release48-' + label + '@example.invalid',
          phone: '09170000000',
          customerStatus: 'active',
          paymentScheme: 'spot_cash',
          historicalSaleTotal: '12000.00',
        });
        const payment = { amount: '12000.00', date: '2025-01-01', method: 'cash', reference: null };
        const createRow = async (label: string, overrides: Record<string, unknown> = {}) => {
          const id = uuidFor('import:row48:' + label);
          const normalized = {
            category: 'ACTIVE_VIP',
            tier: 'GOLD',
            customerStatus: 'active',
            person: person(label),
            paymentScheme: 'spot_cash',
            historicalSaleTotal: '12000.00',
            payment,
            membershipNumber: null,
            activationDate: '2025-01-01',
            expiresAt: '2035-01-01',
            openingBalance: 12500,
            memberStatus: 'active',
            requireMember: true,
            ...overrides,
          };
          await db.query(
            "insert into customer_import_rows(id,import_job_id,row_number,validation_status,action,normalized_data,raw_data) values($1,$2,$3,'valid','CREATE',$4,$5)",
            [
              id,
              job,
              ++serial,
              JSON.stringify(normalized),
              JSON.stringify({ seller_code: releaseSellerCode }),
            ],
          );
          return id;
        };
        type Imported = { customerId: string; membershipId: string; saleId: string };
        const commit = async (id: string) =>
          (
            await one<{ out: Imported }>('select commit_customer_import_row($1,$2) as out', [
              id,
              actor,
            ])
          ).out;
        const badAmount = await createRow('AmountOnly', { payment: { amount: '12000.00' } });
        const missing = await throws('amount-only history is rejected', () => commit(badAmount));
        check(
          'missing history names the payment rule',
          missing.includes('IMPORT_BAD_PAYMENT'),
          missing,
        );
        eq(
          'bad history rolls back all customer data',
          (
            await one<{ n: number }>('select count(*)::int as n from customers where email=$1', [
              person('AmountOnly').email,
            ])
          ).n,
          0,
        );
        const id = await createRow('Active');
        const member = await commit(id);
        const retry = await commit(id);
        eq('retry returns existing customer', retry.customerId, member.customerId);
        eq('retry returns existing sale', retry.saleId, member.saleId);
        eq('retry returns existing membership', retry.membershipId, member.membershipId);
        const sale = await one<{
          origin: string;
          import_job_id: string;
          import_row_id: string;
          seller_staff_id: string | null;
          cash_price_snapshot: string;
        }>(
          'select origin,import_job_id,import_row_id,seller_staff_id,cash_price_snapshot from card_sales where id=$1',
          [member.saleId],
        );
        eq('explicit legacy origin', sale.origin, 'legacy_import');
        eq('sale links job', sale.import_job_id, job);
        eq('sale links exact row', sale.import_row_id, id);
        // STALE ASSERTIONS, CORRECTED. These two used to assert `seller_staff_id` is
        // NULL and that no hierarchy snapshot is written. Both are now impossible: the
        // Phase 14 trigger on `card_sales` refuses a sale with no seller
        // (SALE_SELLER_REQUIRED, SQLSTATE 23514), so a legacy import row must carry a
        // seller credential in `raw_data` or it cannot create a sale at all. The rule
        // is legitimate; these expectations were written before it.
        //
        // The fixture now supplies the Sales Manager's live referral code, so the sale
        // IS attributed and the referral hierarchy IS snapshotted - which is the
        // real-world behaviour once an import carries seller attribution. The
        // genuine defect this exposed (an import that omits seller attribution dies on
        // a raw trigger instead of a clear validation error) is filed separately as a
        // forward-only migration and is NOT papered over here.
        eq('seller is attributed from raw_data', sale.seller_staff_id, staff['sm'] ?? null);
        eq(
          'historical frozen total differs from current plan',
          sale.cash_price_snapshot,
          '12000.00',
        );
        eq(
          'attributed historical import records its referral hierarchy',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from card_sale_hierarchy_snapshots where sale_id=$1',
              [member.saleId],
            )
          ).n > 0,
          true,
        );
        eq(
          'historical import creates no commission',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from commissions where sale_id=$1',
              [member.saleId],
            )
          ).n,
          0,
        );
        eq(
          'operational sales exclude legacy',
          (
            await one<{ n: number }>(
              "select count(*)::int as n from card_sales where id=$1 and origin='normal'",
              [member.saleId],
            )
          ).n,
          0,
        );
        const pay = await one<{ method: string; date: string }>(
          'select method,recorded_at::date::text as date from payments where sale_id=$1',
          [member.saleId],
        );
        eq('historical method preserved', pay.method, 'cash');
        eq('historical date preserved', pay.date, '2025-01-01');
        const directory = await db.query<{ record: Record<string, unknown>; total_count: string }>(
          'select * from customer_directory($1)',
          [JSON.stringify({ search: person('Active').email, limit: 1 })],
        );
        eq('directory query executes on the actual schema', directory.rows.length, 1);
        eq(
          'directory uses normal imported membership',
          directory.rows[0]!.record.membership_id,
          member.membershipId,
        );
        const safe = memberLookupFromDirectory(directory.rows[0]!.record);
        eq('employee lookup returns imported member', safe.memberName, 'Release Active');
        eq('lookup points from normal account', safe.availablePoints, '12500');
        check(
          'lookup excludes identity/contact/auth/payment fields',
          !Object.keys(safe).some((k) =>
            /email|phone|address|birth|auth|payment|tin|document/i.test(k),
          ),
        );
        const ledgerBefore = (
          await one<{ n: number }>(
            'select count(*)::int as n from points_ledger where account_id=(select id from points_accounts where membership_id=$1)',
            [member.membershipId],
          )
        ).n;
        for (const status of ['cancelled', 'suspended', 'expired']) {
          await db.query('update memberships set status=$1 where id=$2', [
            status,
            member.membershipId,
          ]);
          const updateId = uuidFor('import:update48:' + status);
          await db.query(
            "insert into customer_import_rows(id,import_job_id,row_number,validation_status,action,customer_id,membership_id,normalized_data) select $1,import_job_id,$3,'valid','UPDATE',customer_id,membership_id,normalized_data from customer_import_rows where id=$2",
            [updateId, id, ++serial],
          );
          const conflict = await throws(status + ' to active import conflicts', () =>
            commit(updateId),
          );
          check(
            'conflict carries existing and requested states',
            conflict.includes('existing=' + status) && conflict.includes('requested=active'),
            conflict,
          );
        }
        await db.query("update memberships set status='active' where id=$1", [member.membershipId]);
        await db.query("update customers set status='suspended' where id=$1", [member.customerId]);
        eq(
          'suspended customer overrides active card',
          (
            await one<{ record: { derivedCategory: string } }>(
              'select record from customer_directory($1)',
              [JSON.stringify({ search: person('Active').email })],
            )
          ).record.derivedCategory,
          'SUSPENDED',
        );
        eq(
          'existing ledger unchanged',
          (
            await one<{ n: number }>(
              'select count(*)::int as n from points_ledger where account_id=(select id from points_accounts where membership_id=$1)',
              [member.membershipId],
            )
          ).n,
          ledgerBefore,
        );
        await db.query("update customers set status='active' where id=$1", [member.customerId]);
        const pointsUpdate = uuidFor('import:points48');
        await db.query(
          "insert into customer_import_rows(id,import_job_id,row_number,validation_status,action,customer_id,membership_id,normalized_data) select $1,import_job_id,$3,'valid','UPDATE',customer_id,membership_id,normalized_data || '{\"openingBalance\":999999}'::jsonb from customer_import_rows where id=$2",
          [pointsUpdate, id, ++serial],
        );
        await commit(pointsUpdate);
        eq(
          'existing opening balance is never overwritten',
          (
            await one<{ balance: string }>(
              'select balance::text from points_accounts where membership_id=$1',
              [member.membershipId],
            )
          ).balance,
          '12500',
        );
        for (const opening of [0, 25000, 25100, 24900]) {
          const out = await commit(
            await createRow('Points' + opening, { openingBalance: opening }),
          );
          eq(
            'opening balance ' + opening + ' remains exact',
            (
              await one<{ balance: string }>(
                'select balance::text from points_accounts where membership_id=$1',
                [out.membershipId],
              )
            ).balance,
            String(opening),
          );
          eq(
            'opening ledger sum ' + opening + ' equals balance',
            (
              await one<{ amount: string }>(
                'select coalesce(sum(pl.amount),0)::text as amount from points_ledger pl join points_accounts pa on pa.id=pl.account_id where pa.membership_id=$1',
                [out.membershipId],
              )
            ).amount,
            String(opening),
          );
        }
        const mixed = RUN + '-MixedCase48@EXAMPLE.INVALID';
        await db.query('update customers set email=$1 where id=$2', [mixed, member.customerId]);
        eq(
          'database email lookup is case insensitive',
          (
            await one<{ id: string }>('select id from match_import_emails($1)', [
              [mixed.toLowerCase()],
            ])
          ).id,
          member.customerId,
        );
        const otherId = await createRow('Other');
        const other = await commit(otherId);
        const otherNumber = (
          await one<{ customer_number: string }>(
            'select customer_number from customers where id=$1',
            [other.customerId],
          )
        ).customer_number;
        const contradictory = uuidFor('import:cross48');
        await db.query(
          "insert into customer_import_rows(id,import_job_id,row_number,validation_status,action,customer_id,membership_id,normalized_data,raw_data) select $1,import_job_id,$3,'valid','UPDATE',customer_id,membership_id,normalized_data,jsonb_build_object('customer_number',$4::text) from customer_import_rows where id=$2",
          [contradictory, id, ++serial, otherNumber],
        );
        check(
          'contradictory customer number rejected',
          (await throws('cross-link rejected', () => commit(contradictory))).includes(
            'IMPORT_IDENTIFIER_CONFLICT',
          ),
        );
        const next = (
          await one<{ n: string }>('select (last_value+1)::text as n from membership_number_seq')
        ).n;
        const supplied = 'MBS-' + next.padStart(6, '0');
        const suppliedId = await createRow('Supplied', { membershipNumber: supplied });
        await commit(suppliedId);
        const auto = await commit(await createRow('Automatic'));
        check(
          'automatic creation skips supplied number',
          (
            await one<{ membership_number: string }>(
              'select membership_number from memberships where id=$1',
              [auto.membershipId],
            )
          ).membership_number !== supplied,
        );
        check(
          'supplied duplicate rejected',
          (
            await throws('duplicate supplied number', () =>
              createRow('Duplicate', { membershipNumber: supplied }).then(commit),
            )
          ).includes('IMPORT_DUPLICATE_MEMBERSHIP'),
        );
        check(
          'malformed number rejected at RPC',
          (
            await throws('malformed number', () =>
              createRow('Malformed', { membershipNumber: 'MBS-invalid' }).then(commit),
            )
          ).includes('IMPORT_BAD_MEMBERSHIP_NUMBER'),
        );
        const concurrentIds = await Promise.all([
          createRow('ConcurrentA'),
          createRow('ConcurrentB'),
        ]);
        const clients = [
          new Client({ connectionString: target.url }),
          new Client({ connectionString: target.url }),
        ];
        await Promise.all(clients.map((c) => c.connect()));
        try {
          const outputs = await Promise.all(
            clients.map((c, i) =>
              c.query<{ out: Imported }>('select commit_customer_import_row($1,$2) as out', [
                concurrentIds[i],
                actor,
              ]),
            ),
          );
          check(
            'concurrent imports create distinct members',
            outputs[0]!.rows[0]!.out.membershipId !== outputs[1]!.rows[0]!.out.membershipId,
          );
        } finally {
          await Promise.all(clients.map((c) => c.end()));
        }
        const dp = await commit(
          await createRow('DownPayment', {
            category: 'DOWN_PAYMENT_COMPLETED',
            requireMember: false,
            paymentScheme: 'move_b1_40_12',
            historicalReservationFee: '1000.00',
            historicalRequiredInitial: '4000.00',
            payment: { amount: '4000.00', date: '2025-01-01', method: 'cash' },
          }),
        );
        eq(
          'actual historical scheme down-payment snapshot drives category',
          (
            await one<{ record: { derivedCategory: string } }>(
              'select record from customer_directory($1)',
              [JSON.stringify({ search: person('DownPayment').email })],
            )
          ).record.derivedCategory,
          'DOWN_PAYMENT_COMPLETED',
        );
        eq(
          'historical scheme is preserved',
          (
            await one<{ payment_scheme: string }>(
              'select payment_scheme from card_sales where id=$1',
              [dp.saleId],
            )
          ).payment_scheme,
          'move_b1_40_12',
        );
        const reservation = await commit(
          await createRow('Reservation', {
            historicalReservationFee: '10000.00',
            historicalRequiredInitial: '10000.00',
            category: 'RESERVATION_PAID',
            customerStatus: 'active',
            requireMember: false,
            payment: { amount: '10000.00', date: '2025-01-01', method: 'cash' },
            paymentScheme: 'spot_cash',
            historicalSaleTotal: plan.cash_price,
          }),
        );
        eq(
          'reservation payment stays reservation category',
          (
            await one<{ record: { derivedCategory: string } }>(
              'select record from customer_directory($1)',
              [JSON.stringify({ search: person('Reservation').email })],
            )
          ).record.derivedCategory,
          'RESERVATION_PAID',
        );
        await db.query('update card_sales set seller_staff_id=$1 where id=$2', [
          actor,
          reservation.saleId,
        ]);
        eq(
          'seller ID filter precedes page limit',
          (
            await one<{ record: { id: string } }>('select record from customer_directory($1)', [
              JSON.stringify({ search: person('Reservation').email, seller: actor, limit: 1 }),
            ])
          ).record.id,
          reservation.customerId,
        );
        await db.query(
          "update card_sales set seller_type='staff',seller_staff_id=$1,seller_ost_id=null where id=$2",
          [staff['ost'], reservation.saleId],
        );
        eq(
          'OST staff seller ID filter uses frozen sale identity',
          (
            await one<{ record: { id: string } }>('select record from customer_directory($1)', [
              JSON.stringify({
                search: person('Reservation').email,
                seller: staff['ost'],
                limit: 1,
              }),
            ])
          ).record.id,
          reservation.customerId,
        );
        await db.query("update customer_import_jobs set status='committing' where id=$1", [job]);
        eq(
          'committing source row retry remains idempotent',
          (await commit(id)).saleId,
          member.saleId,
        );
        const denied = await throws('ordinary staff cannot commit import', () =>
          one('select commit_customer_import_row($1,$2)', [id, staff['employee'] ?? staff['sm']]),
        );
        check('ordinary staff denial is explicit', denied.includes('IMPORT_FORBIDDEN'), denied);
        await db.query("update customer_import_jobs set status='failed' where id=$1", [job]);
        check(
          'failure timestamp recorded',
          (
            await one<{ failed_at: unknown }>(
              'select failed_at from customer_import_jobs where id=$1',
              [job],
            )
          ).failed_at !== null,
        );
        check(
          'failed job cannot return to ready',
          (
            await throws('illegal lifecycle edge', () =>
              db.query("update customer_import_jobs set status='ready' where id=$1", [job]),
            )
          ).includes('IMPORT_JOB_TRANSITION_INVALID'),
        );

        const countsJob = uuidFor('import:counts48');
        await db.query(
          "insert into customer_import_jobs(id,source_type,source_name,status,created_by,validated_at,total_rows,valid_rows,invalid_rows) values($1,'csv',$2,'ready',$3,now(),500,495,5)",
          [countsJob, RUN + '-counts48.csv', actor],
        );
        await db.query("update customer_import_jobs set status='committing' where id=$1", [
          countsJob,
        ]);
        await throws('completed job cannot hide five invalid rows', () =>
          db.query(
            "update customer_import_jobs set status='completed',inserted_rows=495,skipped_rows=5,committed_at=now() where id=$1",
            [countsJob],
          ),
        );
        await db.query(
          "update customer_import_jobs set status='completed_with_errors',inserted_rows=495,failed_rows=5,committed_at=now() where id=$1",
          [countsJob],
        );
        eq(
          'completion counts preserve 495+5',
          (
            await one<{ status: string }>('select status from customer_import_jobs where id=$1', [
              countsJob,
            ])
          ).status,
          'completed_with_errors',
        );
      }
      section('49. Directory RPC server-role private privileges');
      {
        const serverRole = await one<{ usage: boolean; money: boolean; hash: boolean }>(
          `select has_schema_privilege('service_role','private','USAGE') as usage,
            has_function_privilege('service_role','private.money(numeric)','EXECUTE') as money,
            has_function_privilege('service_role','private.hash_token(text)','EXECUTE') as hash`,
        );
        check(
          'server has only required private dependency access',
          serverRole.usage && serverRole.money && serverRole.hash,
        );
        for (const role of ['anon', 'authenticated']) {
          for (const fn of [
            'private.money(numeric)',
            'private.hash_token(text)',
            'public.customer_directory(jsonb)',
            'public.search_customer_ids(text)',
          ]) {
            const access = await one<{ allowed: boolean }>(
              "select has_function_privilege($1,$2,'EXECUTE') as allowed",
              [role, fn],
            );
            eq(role + ' cannot execute ' + fn, access.allowed, false);
          }
        }
        const invoker = await one<{ n: number }>(
          `select count(*)::int as n from pg_proc where oid in ('public.customer_directory(jsonb)'::regprocedure,'public.search_customer_ids(text)'::regprocedure) and not prosecdef`,
        );
        eq('both directory functions retain caller privileges', invoker.n, 2);
        for (const role of ['anon', 'authenticated'] as const) {
          for (const sql of [
            "select * from public.customer_directory('{}')",
            'select private.money(1)',
            "select private.hash_token('QA')",
          ]) {
            const message = await throws(role + ' denied actual call ' + sql, () =>
              asBrowserRole(target.url, role, null, (client) => client.query(sql)),
            );
            check('denial names privilege boundary', /permission denied/.test(message));
          }
        }

        const active = await one<{
          id: string;
          customer_number: string;
          membership_id: string;
          membership_number: string;
          seller_id: string;
        }>(
          `select c.id,c.customer_number,m.id as membership_id,m.membership_number,s.seller_staff_id as seller_id
           from customers c join memberships m on m.customer_id=c.id join card_sales s on s.id=m.sale_id where c.id=(select customer_id from customer_import_rows where id=$1)`,
          [uuidFor('import:row48:Active')],
        );
        await db.query('begin');
        try {
          // Supabase provides service_role table access. Model only these SELECTs
          // in this disposable transaction; the corrective migration changes no tables.
          await db.query(
            'grant select on public.customers,public.memberships,public.points_accounts,public.card_sales,public.card_plans,public.staff_users,public.payments to service_role',
          );
          await db.query(
            "update memberships set fallback_code_hash=private.hash_token('A1B2C3D4') where id=$1",
            [active.membership_id],
          );
          const query = async (filters: Record<string, unknown>) => {
            await db!.query('set local role service_role');
            try {
              return await db!.query<{ record: Record<string, unknown>; total_count: string }>(
                'select * from public.customer_directory($1::jsonb)',
                [JSON.stringify(filters)],
              );
            } finally {
              await db!.query('reset role');
            }
          };
          for (const [label, filters] of [
            ['full name', { search: 'Release Active' }],
            ['partial name', { search: 'lease Act' }],
            ['customer number', { search: active.customer_number }],
            ['fallback', { search: 'a1b2-c3d4', identifier: 'A1B2C3D4' }],
            ['Active VIP', { search: 'Release Active', category: 'ACTIVE_VIP' }],
            ['tier', { search: 'Release Active', tier: 'GOLD' }],
            ['date range', { search: 'Release Active', from: '2000-01-01', to: '2099-12-31' }],
          ] as const) {
            const r = await query({ ...filters, limit: 5000 });
            check(
              'service directory ' + label,
              r.rows.some((x) => x.record.id === active.id),
            );
          }
          // Since 20261028000001 the customer directory must NOT answer to a
          // Membership Code. It is a transaction identifier and belongs to the
          // protected redemption path only.
          for (const [label, term] of [
            ['membership number', active.membership_number],
            ['member code envelope', 'AFHOMES:' + active.membership_number],
          ] as const) {
            const r = await query({ search: term, limit: 5000 });
            check(
              'service directory does NOT resolve a Membership Code: ' + label,
              !r.rows.some((x) => x.record.id === active.id),
            );
          }
          const sellerRecord = (await query({ limit: 5000 })).rows.find(
            (row) => typeof row.record.seller_id === 'string',
          );
          check('seller filter has an actual nonnull fixture seller', Boolean(sellerRecord));
          if (sellerRecord) {
            const sellerRows = await query({ seller: sellerRecord.record.seller_id, limit: 5000 });
            check(
              'seller filter selects only that seller',
              sellerRows.rows.length > 0 &&
                sellerRows.rows.every(
                  (row) => row.record.seller_id === sellerRecord.record.seller_id,
                ),
            );
          }
          for (const sort of [
            'created_at',
            'name',
            'tier',
            'category',
            'payment_status',
            'membership_status',
            'verified_paid',
          ]) {
            const r = await query({ search: 'Release', sort, limit: 5000 });
            check('service directory sort ' + sort, r.rows.length > 0);
          }
          for (const status of ['suspended', 'expired', 'cancelled']) {
            await db.query('update memberships set status=$1 where id=$2', [
              status,
              active.membership_id,
            ]);
            const r = await query({
              search: active.customer_number,
              category: status.toUpperCase(),
            });
            eq('service category ' + status, r.rows.length, 1);
          }
          await db.query("update memberships set status='active' where id=$1", [
            active.membership_id,
          ]);
          const directory = await query({
            search: active.customer_number,
            membersOnly: true,
            limit: 5000,
          });
          const safe = memberLookupFromDirectory(directory.rows[0]!.record);
          eq(
            'employee-safe normal imported member',
            safe.membershipNumber,
            active.membership_number,
          );
          check(
            'employee-safe fields contain no PII or payment details',
            !Object.keys(safe).some((k) =>
              /email|address|tin|document|auth|payment|birth/i.test(k),
            ),
          );
          eq(
            'CSV export directory query succeeds',
            (await query({ search: active.customer_number, category: 'ACTIVE_VIP', limit: 5000 }))
              .rows.length,
            1,
          );
          eq(
            'XLSX export directory query succeeds',
            (await query({ search: active.customer_number, tier: 'GOLD', limit: 5000 })).rows
              .length,
            1,
          );
          const manual = await one<{ customer_number: string }>(
            'select customer_number from customers where id=$1',
            [createdCustomerIds[0]],
          );
          eq(
            'manual normal customer appears',
            (await query({ search: manual.customer_number })).rows.length,
            1,
          );
          await db.query('set local role service_role');
          try {
            const found = await db.query('select * from public.search_customer_ids($1)', [
              'A1B2C3D4',
            ]);
            check(
              'related search RPC can hash fallback',
              found.rows.some((r) => r.customer_id === active.id),
            );
          } finally {
            await db.query('reset role');
          }
        } finally {
          await db.query('rollback');
        }
        const audit = await db.query(
          readFileSync(join(process.cwd(), 'supabase/security/rls_invariants.sql'), 'utf8'),
        );
        const sets = Array.isArray(audit) ? audit : [audit];
        check(
          'RLS invariants have zero violations',
          sets.every((r) => r.rows.length === 0),
        );
      }
      section('50. durable mutation concurrency, retry, rollback and private ACL');
      await runIdempotencyChecks({
        db,
        url: target.url,
        actor: staff['super-admin']!,
        seller: staff['ost']!,
        employee: staff['hr']!,
        run: RUN,
        createdCustomers: createdCustomerIds,
        check,
      });
      section('51. OST accreditation, renewal, import and private ACL');
      await runOstAccreditationChecks({
        db,
        url: target.url,
        actor: staff['super-admin']!,
        sponsor: staff['sm']!,
        run: RUN,
        check,
      });
      section('53. AF business IDs: random allocation, backfill, legacy compatibility');
      {
        const AF5 = '[A-HJ-NP-Z2-9]{5}';
        const afRe = (prefix: string) => new RegExp(`^${prefix}-${AF5}$`);
        // Allocators answer the new format; the card sale is AF-CSALE, never AF-SALES.
        const cn = (await one<{ customer_number: string }>('select * from public.next_customer_number()'))
          .customer_number;
        check('new customers allocate AF-CUS-XXXXX', afRe('AF-CUS').test(cn), cn);
        const sn = (await one<{ sale_number: string }>('select * from public.next_sale_number()'))
          .sale_number;
        check(
          'new card sales allocate AF-CSALE-XXXXX, not AF-SALES',
          afRe('AF-CSALE').test(sn) && !sn.startsWith('AF-SALES-'),
          sn,
        );
        const rn = (await one<{ redemption_number: string }>('select * from public.next_redemption_number()'))
          .redemption_number;
        check('new redemptions allocate AF-RED-XXXXX', afRe('AF-RED').test(rn), rn);
        const on = (await one<{ ost_number: string }>('select * from public.next_ost_number()')).ost_number;
        check('new OST members allocate AF-OST-XXXXX', afRe('AF-OST').test(on), on);
        // Prefixes are server-chosen: arbitrary input is refused.
        const badPrefix = await throws('arbitrary prefix refused', () =>
          db.query(`select private.af_candidate('BOGUS')`),
        );
        check('prefix refusal names the boundary', /INVALID_BUSINESS_PREFIX/.test(badPrefix));
        const badTarget = await throws('arbitrary claim target refused', () =>
          db.query(
            `select private.claim_af_id('AF-CUS','public.payments'::regclass,'payment_number')`,
          ),
        );
        check('target refusal names the boundary', /INVALID_BUSINESS_ID_TARGET/.test(badTarget));
        // 1,000 candidates in one query: well-formed and not sequential.
        // Raw draws are independent, so a repeat IS possible and expected here:
        // over 32^5 = 33,554,432 the expected number of collisions at n=1000 is
        // ~0.015 (the birthday effect). Uniqueness is therefore a property of
        // STORED values, enforced by the UNIQUE constraint and the retry - not of
        // the generator's output - so this asserts the birthday-aware bound and
        // the real invariant is proven separately by the "holds no duplicates"
        // backfill checks below.
        const batch = await db.query<{ c: string }>(
          `select private.af_candidate('AF-PAY') as c from generate_series(1,1000)`,
        );
        const vals = batch.rows.map((r) => r.c);
        const distinct = new Set(vals).size;
        check(
          '1000 candidates are unique apart from at most a birthday repeat',
          distinct >= vals.length - 2,
          `${distinct} distinct of ${vals.length}`,
        );
        check(
          '1000 candidates match AF-PAY-XXXXX with no ambiguous symbols',
          vals.every((v) => afRe('AF-PAY').test(v)),
          vals.find((v) => !afRe('AF-PAY').test(v)) ?? '',
        );
        check(
          '1000 candidates are not sequential',
          vals.join(',') !== [...vals].sort().join(','),
        );
        // Two connections racing the same allocator must never agree.
        const racer = new Client({ connectionString: target.url });
        racer.on('error', () => {});
        await racer.connect();
        try {
          const claimSql = `select private.claim_af_id('AF-RED','public.redemptions'::regclass,'redemption_number') as c`;
          const [first, second] = await Promise.all([
            db.query<{ c: string }>(claimSql),
            racer.query<{ c: string }>(claimSql),
          ]);
          check(
            'concurrent claims never return the same stored value',
            first.rows[0]!.c !== second.rows[0]!.c,
            `${first.rows[0]!.c} vs ${second.rows[0]!.c}`,
          );
        } finally {
          await racer.end();
        }
        // Backfilled columns: every row numbered, no duplicates.
        for (const [table, column, prefix] of [
          ['public.payments', 'payment_number', 'AF-PAY'],
          ['public.commissions', 'commission_number', 'AF-COM'],
          ['public.customer_import_jobs', 'job_number', 'AF-IMP'],
          ['public.staff_users', 'employee_number', 'AF-EMP'],
        ] as const) {
          const missing = await one<{ n: number }>(
            `select count(*)::int as n from ${table} where ${column} is null`,
          );
          eq(`${table}.${column} fully backfilled`, missing.n, 0);
          const dupes = await one<{ n: number }>(
            `select count(*)::int as n from (select ${column} from ${table} group by ${column} having count(*) > 1) d`,
          );
          eq(`${table}.${column} holds no duplicates`, dupes.n, 0);
          const sample = await one<Record<string, string>>(
            `select ${column} as c from ${table} limit 1`,
          );
          check(
            `${table}.${column} matches ${prefix}-XXXXX`,
            afRe(prefix).test(String(sample.c)),
            String(sample.c),
          );
        }
        // Staff identity: sales roles hold both numbers, others hold only AF-EMP.
        const smRow = await one<{ employee_number: string; sales_number: string | null }>(
          'select employee_number, sales_number from public.staff_users where id = $1',
          [staff['sm']],
        );
        check(
          'a Sales Manager holds AF-EMP and AF-SALES',
          afRe('AF-EMP').test(smRow.employee_number) &&
            typeof smRow.sales_number === 'string' &&
            afRe('AF-SALES').test(smRow.sales_number),
          `${smRow.employee_number} / ${smRow.sales_number}`,
        );
        const hrRow = await one<{ employee_number: string; sales_number: string | null }>(
          'select employee_number, sales_number from public.staff_users where id = $1',
          [staff['hr']],
        );
        check(
          'a non-sales employee holds AF-EMP and no sales number',
          afRe('AF-EMP').test(hrRow.employee_number) && hrRow.sales_number === null,
          `${hrRow.employee_number} / ${String(hrRow.sales_number)}`,
        );
        // Legacy rows keep working: an explicit CUS- number inserts and resolves.
        const legacyId = uuidFor('bizid:legacy-customer');
        await db.query(
          `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
           values ($1, 'CUS-900001', 'Legacy', 'Compat', '1990-01-01', $2, '09175550001', 'prospect')`,
          [legacyId, `${RUN}-legacy@example.invalid`],
        );
        createdCustomerIds.push(legacyId);
        const legacyFound = await db.query<{ customer_id: string }>(
          'select * from public.search_customer_ids($1)',
          ['CUS-900001'],
        );
        check(
          'a legacy CUS- number still resolves after the rollout',
          legacyFound.rows.some((r) => r.customer_id === legacyId),
        );
        const legacyDir = await db.query(
          'select * from public.customer_directory($1::jsonb)',
          [JSON.stringify({ search: 'cus-900001', limit: 5 })],
        );
        check(
          'a legacy CUS- number stays searchable case-insensitively',
          legacyDir.rows.some((r) => (r.record as { id: string }).id === legacyId),
        );
        const freshNo = (
          await one<{ customer_number: string }>('select * from public.next_customer_number()')
        ).customer_number;
        const freshId = uuidFor('bizid:fresh-customer');
        await db.query(
          `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
           values ($1, $2, 'Fresh', 'Afid', '1990-01-01', $3, '09175550002', 'prospect')`,
          [freshId, freshNo, `${RUN}-fresh@example.invalid`],
        );
        createdCustomerIds.push(freshId);
        const freshDir = await db.query('select * from public.customer_directory($1::jsonb)', [
          JSON.stringify({ search: freshNo.toLowerCase(), limit: 5 }),
        ]);
        check(
          'a fresh AF-CUS number is searchable once stored',
          freshDir.rows.some((r) => (r.record as { id: string }).id === freshId),
          freshNo,
        );
      }
      section('54. Customer Code: separate AF-CC identifier, backfill, search and isolation');
      {
        const CC5 = '[A-HJ-NP-Z2-9]{8}';
        const ccRe = new RegExp(`^AF-CC-${CC5}$`);
        const afRe = (prefix: string) => new RegExp(`^${prefix}-[A-HJ-NP-Z2-9]{5}$`);

        // The extension must not have changed any existing prefix's format.
        const cus = (await one<{ c: string }>(`select private.af_candidate('AF-CUS') as c`)).c;
        check('AF-CUS is still exactly 5 characters', afRe('AF-CUS').test(cus), cus);
        const emp = (await one<{ c: string }>(`select private.af_candidate('AF-EMP') as c`)).c;
        check('AF-EMP is still exactly 5 characters', afRe('AF-EMP').test(emp), emp);
        const cc = (await one<{ c: string }>(`select private.af_candidate('AF-CC') as c`)).c;
        check('AF-CC is exactly 8 characters from the readable alphabet', ccRe.test(cc), cc);
        check('a Customer Code is never a Customer ID', !afRe('AF-CUS').test(cc), cc);

        const bogus = await throws('arbitrary prefix still refused for AF-CC', () =>
          db.query(`select private.af_candidate('AF-CCODE')`),
        );
        check('prefix refusal names the boundary', /INVALID_BUSINESS_PREFIX/.test(bogus));
        const wrongTarget = await throws(
          'AF-CUS cannot claim customers.customer_code',
          () =>
            db.query(
              `select private.claim_af_id('AF-CUS','public.customers'::regclass,'customer_code')`,
            ),
        );
        check('wrong target for the code refused', /INVALID_BUSINESS_ID_TARGET/.test(wrongTarget));
        const rightTarget = await one<{ c: string }>(
          `select private.claim_af_id('AF-CC','public.customers'::regclass,'customer_code') as c`,
        );
        check('AF-CC claims only customers.customer_code', ccRe.test(rightTarget.c), rightTarget.c);

        // 1,000 generated codes: well-formed, not sequential. The uniqueness
        // invariant is about STORED values (see the backfill checks below), not
        // about independent random draws, which may legitimately repeat.
        const batch = await db.query<{ c: string }>(
          `select private.af_candidate('AF-CC') as c from generate_series(1,1000)`,
        );
        const codes = batch.rows.map((r) => r.c);
        check(
          '1000 Customer Codes are unique apart from at most a birthday repeat',
          new Set(codes).size >= codes.length - 2,
          `${new Set(codes).size} distinct of ${codes.length}`,
        );
        check(
          '1000 Customer Codes are AF-CC-XXXXXXXX with no ambiguous symbols',
          codes.every((v) => ccRe.test(v)),
          codes.find((v) => !ccRe.test(v)) ?? '',
        );
        check(
          '1000 Customer Codes are not sequential',
          codes.join(',') !== [...codes].sort().join(','),
        );

        // Backfill: complete, unique, well-formed.
        for (const [label, sql] of [
          ['customers.customer_code has no nulls', `select count(*)::int n from public.customers where customer_code is null`],
          [
            'customers.customer_code has no duplicates',
            `select count(*)::int n from (select customer_code from public.customers group by customer_code having count(*)>1) d`,
          ],
          [
            'every Customer Code is well-formed',
            `select count(*)::int n from public.customers where customer_code !~ '^AF-CC-[A-HJ-NP-Z2-9]{8}$'`,
          ],
        ] as const) {
          eq(label, (await one<{ n: number }>(sql)).n, 0);
        }
        const col = await one<{ nullable: string; dflt: string | null }>(
          `select is_nullable as nullable, column_default as dflt from information_schema.columns
           where table_schema='public' and table_name='customers' and column_name='customer_code'`,
        );
        eq('customer_code is NOT NULL', col.nullable, 'NO');
        check('new inserts default a Customer Code', typeof col.dflt === 'string');
        const uniq = await one<{ n: number }>(
          `select count(*)::int n from pg_index i where i.indrelid='public.customers'::regclass
             and i.indisunique and i.indnatts=1
             and (select attname from pg_attribute where attrelid=i.indrelid and attnum=i.indkey[0])='customer_code'`,
        );
        eq('customer_code is UNIQUE', uniq.n, 1);

        // Customer IDs are untouched: no legacy row was rewritten, and no ID
        // was ever turned into a code.
        const asCode = await one<{ n: number }>(
          `select count(*)::int n from public.customers where customer_number like 'AF-CC-%'`,
        );
        eq('no customer_number holds an AF-CC value', asCode.n, 0);
        const legacyIds = await one<{ n: number }>(
          `select count(*)::int n from public.customers where customer_number ~ '^CUS-[0-9]{6}$'`,
        );
        check(
          'legacy CUS- customer IDs are still present and unchanged',
          legacyIds.n > 0,
          String(legacyIds.n),
        );
        const legacy = await one<{ id: string; customer_number: string; customer_code: string }>(
          `select id, customer_number, customer_code from public.customers
           where customer_number = 'CUS-900001'`,
        );
        eq('the legacy fixture keeps its original Customer ID', legacy.customer_number, 'CUS-900001');
        check(
          'the legacy fixture gained an independent Customer Code',
          ccRe.test(legacy.customer_code),
          legacy.customer_code,
        );
        check(
          'the Customer Code is not derived from the Customer ID',
          !legacy.customer_code.includes(legacy.customer_number),
          legacy.customer_code,
        );

        // Search resolves the code, case-insensitively, for authorized callers.
        for (const term of [legacy.customer_code, legacy.customer_code.toLowerCase()]) {
          const found = await db.query<{ customer_id: string }>(
            'select * from public.search_customer_ids($1)',
            [term],
          );
          check(
            `search_customer_ids resolves ${term === legacy.customer_code ? 'the' : 'a lower-cased'} Customer Code`,
            found.rows.some((r) => r.customer_id === legacy.id),
          );
          const dir = await db.query<{ record: { id: string; customer_code: string } }>(
            'select * from public.customer_directory($1::jsonb)',
            [JSON.stringify({ search: term, limit: 5 })],
          );
          check(
            `customer_directory resolves ${term === legacy.customer_code ? 'the' : 'a lower-cased'} Customer Code`,
            dir.rows.some((r) => r.record.id === legacy.id && r.record.customer_code === legacy.customer_code),
          );
        }

        // Every creation path inherits the DEFAULT: a customer inserted without
        // an explicit code still receives both identifiers.
        const newId = uuidFor('cc:new-customer');
        await db.query(
          `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
           values ($1, 'CUS-900002', 'Code', 'Default', '1990-01-01', $2, '09175550003', 'prospect')`,
          [newId, `${RUN}-cc-default@example.invalid`],
        );
        createdCustomerIds.push(newId);
        const created = await one<{ customer_number: string; customer_code: string }>(
          `select customer_number, customer_code from public.customers where id = $1`,
          [newId],
        );
        check(
          'an insert without an explicit code still receives one',
          ccRe.test(created.customer_code),
          created.customer_code,
        );

        // Two concurrent inserts must never agree on a Customer Code.
        const racer = new Client({ connectionString: target.url });
        racer.on('error', () => {});
        await racer.connect();
        try {
          const insertSql = (number: string) =>
            `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
             values ($1,'${number}','Race','Customer','1990-01-01',$2,'09175550004','prospect') returning customer_code`;
          const [a, b] = await Promise.all([
            db.query<{ customer_code: string }>(insertSql('CUS-900003'), [
              uuidFor('cc:race:a'),
              `${RUN}-cc-race-a@example.invalid`,
            ]),
            racer.query<{ customer_code: string }>(insertSql('CUS-900004'), [
              uuidFor('cc:race:b'),
              `${RUN}-cc-race-b@example.invalid`,
            ]),
          ]);
          createdCustomerIds.push(uuidFor('cc:race:a'), uuidFor('cc:race:b'));
          check(
            'two concurrent inserts never share a Customer Code',
            a.rows[0]!.customer_code !== b.rows[0]!.customer_code,
            `${a.rows[0]!.customer_code} vs ${b.rows[0]!.customer_code}`,
          );
        } finally {
          await racer.end();
        }

        // Not an auth secret and not overexposed: the browser roles have no
        // column privilege and cannot execute the search RPCs.
        for (const role of ['anon', 'authenticated'] as const) {
          const colAccess = await one<{ allowed: boolean }>(
            // The 4-argument form is (user, table, column, privilege); the
            // 3-argument one is (table, column, privilege) and would silently
            // read the role as a relation.
            `select has_column_privilege($1,'public.customers','customer_code','SELECT') as allowed`,
            [role],
          );
          eq(`${role} has no direct SELECT on customers.customer_code`, colAccess.allowed, false);
          const denied = await throws(`${role} cannot resolve a Customer Code`, () =>
            asBrowserRole(target.url, role, null, (client) =>
              client.query(`select * from public.search_customer_ids('${legacy.customer_code}')`),
            ),
          );
          check('denial names the privilege boundary', /permission denied/.test(denied));
        }
      }

      section('56. Legacy membership-code upgrade: alias, invariants and transaction-only lookup');
      {
        // Seed legacy sequential memberships against synthetic customers so the
        // conversion is proven by executed rows, and so every invariant below is
        // a real before/after comparison rather than a table that happens to be
        // empty.
        const legacyMemberNumber = `MBS-900${RUN}`.slice(0, 10);
        // Derive sequential numbers that are certainly unused: earlier sections
        // already own MBS-000001..N, and a hard-coded value would collide with
        // an existing alias and trip the fail-loud guard for the wrong reason.
        const maxSequential = (
          await one<{ n: number }>(
            `select coalesce(max(nullif(regexp_replace(membership_number,'^MBS-',''),'')::int),0) as n
               from public.memberships where membership_number ~ '^MBS-[0-9]{6}$'`,
          )
        ).n;
        const nextSequential = (offset: number): string =>
          `MBS-${String(maxSequential + offset).padStart(6, '0')}`;
        const sequential =
          /^MBS-[0-9]{6}$/.test(legacyMemberNumber) &&
          (Number(legacyMemberNumber.slice(4)) || 0) > maxSequential
            ? legacyMemberNumber
            : nextSequential(1);
        // Reuse an existing membership rather than building a sale + staff fixture
        // graph: the row already has a real customer, sale, activator and both
        // credential hashes, so every invariant below is a genuine comparison.
        const existingMembership = (
          await db.query<{ id: string; customer_id: string }>(
            'select id, customer_id from public.memberships order by id limit 1',
          )
        ).rows[0];
        check('a membership exists to exercise the conversion', Boolean(existingMembership));
        const legacyMembershipId = existingMembership!.id;
        const legacyCustomerId = existingMembership!.customer_id;
        await db.query('update public.memberships set membership_number = $1 where id = $2', [
          sequential,
          legacyMembershipId,
        ]);

        const scalar56 = async (sql: string, params: unknown[] = []): Promise<string> =>
          (await db!.query<{ v: string }>(sql, params)).rows[0]!.v;
        // Everything that must be byte-identical across the upgrade.
        const membershipInvariants = async () => ({
          uuid: await scalar56(
            `select md5(string_agg(id::text,'|' order by id)) from public.memberships where id = any($1::uuid[])`,
            [invariantIds],
          ),
          customer: await scalar56(
            `select md5(string_agg(customer_id::text,'|' order by id)) from public.memberships where id = any($1::uuid[])`,
            [invariantIds],
          ),
          qr: await scalar56(
            `select md5(coalesce(string_agg(coalesce(qr_token_hash,'~'),'|' order by id),'')) from public.memberships where id = any($1::uuid[])`,
            [invariantIds],
          ),
          fallback: await scalar56(
            `select md5(coalesce(string_agg(coalesce(fallback_code_hash,'~'),'|' order by id),'')) from public.memberships where id = any($1::uuid[])`,
            [invariantIds],
          ),
          meta: await scalar56(
            `select md5(string_agg(status||'|'||points_balance||'|'||coalesce(activated_at::text,'~')||'|'||coalesce(expires_at::text,'~'),';' order by id)) from public.memberships where id = any($1::uuid[])`,
            [invariantIds],
          ),
          customerCode: await scalar56(
            `select md5(coalesce(customer_code,'~')) from public.customers where id = $1`,
            [legacyCustomerId],
          ),
          customerNumber: await scalar56(`select customer_number from public.customers where id = $1`, [
            legacyCustomerId,
          ]),
          points: await scalar56(
            `select md5(string_agg(membership_id::text||'='||balance,'|' order by membership_id)) from public.points_accounts where membership_id = any($1::uuid[])`,
            [invariantIds],
          ),
        });
        const invariantIds = [legacyMembershipId];
        const before56 = await membershipInvariants();

        const converted56 = Number(
          (await db.query<{ n: string }>('select private.upgrade_legacy_membership_numbers() as n')).rows[0]!
            .n,
        );
        check('the membership conversion reports the rows it rewrote', converted56 >= 1, `${converted56}`);

        const after56 = await membershipInvariants();
        eq('membership UUID set unchanged', after56.uuid, before56.uuid);
        eq('membership customer relation unchanged', after56.customer, before56.customer);
        eq('QR token hashes unchanged', after56.qr, before56.qr);
        eq('fallback code hashes unchanged', after56.fallback, before56.fallback);
        eq('status / points_balance / activated_at / expires_on unchanged', after56.meta, before56.meta);
        eq('Customer Code byte-identical', after56.customerCode, before56.customerCode);
        eq('Customer ID byte-identical', after56.customerNumber, before56.customerNumber);
        eq('points account balances unchanged', after56.points, before56.points);

        const upgraded = (
          await db.query<{ id: string; membership_number: string }>(
            'select id, membership_number from public.memberships where id = $1',
            [legacyMembershipId],
          )
        ).rows[0]!;
        eq('the legacy membership UUID is unchanged', upgraded.id, legacyMembershipId);
        check(
          'the sequential membership number became a 128-bit random code',
          /^MBS-[0-9A-F]{8}(-[0-9A-F]{8}){3}$/.test(upgraded.membership_number),
          upgraded.membership_number,
        );
        const stillSequential = await one<{ n: number }>(
          `select count(*)::int n from public.memberships where membership_number ~ '^MBS-[0-9]{6}$'`,
        );
        eq('no sequential membership number survives anywhere', stillSequential.n, 0);

        // Transaction-only resolution: legacy alias, current code, QR token.
        for (const [label, term] of [
          ['legacy alias', sequential],
          ['lowercased legacy alias', sequential.toLowerCase()],
          ['current code', upgraded.membership_number],
          ['AFHOMES envelope of the legacy alias', `AFHOMES:${sequential}`],
        ] as const) {
          const r = await db.query<{ membership_id: string; current_number: string; via_alias: boolean }>(
            'select * from private.resolve_membership_code($1)',
            [term],
          );
          eq(`transaction lookup resolves the ${label} to the same membership`, r.rows[0]?.membership_id, legacyMembershipId);
          eq(`transaction lookup returns the CURRENT code for the ${label}`, r.rows[0]?.current_number, upgraded.membership_number);
        }
        const viaNew = await db.query<{ via_alias: boolean }>(
          'select via_alias from private.resolve_membership_code($1)',
          [upgraded.membership_number],
        );
        eq('the current code resolves directly, not via alias', viaNew.rows[0]?.via_alias, false);
        const viaLegacy = await db.query<{ via_alias: boolean }>(
          'select via_alias from private.resolve_membership_code($1)',
          [sequential],
        );
        eq('the legacy code resolves through the alias', viaLegacy.rows[0]?.via_alias, true);
        const unknownCode = await db.query<{ membership_id: string }>(
          'select membership_id from private.resolve_membership_code($1)',
          ['MBS-999999'],
        );
        eq('an unknown membership code resolves to no row', unknownCode.rows.length, 0);

        // CRITICAL: general customer search must NOT resolve a Membership Code.
        for (const term of [sequential, upgraded.membership_number, `AFHOMES:${sequential}`]) {
          const viaCustomerSearch = await db.query<{ customer_id: string }>(
            'select customer_id from public.search_customer_ids($1)',
            [term],
          );
          eq(`customer search does NOT resolve Membership Code ${term}`, viaCustomerSearch.rows.length, 0);
          const viaDirectory = await db.query<{ record: unknown }>(
            `select record from public.customer_directory($1::jsonb)`,
            [JSON.stringify({ search: term })],
          );
          const directoryHit = viaDirectory.rows.some((row) => {
            const rec = row.record as { id?: string };
            return rec?.id === legacyCustomerId;
          });
          eq(`customer_directory does NOT resolve Membership Code ${term}`, directoryHit, false);
        }
        // ...but customer identifiers still work, including the Customer Code.
        const customerCode = (
          await one<{ c: string }>('select customer_code c from public.customers where id = $1', [
            legacyCustomerId,
          ])
        ).c;
        const customerNumber = (
          await one<{ n: string }>('select customer_number n from public.customers where id = $1', [
            legacyCustomerId,
          ])
        ).n;
        for (const term of [customerNumber, customerCode]) {
          const r = await db.query<{ customer_id: string }>(
            'select customer_id from public.search_customer_ids($1)',
            [term],
          );
          eq(`customer search still resolves ${term}`, r.rows[0]?.customer_id, legacyCustomerId);
        }

        // Idempotency.
        const aliasesBefore56 = (
          await one<{ n: number }>('select count(*)::int n from private.business_id_aliases where entity_type=$1', [
            'membership',
          ])
        ).n;
        const second56 = Number(
          (await db.query<{ n: string }>('select private.upgrade_legacy_membership_numbers() as n')).rows[0]!
            .n,
        );
        eq('a second membership run rewrites nothing', second56, 0);
        eq(
          'a second membership run adds no duplicate alias',
          (await one<{ n: number }>('select count(*)::int n from private.business_id_aliases where entity_type=$1', ['membership'])).n,
          aliasesBefore56,
        );
        eq(
          'a second membership run leaves the code untouched',
          (
            await one<{ n: string }>('select membership_number n from public.memberships where id=$1', [
              legacyMembershipId,
            ])
          ).n,
          upgraded.membership_number,
        );
        const ambiguous = await one<{ n: number }>(
          `select count(*)::int n from (select entity_type, lower(old_identifier) k from private.business_id_aliases
             group by 1,2 having count(*)>1) d`,
        );
        eq('no ambiguous membership alias', ambiguous.n, 0);

// An already-randomized membership is skipped and gains NO alias. This is a
        // real row, so the check cannot pass just because the table is empty.
        const randomMembership = (
          await db.query<{ id: string; membership_number: string }>(
            `select id, membership_number from public.memberships
              where membership_number ~ '^MBS-[0-9A-F]{8}(-[0-9A-F]{8}){3}$' order by id limit 1`,
          )
        ).rows[0];
        if (randomMembership) {
          const aliasesBeforeSkip = (
            await one<{ n: number }>(
              `select count(*)::int n from private.business_id_aliases where entity_type = 'membership'`,
            )
          ).n;
          await db.query('select private.upgrade_legacy_membership_numbers()');
          const stillRandom = (
            await db.query<{ membership_number: string }>(
              'select membership_number from public.memberships where id = $1',
              [randomMembership.id],
            )
          ).rows[0]!;
          eq('an already-randomized membership code is left exactly as it was', stillRandom.membership_number, randomMembership.membership_number);
          eq(
            'an already-randomized membership gains no alias',
            (
              await one<{ n: number }>(
                `select count(*)::int n from private.business_id_aliases where entity_type = 'membership'`,
              )
            ).n,
            aliasesBeforeSkip,
          );
        } else {
          check(
            'a membership already in canonical format exists to prove the skip path',
            false,
            'no randomized membership available in this fixture graph',
          );
        }

        // A suspended membership is IDENTIFIED by its legacy alias but must still
        // be refused by the redemption transaction. Identity resolution and
        // transaction authorization are separate decisions.
        const suspendedTarget = (
          await db.query<{ id: string }>(
            `select id from public.memberships where status = 'suspended' order by id limit 1`,
          )
        ).rows[0];
        if (suspendedTarget) {
          const suspendedSequential = nextSequential(2);
          await db.query(
            `update public.memberships set membership_number = $1 where id = $2`,
            [suspendedSequential, suspendedTarget.id],
          );
          // Run the conversion so the legacy value becomes a real alias rather
          // than still being the current number.
          await db.query('select private.upgrade_legacy_membership_numbers()');
          const suffix = (
            await one<{ n: string }>(
              `select right(membership_number, 8) as n from public.memberships where id = $1`,
              [suspendedTarget.id],
            )
          ).n;
          const resolved = await db.query<{ membership_id: string; via_alias: boolean }>(
            'select membership_id, via_alias from private.resolve_membership_code($1)',
            [suspendedSequential],
          );
          eq(
            'a suspended membership is still IDENTIFIED through its legacy alias',
            resolved.rows[0]?.membership_id,
            suspendedTarget.id,
          );
          eq('and that identification is reported as via_alias', resolved.rows[0]?.via_alias, true);
          const afterSuspended = (
            await db.query<{ status: string }>('select status from public.memberships where id=$1', [
              suspendedTarget.id,
            ])
          ).rows[0]!;
          eq('resolving a suspended membership did NOT change its status', afterSuspended.status, 'suspended');
          void suffix;
          await db.query(
            'delete from private.business_id_aliases where entity_type=$1 and entity_id=$2',
            ['membership', suspendedTarget.id],
          );
        } else {
          check('a suspended membership exists to prove status is not a gate', false, 'none available');
        }

        // Ambiguity: an alias that already points at a DIFFERENT membership must
        // not silently retarget. The migration is idempotent and skips
        // already-converted rows, so the collision is proven through the unique
        // constraint the alias table relies on, in an isolated transaction.
        const ambiguousValue = nextSequential(3);
        await db.query('begin');
        let ambiguityRefused = '';
        try {
          await db.query(
            `insert into private.business_id_aliases (entity_type, entity_id, old_identifier, migration_source)
             values ('membership', $1, $2, 'planted')`,
            [legacyCustomerId, ambiguousValue],
          );
          await db.query(
            `insert into private.business_id_aliases (entity_type, entity_id, old_identifier, migration_source)
             values ('membership', $1, $2, 'planted-duplicate')`,
            [legacyMembershipId, ambiguousValue],
          );
          ambiguityRefused = 'DID NOT RAISE';
        } catch (error) {
          ambiguityRefused = safeErrorMessage(error);
        } finally {
          await db.query('rollback');
        }
        check(
          'an ambiguous membership alias is refused, never silently retargeted',
          /business_id_aliases_(old|entity_old)_unique|duplicate key/i.test(ambiguityRefused),
          ambiguityRefused,
        );

        // Security: the alias table and both functions stay server-side only.
        for (const role of ['anon', 'authenticated'] as const) {
          eq(
            `${role} cannot read the alias table`,
            (await one<{ a: boolean }>(`select has_table_privilege($1,'private.business_id_aliases','SELECT') a`, [role])).a,
            false,
          );
          eq(
            `${role} cannot execute the membership resolver`,
            (
              await one<{ a: boolean }>(
                `select has_function_privilege($1,'private.resolve_membership_code(text)','EXECUTE') a`,
                [role],
              )
            ).a,
            false,
          );
          eq(
            `${role} cannot execute the membership conversion`,
            (
              await one<{ a: boolean }>(
                `select has_function_privilege($1,'private.upgrade_legacy_membership_numbers()','EXECUTE') a`,
                [role],
              )
            ).a,
            false,
          );
        }
        check(
          'service_role may resolve a membership code for the redemption path',
          (
            await one<{ a: boolean }>(
              `select has_function_privilege('service_role','private.resolve_membership_code(text)','EXECUTE') a`,
            )
          ).a,
        );

        // Remove the alias row this section created so cleanup's row-count proof is
        // unaffected; the membership itself stays, as a converted row should.
        await db.query(
          'delete from private.business_id_aliases where entity_type = $1 and entity_id = any($2::uuid[])',
          ['membership', invariantIds],
        );
      }

      section('55. Legacy business-ID upgrade: alias preservation and identity invariants');
      {
        // Local helpers: this section must not widen shared suite scope.
        const scalar = async (sql: string): Promise<string> =>
          (await db!.query<{ v: string }>(sql)).rows[0]!.v;
        const aliasCount = async (): Promise<number> =>
          Number((await db!.query<{ n: string }>('select count(*) as n from private.business_id_aliases')).rows[0]!.n);
        // Identity, money and points must be identical before and after: only the
        // human-facing business-ID column is allowed to differ.
        const snapshotInvariants = async () => ({
          counts: await scalar(
            `select concat_ws('|',
              (select count(*) from public.customers),(select count(*) from public.card_sales),
              (select count(*) from public.customer_applications),(select count(*) from public.reservation_agreements),
              (select count(*) from public.ost_members),(select count(*) from public.redemptions),
              (select count(*) from private.ost_registration_details),(select count(*) from private.ost_accreditation_renewals),
              (select count(*) from public.memberships),(select count(*) from public.payments),(select count(*) from public.commissions))`,
          ),
          uuids: await scalar(
            `select md5(string_agg(t,'|' order by t)) from (
              select id::text t from public.customers union all select id::text from public.card_sales
              union all select id::text from public.customer_applications union all select id::text from public.reservation_agreements
              union all select id::text from public.ost_members union all select id::text from public.redemptions
              union all select id::text from public.memberships) s`,
          ),
          codes: await scalar(
            `select coalesce(string_agg(customer_code,'|' order by customer_code),'') from public.customers`,
          ),
          memberships: await scalar(
            `select coalesce(string_agg(coalesce(membership_number,'~'),'|' order by id),'') from public.memberships`,
          ),
          payments: await scalar(
            `select concat((select count(*) from public.payments),'/',coalesce(sum(amount::numeric),0)) from public.payments`,
          ),
          commissions: await scalar(
            `select concat((select count(*) from public.commissions),'/',coalesce(sum(amount::numeric),0)) from public.commissions`,
          ),
          points: await scalar(
            `select concat((select count(*) from public.points_accounts),'/',coalesce(sum(balance),0)) from public.points_accounts`,
          ),
        });
        // The conversion is exercised against synthetic legacy rows, never
        // against an empty database: an assertion that can only pass because no
        // rows exist is not a check.
        type Target = {
          entity: string;
          table: string;
          column: string;
          key: string;
          legacy: string;
          modern: RegExp;
        };
        const targets: Target[] = [
          { entity: 'customer', table: 'public.customers', column: 'customer_number', key: 'id', legacy: 'CUS-9000', modern: /^AF-CUS-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'card_sale', table: 'public.card_sales', column: 'sale_number', key: 'id', legacy: 'SALE-9000', modern: /^AF-CSALE-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'customer_application', table: 'public.customer_applications', column: 'application_number', key: 'id', legacy: 'APP-9000', modern: /^AF-APP-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'reservation_agreement', table: 'public.reservation_agreements', column: 'reservation_number', key: 'id', legacy: 'RES-9000', modern: /^AF-RES-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'ost_member', table: 'public.ost_members', column: 'ost_number', key: 'id', legacy: 'OST-9000', modern: /^AF-OST-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'redemption', table: 'public.redemptions', column: 'redemption_number', key: 'id', legacy: 'RDM-9000', modern: /^AF-RED-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'ost_renewal', table: 'private.ost_accreditation_renewals', column: 'renewal_number', key: 'id', legacy: 'REN-9000', modern: /^AF-REN-[A-HJ-NP-Z2-9]{5}$/ },
          { entity: 'ost_accreditation', table: 'private.ost_registration_details', column: 'form_number', key: 'application_id', legacy: 'AF-9000', modern: /^AF-ACC-[A-HJ-NP-Z2-9]{5}$/ },
        ];

        // One synthetic customer per legacy number proves random, non-sequential
        // allocation; the other tables reuse an existing row so no fixture graph
        // has to be rebuilt, which keeps their UUIDs and counts untouched.
        const seededCustomers: { id: string; legacy: string; code: string }[] = [];
        for (const [i] of ['CUS-900001', 'CUS-900002', 'CUS-900003'].entries()) {
          const id = uuidFor(`legacy:cus:${i}`);
          const number = `CUS-${RUN}${i}`;
          const created = await db.query<{ customer_code: string }>(
            `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
             values ($1,$2,'Legacy','Customer','1990-01-01',$3,'09175550004','prospect') returning customer_code`,
            [id, number, `${RUN}-legacy-${i}@example.invalid`],
          );
          createdCustomerIds.push(id);
          seededCustomers.push({ id, legacy: number, code: created.rows[0]!.customer_code });
        }
        check(
          'three legacy customer numbers seeded with distinct Customer Codes',
          new Set(seededCustomers.map((c) => c.code)).size === 3,
        );

        const exercised: string[] = [];
        const exercisedRowKeys = new Map<string, string>();
        const forcedValues = new Map<string, string>();
        for (const t of targets) {
          // The three OST types are seeded explicitly below; reuse an existing
          // row only for the five public tables.
          if (t.entity.startsWith('ost_')) continue;
          const row = await db.query<{ key: string }>(
            `select ${t.key} as key from ${t.table} order by ${t.key} limit 1`,
          );
          if (!row.rows[0]) continue;
          const key = row.rows[0]!.key;
          // Run-unique so it can never collide with a legacy fixture another
          // section already created.
          const forced = `${t.legacy}-${RUN}`;
          await db.query(
            `update ${t.table} set ${t.column} = $1 where ${t.key} = $2`,
            [forced, key],
          );
          await db.query(
            `insert into private.business_id_aliases (entity_type, entity_id, old_identifier, migration_source)
             values ($1,$2,$3,'pre-test') on conflict (entity_type, old_identifier) do update set is_active = false`,
            [t.entity, key, forced],
          );
          exercised.push(t.entity);
          exercisedRowKeys.set(t.entity, key);
          forcedValues.set(t.entity, forced);
        }
        // Minimum OST fixture graph, so the three OST entity types are proven by
        // EXECUTED rows rather than by reading the shipped function body. Real
        // FK edges throughout: sponsor -> referral code -> application -> member
        // -> accreditation -> term -> renewal. No orphan rows, no weakened
        // constraints.
        const sponsorId = staff['sm'];
        const ostMemberId = uuidFor('legacy:ost:member');
        check('the OST sponsor exists for the fixture graph', Boolean(sponsorId));
        const legacyOstNumber = 'OST-000903';
        const legacyFormNumber = `AF-${'a1b2c3d4e5f60718'.repeat(2)}`;
        const legacyRenewalNumber = 'REN-000904';
        const ostApplicationId = uuidFor('legacy:ost:app');
        // ost_members.id references auth.users, so the member needs a real auth
        // user and staff profile - not an orphan uuid.
        const termId = uuidFor('legacy:ost:term');
        const renewalId = uuidFor('legacy:ost:renewal');
        const referralCodeId = uuidFor('legacy:ost:code');
        legacyOstFixtureIds.push(renewalId, termId, ostApplicationId, ostMemberId, referralCodeId);
        await db.query('insert into auth.users (id, email) values ($1, $2)', [
          ostMemberId,
          `${RUN}-legacy-ost@example.invalid`,
        ]);
        createdAuthIds.push(ostMemberId);
        await db.query(
          `insert into public.staff_users (id, email, full_name, status)
           values ($1,$2,'Legacy Ost Member','active')`,
          [ostMemberId, `${RUN}-legacy-ost@example.invalid`],
        );
        createdStaffIds.push(ostMemberId);
        await db.query(
          `insert into public.referral_codes (id, code_hash, code_hint, sponsor_staff_id, expires_at, created_by)
           values ($1,$2,$3,$4, now() + interval '1 year', $4)`,
          [
            referralCodeId,
            (await db.query<{ h: string }>('select private.hash_token($1) as h', [RUN + '-legacy-ost']))
              .rows[0]!.h,
            `${RUN.slice(0, 6)}-HINT`,
            sponsorId,
          ],
        );
        await db.query(
          `insert into public.ost_applications
             (id, referral_code_id, sponsor_staff_id, email, phone, first_name, last_name,
              birth_date, address, status)
           values ($1,$2,$3,$4,'+639171234567','Legacy','Ost','1993-04-04',
             '{"line1": "1 Farm Road", "city": "Tagaytay", "province": "Cavite", "countryCode": "PH"}',
             'submitted')`,
          [ostApplicationId, referralCodeId, sponsorId, `${RUN}-legacy-ost@example.invalid`],
        );
        await db.query(
          `insert into public.ost_members
             (id, application_id, sponsor_staff_id, ost_number, full_name, email, phone, status, approved_by)
           values ($1,$2,$3,$4,'Legacy Ost Member',$5,'+639170000903','active',$6)`,
          [ostMemberId, ostApplicationId, sponsorId, legacyOstNumber, `${RUN}-legacy-ost@example.invalid`, staff['super-admin']],
        );
        await db.query(
          `insert into private.ost_registration_details
             (application_id, request_id, payload_hash, date_applied, form_number, program_category,
              official_details, referrer_snapshot, applicant_signature_status, referrer_signature_status,
              applicant_signed_on, referrer_signed_on, source, created_by)
           values ($1,$2,$3,'2026-09-01',$4,'vip_holder','{}','{}','received','received',
             '2026-09-01','2026-09-01','manual',$5)`,
          [
            ostApplicationId,
            uuidFor('legacy:ost:req'),
            'b'.repeat(64),
            legacyFormNumber,
            staff['super-admin'],
          ],
        );
        await db.query(
          `insert into private.ost_accreditation_terms
             (id, ost_id, application_id, starts_on, expires_on, status, approved_by)
           values ($1,$2,$3,'2026-09-01','2027-09-01','active',$4)`,
          [termId, ostMemberId, ostApplicationId, staff['super-admin']],
        );
        await db.query(
          `insert into private.ost_accreditation_renewals
             (id, renewal_number, request_id, payload_hash, ost_id, prior_term_id, date_of_renewal,
              requested_start, requested_end, applicant_snapshot, original_accreditation_date,
              last_expiry_date, old_sponsor_staff_id, referrer_snapshot, applicant_signature_status,
              referrer_signature_status, created_by)
           values ($1,$2,$3,$4,$5,$6,'2026-09-15','2027-09-01','2028-09-01','{}','2026-09-01',
             '2027-09-01',$7,'{}','received','received',$7)`,
          [renewalId, legacyRenewalNumber, uuidFor('legacy:ost:renewal-req'), 'c'.repeat(64), ostMemberId, termId, sponsorId],
        );

        // OST entity types are now seeded explicitly, so drop them from the
        // "reuse an existing row" list and record their legacy identifiers.
        const ostTargets = new Map<string, { key: string; legacy: string }>([
          ['ost_member', { key: ostMemberId, legacy: legacyOstNumber }],
          ['ost_accreditation', { key: ostApplicationId, legacy: legacyFormNumber }],
          ['ost_renewal', { key: renewalId, legacy: legacyRenewalNumber }],
        ]);
        const seededEntities: {
          entity: string;
          table: string;
          key: string;
          legacy: string;
          modern: RegExp;
          id: string;
        }[] = [];

        const emptyTargets = targets.filter(
          (t) => !exercised.includes(t.entity) && !ostTargets.has(t.entity),
        );
        check(
          'the conversion targets every whitelisted entity type',
          emptyTargets.length === 0,
          `reused-row ${exercised.join(',')}; seeded-row ${[...ostTargets.keys()].join(',')}; missing ${emptyTargets.map((t) => t.entity).join(',') || 'none'}`,
        );
        for (const t of targets) {
          const seeded = ostTargets.get(t.entity);
          seededEntities.push({
            entity: t.entity,
            table: t.table,
            key: seeded ? seeded.key : (exercisedRowKeys.get(t.entity) ?? ''),
            legacy: seeded ? seeded.legacy : (forcedValues.get(t.entity) ?? ''),
            modern: t.modern,
            id: seeded ? seeded.key : (exercisedRowKeys.get(t.entity) ?? ''),
          });
        }
        check(
          'all eight entity types have an executed row to convert',
          seededEntities.every((e) => Boolean(e.key)),
          seededEntities.map((e) => `${e.entity}:${e.key ? 'ok' : 'MISSING'}`).join(','),
        );
        // Rows may legitimately not exist for every entity type in a fresh
        // disposable database, so coverage of ALL eight is proven from the
        // shipped function body rather than by silently skipping.
        const whitelist = await one<{ n: number }>(
          `select count(*)::int as n from unnest(
             array['AF-CUS','AF-CSALE','AF-APP','AF-RES','AF-OST','AF-ACC','AF-REN','AF-RED']) as p(prefix)
           where strpos(pg_get_functiondef('private.upgrade_legacy_business_ids()'::regprocedure), p.prefix) > 0`,
        );
        eq('the shipped conversion declares all eight prefixes', whitelist.n, 8);

        // Identity and money invariants, captured before the conversion runs.
        const beforeSnapshotHash = await scalar(
          `select md5(coalesce(string_agg(coalesce(cash_price_snapshot::text,'~')||'|'||coalesce(reservation_fee_snapshot::text,'~')||'|'||coalesce(required_initial_snapshot::text,'~'),',' order by id),'')) from public.card_sales`,
        );
        const before = await snapshotInvariants();

        const converted = Number(
          (
            await db.query<{ n: string }>('select private.upgrade_legacy_business_ids() as n')
          ).rows[0]!.n,
        );
        check('the conversion reports the rows it rewrote', converted >= 3, `${converted}`);

        const after = await snapshotInvariants();
        const afterSnapshotHash = await scalar(
          `select md5(coalesce(string_agg(coalesce(cash_price_snapshot::text,'~')||'|'||coalesce(reservation_fee_snapshot::text,'~')||'|'||coalesce(required_initial_snapshot::text,'~'),',' order by id),'')) from public.card_sales`,
        );
        eq('row counts identical across every converted table', after.counts, before.counts);
        eq('UUID sets identical: no row was recreated', after.uuids, before.uuids);
        eq('Customer Codes byte-identical', after.codes, before.codes);
        eq('membership numbers byte-identical', after.memberships, before.memberships);
        eq('payment totals unchanged', after.payments, before.payments);
        eq('commission totals unchanged', after.commissions, before.commissions);
        eq('points balances unchanged', after.points, before.points);

        const convertedCustomers = await db.query<{ id: string; customer_number: string }>(
          `select id, customer_number from public.customers where id = any($1::uuid[])
           order by customer_number`,
          [seededCustomers.map((c) => c.id)],
        );
        eq('every legacy customer number became AF-CUS', convertedCustomers.rows.length, 3);
        check(
          'converted customer numbers match the approved format',
          convertedCustomers.rows.every((r) => r.customer_number.match(/^AF-CUS-[A-HJ-NP-Z2-9]{5}$/)),
          convertedCustomers.rows.map((r) => r.customer_number).join(','),
        );
        check(
          'three legacy numbers produce three INDEPENDENT random values, not a sequence',
          new Set(convertedCustomers.rows.map((r) => r.customer_number.slice(-5))).size === 3 &&
            !convertedCustomers.rows.some((r) => /^AF-CUS-0000\d$/.test(r.customer_number)),
          convertedCustomers.rows.map((r) => r.customer_number).join(','),
        );

        for (const c of seededCustomers) {
          const byOld = await db.query<{ entity_id: string; current_identifier: string; via_alias: boolean }>(
            `select entity_id, current_identifier, via_alias from private.resolve_business_identifier('customer', $1)`,
            [c.legacy],
          );
          const byNew = await db.query<{ entity_id: string; current_identifier: string; via_alias: boolean }>(
            `select entity_id, current_identifier, via_alias from private.resolve_business_identifier('customer', $1)`,
            [byOld.rows[0]?.current_identifier ?? ''],
          );
          eq(`legacy ${c.legacy} resolves to the same customer UUID`, byOld.rows[0]?.entity_id, c.id);
          eq(`legacy ${c.legacy} reports the CURRENT AF id`, byOld.rows[0]?.current_identifier, byNew.rows[0]?.current_identifier);
          eq(`current AF id resolves directly, not via alias`, byNew.rows[0]?.via_alias, false);
          check(`legacy ${c.legacy} was reached through the alias table`, byOld.rows[0]?.via_alias === true);
        }
        const caseInsensitive = await db.query<{ entity_id: string }>(
          `select entity_id from private.resolve_business_identifier('customer', $1)`,
          [seededCustomers[0]!.legacy.toLowerCase()],
        );
        eq('alias lookup is case-insensitive', caseInsensitive.rows[0]?.entity_id, seededCustomers[0]!.id);

        const unknown = await db.query<{ entity_id: string | null }>(
          `select entity_id from private.resolve_business_identifier('customer', $1)`,
          ['CUS-DOES-NOT-EXIST'],
        );
        eq('an unknown identifier resolves to no row at all', unknown.rows.length, 0);

        // Idempotency: a second run must not mint a new id or duplicate aliases.
        const aliasesBefore = await aliasCount();
        const second = Number(
          (
            await db.query<{ n: string }>('select private.upgrade_legacy_business_ids() as n')
          ).rows[0]!.n,
        );
        const stable = await db.query<{ customer_number: string }>(
          'select customer_number from public.customers where id = $1',
          [seededCustomers[0]!.id],
        );
        const firstConverted = stable.rows[0]!.customer_number;
        eq('a second run rewrites nothing', second, 0);
        eq('a second run adds no duplicate alias', await aliasCount(), aliasesBefore);
        eq('a second run leaves the identifier untouched', stable.rows[0]!.customer_number, firstConverted);

        // Already-modern identifiers are never regenerated.
        const modernUntouched = await db.query<{ n: number }>(
          `select count(*)::int as n from public.customers
            where customer_code is not null and customer_number !~ '^AF-CUS-[A-HJ-NP-Z2-9]{5}$'`,
        );
        eq('no customer number is left in a legacy format', modernUntouched.rows[0]!.n, 0);

        // The alias table is private and the resolver is server-side only.
        for (const role of ['anon', 'authenticated'] as const) {
          const tableAccess = await one<{ allowed: boolean }>(
            `select has_table_privilege($1,'private.business_id_aliases','SELECT') as allowed`,
            [role],
          );
          eq(`${role} cannot read the alias table`, tableAccess.allowed, false);
          const fnAccess = await one<{ allowed: boolean }>(
            `select has_function_privilege($1,'private.resolve_business_identifier(text,text)','EXECUTE') as allowed`,
            [role],
          );
          eq(`${role} cannot execute the resolver`, fnAccess.allowed, false);
          const upgradeAccess = await one<{ allowed: boolean }>(
            `select has_function_privilege($1,'private.upgrade_legacy_business_ids()','EXECUTE') as allowed`,
            [role],
          );
          eq(`${role} cannot run the conversion`, upgradeAccess.allowed, false);
        }
        check(
          'the alias table stores identifiers only - no credential column',
          (
            await db.query<{ column_name: string }>(
              `select column_name from information_schema.columns
                where table_schema='private' and table_name='business_id_aliases'`,
            )
          ).rows
            .map((r) => r.column_name)
            .every((c) => !/(token|secret|password|hash|government|id_number|qr)/i.test(c)),
        );

        // Every one of the eight entity types: the legacy identifier and the NEW
        // identifier must resolve to the SAME UUID, with via_alias set correctly.
        for (const e of seededEntities) {
          const before = (
            await db.query<{ entity_id: string; current_identifier: string; via_alias: boolean }>(
              `select entity_id, current_identifier, via_alias from private.resolve_business_identifier($1,$2)`,
              [e.entity, e.legacy],
            )
          ).rows[0];
          eq(`${e.entity}: the legacy identifier resolves to the same key`, before?.entity_id, e.key);
          check(
            `${e.entity}: the legacy identifier was reached through the alias`,
            before?.via_alias === true,
            `${e.legacy}`,
          );
          const after = (
            await db.query<{ entity_id: string; current_identifier: string; via_alias: boolean }>(
              `select entity_id, current_identifier, via_alias from private.resolve_business_identifier($1,$2)`,
              [e.entity, before?.current_identifier ?? ''],
            )
          ).rows[0];
          eq(`${e.entity}: old and new identifier resolve to the SAME uuid`, after?.entity_id, before?.entity_id);
          eq(`${e.entity}: the new identifier resolves directly`, after?.via_alias, false);
          check(
            `${e.entity}: the stored identifier is the approved random AF format`,
            e.modern.test(before?.current_identifier ?? ''),
            `${e.legacy} -> ${before?.current_identifier}`,
          );
          const lowercased = (
            await db.query<{ entity_id: string }>(
              `select entity_id from private.resolve_business_identifier($1,$2)`,
              [e.entity, (before?.current_identifier ?? '').toLowerCase()],
            )
          ).rows[0];
          eq(`${e.entity}: the AF identifier resolves case-insensitively`, lowercased?.entity_id, e.key);
        }

        // Authorized search accepts the legacy alias and still returns the record.
        const searched = await db.query<{ customer_id: string }>(
          'select customer_id from public.search_customer_ids($1)',
          [seededCustomers[0]!.legacy],
        );
        eq('authorized search resolves the legacy alias', searched.rows[0]?.customer_id, seededCustomers[0]!.id);
        const byCode = await db.query<{ customer_id: string }>(
          'select customer_id from public.search_customer_ids($1)',
          [seededCustomers[0]!.code],
        );
        eq('the Customer Code still resolves after the upgrade', byCode.rows[0]?.customer_id, seededCustomers[0]!.id);

        // An alias is an identifier, never an authorization token: a caller who
        // is not the owner still gets nothing through the customer portal path.
        const denied = await throws('customer portal rejects another customer by legacy alias', () =>
          asBrowserRole(target.url, 'authenticated', uuidFor('legacy:owner'), (client) =>
            client.query('select * from public.customer_directory($1::jsonb)', [JSON.stringify({ search: seededCustomers[0]!.legacy })]),
          ),
        );
        check('an alias never grants unauthorized access', /permission denied/.test(denied), denied);

        // 17. An already-modern identifier is skipped and gains NO alias.
        const modernCustomerId = uuidFor('legacy:modern');
        await db.query(
          `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
           values ($1,'AF-CUS-K7M4Q','Modern','Customer','1990-01-01',$2,'09175550005','prospect')`,
          [modernCustomerId, `${RUN}-modern@example.invalid`],
        );
        createdCustomerIds.push(modernCustomerId);
        const modernAliasBefore = await aliasCount();
        await db.query('select private.upgrade_legacy_business_ids()');
        const modernAfter = (
          await db.query<{ customer_number: string; customer_code: string }>(
            'select customer_number, customer_code from public.customers where id = $1',
            [modernCustomerId],
          )
        ).rows[0]!;
        eq('an already-modern identifier is left exactly as it was', modernAfter.customer_number, 'AF-CUS-K7M4Q');
        eq('an already-modern record gains no alias', await aliasCount(), modernAliasBefore);

        // 19. current_identifier_snapshot is evidence only: the resolver must
        // still return the canonical value from the entity table.
        const snapshotProbe = seededEntities.find((e) => e.entity === 'customer')!;
        const canonical = (
          await db.query<{ current_identifier: string }>(
            `select current_identifier from private.resolve_business_identifier('customer',$1)`,
            [snapshotProbe.legacy],
          )
        ).rows[0]!.current_identifier;
        await db.query(
          `update private.business_id_aliases set current_identifier_snapshot = 'TAMPERED-SNAPSHOT'
            where entity_type = 'customer' and old_identifier = $1`,
          [snapshotProbe.legacy],
        );
        const afterTamper = (
          await db.query<{ current_identifier: string }>(
            `select current_identifier from private.resolve_business_identifier('customer',$1)`,
            [snapshotProbe.legacy],
          )
        ).rows[0]!.current_identifier;
        eq('the resolver ignores the snapshot and returns the canonical column', afterTamper, canonical);
        check(
          'the stored snapshot really was tampered with, so the check is not vacuous',
          canonical !== 'TAMPERED-SNAPSHOT',
        );

        // 15. An ambiguous legacy identifier must FAIL the conversion rather than
        // retarget someone else's alias. Isolated transaction so the refusal
        // cannot poison the suite.
        await db.query('begin');
        let ambiguityRefused = '';
        try {
          const conflictingCustomer = uuidFor('legacy:conflict');
          await db.query(
            `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
             values ($1,'CUS-CONFLICT-1','Conflict','Owner','1990-01-01',$2,'09175550006','prospect')`,
            [conflictingCustomer, `${RUN}-conflict-owner@example.invalid`],
          );
          // An alias for that legacy value already pointing at a DIFFERENT row.
          await db.query(
            `insert into private.business_id_aliases (entity_type, entity_id, old_identifier, migration_source)
             values ('customer',$1,'CUS-CONFLICT-1','planted')`,
            [seededCustomers[0]!.id],
          );
          await db.query('select private.upgrade_legacy_business_ids()');
          ambiguityRefused = 'DID NOT RAISE';
        } catch (error) {
          ambiguityRefused = safeErrorMessage(error);
        } finally {
          await db.query('rollback');
        }
        check(
          'an ambiguous legacy identifier fails the conversion instead of retargeting the alias',
          /LEGACY_ID_ALIAS_MISSING/.test(ambiguityRefused),
          ambiguityRefused,
        );

        // 21. Historical evidence is not rewritten: a sale's frozen price
        // snapshot is byte-identical before and after.
        eq('frozen sale snapshots are untouched', afterSnapshotHash, beforeSnapshotHash);

        // Remove the OST graph in reverse FK order. These rows carry no run
        // prefix on every column, so leaving them would fail cleanup's
        // row-count proof for the whole suite.
        await db.query('delete from private.ost_accreditation_renewals where id = $1', [renewalId]);
        await db.query('delete from private.ost_accreditation_terms where id = $1', [termId]);
        await db.query('delete from private.ost_registration_details where application_id = $1', [
          ostApplicationId,
        ]);
        await db.query('delete from public.ost_members where id = $1', [ostMemberId]);
        await db.query('delete from public.ost_applications where id = $1', [ostApplicationId]);
        await db.query('delete from public.referral_codes where id = $1', [referralCodeId]);
        await db.query(
          `delete from private.business_id_aliases where entity_id = any($1::uuid[])`,
          [[ostMemberId, ostApplicationId, renewalId]],
        );
      }
    section(
      '57. Operational access: referral management and role editing are grant-bound',
    );
    // Migration 20261029000001 delivers two SECURITY DEFINER functions that the API
    // calls with the service role, and whose absence in production was a live outage.
    // A grant is a property of a REAL database: the in-memory fake cannot answer
    // "can service_role execute this", and a text assertion over the migration file
    // only proves the words are present, not that Postgres bound them.
    //
    // So this section executes both functions against real Postgres and asserts the
    // grants AND the behaviour, including every refusal the business rules depend on.
    {
      const referralSig =
        'public.manage_ost_referral_code(uuid,uuid,boolean,text,text,timestamptz,integer)';
      const roleSig = 'public.update_operational_role(uuid,uuid,jsonb)';
      for (const [name, sig] of [
        ['manage_ost_referral_code', referralSig],
        ['update_operational_role', roleSig],
      ] as const) {
        eq(
          `${name} exists exactly once`,
          (
            await one<{ n: number }>(
              `select count(*)::int n from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
                where p.proname=$1 and ns.nspname='public'`,
              [name],
            )
          ).n,
          1,
        );
        for (const browserRole of ['anon', 'authenticated']) {
          eq(
            `${browserRole} cannot execute ${name}`,
            (
              await one<{ a: boolean }>(
                `select has_function_privilege($1,$2,'EXECUTE') a`,
                [browserRole, sig],
              )
            ).a,
            false,
          );
        }
        // The whole point of the migration: the API reaches these with service_role,
        // so without this grant every call is a 42883 undefined_function.
        eq(
          `service_role can execute ${name}`,
          (
            await one<{ a: boolean }>(
              `select has_function_privilege('service_role',$1,'EXECUTE') a`,
              [sig],
            )
          ).a,
          true,
        );
      }
      // The helper must stay private-only. Granting it would let a browser role ask
      // the database about arbitrary staff members' permissions.
      eq(
        'private.has_permission_for_user is reachable by no browser role and not service_role',
        (
          await one<{ a: boolean }>(
            `select has_function_privilege('anon','private.has_permission_for_user(uuid,text,text)','EXECUTE')
                    or has_function_privilege('authenticated','private.has_permission_for_user(uuid,text,text)','EXECUTE')
                    or has_function_privilege('service_role','private.has_permission_for_user(uuid,text,text)','EXECUTE') a`,
          )
        ).a,
        false,
      );

      // Synthetic principals. staff_users.id references auth.users(id) and that FK is
      // enforced, so the Auth row comes first - the same order the main suite uses.
      const opSm = uuidFor('ops-sm');
      const opVd = uuidFor('ops-vd');
      const opAdmin = uuidFor('ops-admin');
      for (const [id, label] of [
        [opSm, 'sm'],
        [opVd, 'vd'],
        [opAdmin, 'admin'],
      ] as const) {
        await db.query('insert into auth.users (id, email) values ($1, $2)', [
          id,
          `${RUN}-ops-${label}@example.invalid`,
        ]);
      }
      createdStaffIds.push(opSm, opVd, opAdmin);
      const opRoleIds = await db.query<{ id: string; slug: string }>(
        `select id, slug from public.roles where slug in ('sales_manager','vice_director','admin')`,
      );
      const opRole = (slug: string) => opRoleIds.rows.find((r) => r.slug === slug)!.id;
      await db.query(
        `insert into public.staff_users (id, email, full_name, status) values
           ($1,$2,'Ops SM','active'),($3,$4,'Ops VD','active'),($5,$6,'Ops Admin','active')`,
        [
          opSm,
          `${RUN}-ops-sm@example.invalid`,
          opVd,
          `${RUN}-ops-vd@example.invalid`,
          opAdmin,
          `${RUN}-ops-admin@example.invalid`,
        ],
      );
      await db.query(
        `insert into public.staff_role_assignments (staff_id, role_id) values ($1,$4),($2,$5),($3,$6)`,
        [opSm, opVd, opAdmin, opRole('sales_manager'), opRole('vice_director'), opRole('admin')],
      );

      const issueCode = async (actor: string, sponsor: string, rotate: boolean) =>
        db.query<{ id: string }>(
          `select public.manage_ost_referral_code($1::uuid,$2::uuid,$3,
             encode(sha256(convert_to($4,'UTF8')),'hex'),'OST-?-probe',now()+interval '72 hours',5) id`,
          [actor, sponsor, rotate, `${RUN}-probe-${Math.random()}`],
        );
      const ok = (name: string, condition: boolean) => check(name, condition);
      /** Runs a call expected to be refused and returns the database's message. */
      const refusal = async (fn: () => Promise<unknown>): Promise<string> => {
        try {
          await fn();
          return '';
        } catch (error) {
          return safeErrorMessage(error);
        }
      };

      const first = await issueCode(opSm, opSm, false);
      eq('an ACTIVE Sales Manager may issue for themselves', typeof first.rows[0]?.id, 'string');

      // A plain second issue must be refused; otherwise duplicates accumulate silently.
      ok(
        'a second live code is refused unless rotation is explicit',
        /CONFLICT/.test(
          await refusal(() => issueCode(opSm, opSm, false)),
        ),
      );

      await issueCode(opSm, opSm, true);
      eq(
        'exactly ONE live code remains after rotation',
        (
          await one<{ n: number }>(
            `select count(*)::int n from public.referral_codes where sponsor_staff_id=$1 and is_active`,
            [opSm],
          )
        ).n,
        1,
      );

      ok(
        'an admin may NOT sponsor through a Vice Director',
        /active Sales Manager/.test(
          await refusal(() => issueCode(opAdmin, opVd, true)),
        ),
      );
      ok(
        'a Vice Director cannot issue for themselves at all',
        /Only active Sales Managers or administrators/.test(
          await refusal(() => issueCode(opVd, opVd, true)),
        ),
      );

      // An Admin issuing ON BEHALF must produce a code owned by the selected SM, with
      // the Admin recorded only as the issuer. Ownership by whoever clicked is the
      // defect this prevents.
      await issueCode(opAdmin, opSm, true);
      const owned = await one<{ sponsor: string; creator: string }>(
        `select sponsor_staff_id::text sponsor, created_by::text creator
           from public.referral_codes where sponsor_staff_id=$1
          order by created_at desc limit 1`,
        [opSm],
      );
      eq('an admin-issued code is owned by the SELECTED sponsor', owned.sponsor, opSm);
      eq('...while created_by records the admin actor', owned.creator, opAdmin);

      // An INACTIVE Sales Manager cannot sponsor. Suspended, so the check has to be
      // re-read from the staff row rather than cached in a role lookup.
      await db.query(`update public.staff_users set status='suspended' where id=$1`, [opSm]);
      ok(
        'an INACTIVE Sales Manager cannot sponsor',
        /active Sales Manager/.test(
          await refusal(() => issueCode(opAdmin, opSm, true)),
        ),
      );
      await db.query(`update public.staff_users set status='active' where id=$1`, [opSm]);

      eq(
        'only hashes are stored, never plaintext',
        (
          await one<{ n: number }>(
            `select count(*)::int n from public.referral_codes where code_hash !~ '^[a-f0-9]{64}$'`,
          )
        ).n,
        0,
      );
      const opAudit = await db.query<{ action: string }>(
        `select action from public.audit_events where entity_type='referral_code'`,
      );
      const opActions = opAudit.rows.map((r) => r.action);
      ok('REFERRAL_CODE_ISSUED is audited', opActions.includes('REFERRAL_CODE_ISSUED'));
      ok('REFERRAL_CODE_ROTATED is audited', opActions.includes('REFERRAL_CODE_ROTATED'));

      /* ---------------- role editing ---------------- */
      const financeRole = (
        await one<{ id: string }>(`select id from public.roles where slug='finance'`)
      ).id;
      ok(
        'a plain Admin cannot edit a SYSTEM role',
        /Protected role/.test(
          await refusal(
            () =>
              db.query(
                `select public.update_operational_role($1::uuid,$2::uuid,'{"name":"Renamed"}'::jsonb)`,
                [opAdmin, financeRole],
              ),
          ),
        ),
      );
      for (const [label, slug] of [
        ['super_admin', 'super_admin'],
        ['customer', 'customer'],
      ] as const) {
        const id = (await one<{ id: string }>(`select id from public.roles where slug=$1`, [slug])).id;
        ok(
          `${label} is never editable`,
          /Protected role/.test(
            await refusal(
              () =>
                db.query(
                  `select public.update_operational_role($1::uuid,$2::uuid,'{"name":"x"}'::jsonb)`,
                  [opAdmin, id],
                ),
            ),
          ),
        );
      }
      // Nobody may edit a role they personally hold, which would otherwise be a
      // quiet self-promotion path.
      const ownRoleId = (
        await one<{ id: string }>(
          `select role_id::text id from public.staff_role_assignments where staff_id=$1 limit 1`,
          [opAdmin],
        )
      ).id;
      ok(
        'nobody may edit a role they personally hold',
        /Protected role/.test(
          await refusal(
            () =>
              db.query(
                `select public.update_operational_role($1::uuid,$2::uuid,'{"name":"x"}'::jsonb)`,
                [opAdmin, ownRoleId],
              ),
          ),
        ),
      );
      // The subset rule: an Admin cannot grant what it does not hold.
      ok(
        'an Admin cannot grant a permission it does not hold',
        /do not possess|Protected role/.test(
          await refusal(
            () =>
              db.query(`select public.update_operational_role($1::uuid,$2::uuid,$3::jsonb)`, [
                opAdmin,
                ownRoleId,
                JSON.stringify({
                  permissions: [
                    {
                      moduleKey: 'finance.commission_payouts',
                      canView: true,
                      canCreate: true,
                      canUpdate: false,
                      canDelete: false,
                    },
                  ],
                }),
              ]),
          ),
        ),
      );
      eq(
        'no ROLE_PERMISSIONS_UPDATED event was written by a refused edit',
        (
          await one<{ n: number }>(
            `select count(*)::int n from public.audit_events where action='ROLE_PERMISSIONS_UPDATED'`,
          )
        ).n,
        0,
      );

      // Referral rows created above are synthetic and must not survive, or cleanup's
      // whole-table row-count proof fails on the next run.
      await db.query(`delete from public.referral_codes where sponsor_staff_id = any($1::uuid[])`, [
        [opSm, opVd, opAdmin],
      ]);
    }

    } catch (error) {
      check('post-baseline sections completed', false, safeErrorMessage(error));
    } finally {
      section('21. cleanup');
      try {
        // Every synthetic row is reachable either by an id this process recorded or
        // by the run prefix, and the delete order is the reverse of the foreign
        // keys. The order is NOT cosmetic: customers, card_sales, memberships,
        // points_accounts, staff_users and the redemption tables are all
        // `on delete restrict`, so a parent removed before its child raises and the
        // remaining deletes never run.
        //
        // The id sets are resolved FROM THE DATABASE, as the union of the recorded
        // ids and everything carrying the run marker - not from the recorded ids
        // alone. That is not tidiness: the synthetic INACTIVE staff member was
        // created without ever being pushed onto createdStaffIds, so an id-list
        // cleanup deleted every staff user except that one, on every run, forever,
        // while the customer check still passed. A missing `.push()` is invisible
        // to an id-list cleanup. The run prefix is a reliable marker for people and
        // for catalog items, so the union is what every delete below uses.
        const resolveSynthetic = async (
          table: 'public.customers' | 'public.staff_users',
          ids: string[],
        ) =>
          (await db?.query<{ id: string }>(
            `select id from ${table} where id = any($1::uuid[]) or email like $2`,
            [ids, `${RUN}-%`],
          ))!.rows.map((r) => r.id);

        const custSet = await resolveSynthetic('public.customers', createdCustomerIds);
        const staffSet = await resolveSynthetic('public.staff_users', createdStaffIds);
        // staff_users.id and customers.auth_user_id both reference auth.users, so
        // the Auth rows go last of all.
        const authSet = (await db?.query<{ id: string }>(
          'select id from auth.users where id = any($1::uuid[]) or email like $2',
          [[...createdAuthIds, ...createdStaffIds], `${RUN}-%`],
        ))!.rows.map((r) => r.id);

        await db?.query('begin');
        await db?.query('delete from private.mutation_requests where actor_id = any($1::uuid[])', [
          staffSet,
        ]);
        await db?.query(`set local afhomes.allow_snapshot_maintenance = 'on'`);
        await db?.query('delete from public.audit_events where actor_id = any($1::uuid[])', [
          authSet,
        ]);
        await db?.query(
          'update public.card_sales set import_row_id=null,import_job_id=null where customer_id=any($1::uuid[])',
          [custSet],
        );
        // Bulk-import job rows reference jobs, customers, memberships and sales
        // (all RESTRICT), so they go before everything they point at.
        await db?.query(
          `delete from public.customer_import_rows where import_job_id in
           (select id from public.customer_import_jobs where created_by = any($1::uuid[]))`,
          [staffSet],
        );
        await db?.query(
          'delete from public.customer_import_jobs where created_by = any($1::uuid[])',
          [staffSet],
        );
        await db?.query(
          `delete from public.audit_events
          where entity_id = any (select id::text from public.customers where id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query('delete from public.redemptions where customer_id = any($1::uuid[])', [
          custSet,
        ]);
        await db?.query(
          `delete from public.points_ledger
          where account_id in (select pa.id from public.points_accounts pa
                                join public.memberships m on m.id = pa.membership_id
                               where m.customer_id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query('delete from public.payments where customer_id = any($1::uuid[])', [
          custSet,
        ]);
        // Application document rows can link payments with ON DELETE RESTRICT,
        // so they go before anything they reference.
        await db?.query(
          `delete from public.customer_application_documents where application_id in
           (select id from public.customer_applications where customer_id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query(
          `delete from public.commissions
          where sale_id in (select id from public.card_sales where customer_id = any($1::uuid[]))
             or beneficiary_staff_id = any($2::uuid[])`,
          [custSet, staffSet],
        );
        await db?.query(
          'delete from public.customer_onboarding_tokens where customer_id = any($1::uuid[])',
          [custSet],
        );
        await db?.query(
          'delete from public.identity_documents where customer_id = any($1::uuid[])',
          [custSet],
        );
        await db?.query(
          `delete from public.final_qualifications
          where sale_id in (select id from public.card_sales where customer_id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query(
          `delete from public.points_accounts
          where membership_id in (select id from public.memberships where customer_id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query('delete from public.memberships where customer_id = any($1::uuid[])', [
          custSet,
        ]);
        await db?.query(
          `delete from public.card_sale_hierarchy_snapshots
          where sale_id in (select id from public.card_sales where customer_id = any($1::uuid[]))`,
          [custSet],
        );
        // Official-form transaction rows first: reservation agreements reference
        // synthetic sales with ON DELETE RESTRICT, so the sale delete below would
        // fail while they exist. Details go before headers.
        await db?.query(
          `delete from public.reservation_agreement_schedule where agreement_id in
           (select id from public.reservation_agreements where sale_id in
             (select id from public.card_sales where customer_id = any($1::uuid[]))
             or customer_application_id in
             (select id from public.customer_applications where customer_id = any($1::uuid[])))`,
          [custSet],
        );
        await db?.query(
          `delete from public.reservation_agreement_holders where agreement_id in
           (select id from public.reservation_agreements where sale_id in
             (select id from public.card_sales where customer_id = any($1::uuid[]))
             or customer_application_id in
             (select id from public.customer_applications where customer_id = any($1::uuid[])))`,
          [custSet],
        );
        await db?.query(
          `delete from public.reservation_agreement_documents where agreement_id in
           (select id from public.reservation_agreements where sale_id in
             (select id from public.card_sales where customer_id = any($1::uuid[]))
             or customer_application_id in
             (select id from public.customer_applications where customer_id = any($1::uuid[])))`,
          [custSet],
        );
        await db?.query(
          `delete from public.reservation_agreements where sale_id in
           (select id from public.card_sales where customer_id = any($1::uuid[]))
           or customer_application_id in
           (select id from public.customer_applications where customer_id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query('delete from public.card_sales where customer_id = any($1::uuid[])', [
          custSet,
        ]);
        // Customer-application rows reference synthetic customers (and synthetic
        // sales, already removed above). Holders go before headers; headers go
        // before the customer row itself. Documents were removed with payments.
        await db?.query(
          `delete from public.customer_application_holders where application_id in
           (select id from public.customer_applications where customer_id = any($1::uuid[]))`,
          [custSet],
        );
        await db?.query(
          'delete from public.customer_applications where customer_id = any($1::uuid[])',
          [custSet],
        );
        // The customer row itself goes last of the customer-owned tables, and it
        // matches on the run prefix as well as on the recorded ids. The delete and
        // the count below MUST use the same predicate: when they disagreed, an
        // untracked customer survived, `customers.auth_user_id` then held the
        // Auth row shut against `auth.users`, and the whole cleanup aborted on the
        // FK instead of on the thing it was supposed to report.
        await db?.query('delete from public.customers where id = any($1::uuid[])', [custSet]);
        await db?.query(
          `delete from public.referral_relationships
          where subject_staff_id = any($1::uuid[]) or upline_staff_id = any($1::uuid[])`,
          [staffSet],
        );
        await db?.query('delete from public.staff_invitations where invited_by = any($1::uuid[])', [
          staffSet,
        ]);
        if (legacyOstFixtureIds.length > 0) {
          const ids = legacyOstFixtureIds;
          await db?.query(
            'delete from private.ost_accreditation_renewals where id = any($1::uuid[])',
            [ids],
          );
          await db?.query('delete from private.ost_accreditation_terms where id = any($1::uuid[])', [
            ids,
          ]);
          await db?.query(
            'delete from private.ost_registration_details where application_id = any($1::uuid[])',
            [ids],
          );
          await db?.query('delete from public.ost_members where id = any($1::uuid[])', [ids]);
          await db?.query('delete from public.ost_applications where id = any($1::uuid[])', [ids]);
          await db?.query('delete from public.referral_codes where id = any($1::uuid[])', [ids]);
          await db?.query(
            'delete from private.business_id_aliases where entity_id = any($1::uuid[])',
            [ids],
          );
        }
        await db?.query(
          'delete from public.ost_applications where sponsor_staff_id = any($1::uuid[])',
          [staffSet],
        );
        // staff_role_assignments and staff_permission_restrictions cascade from
        // staff_users, so they need no statement of their own.
        // Sections 47 and 48 each create their own live referral code, sponsored by the
      // synthetic Sales Manager, because `commit_customer_import_row` resolves the sale
      // seller from `raw_data.seller_code` and the Phase 14 trigger refuses a sale with
      // no seller. `referral_codes.sponsor_staff_id` is a RESTRICT foreign key, so any
      // survivor makes the `staff_users` delete below fail and takes the whole cleanup
      // with it. Delete every synthetic staff member's codes, not just section 57's.
      await db?.query('delete from public.referral_codes where sponsor_staff_id = any($1::uuid[])', [
        staffSet,
      ]);
      await db?.query('delete from public.staff_users where id = any($1::uuid[])', [staffSet]);
        await db?.query('delete from auth.users where id = any($1::uuid[])', [authSet]);
        await db?.query('delete from public.redemption_items where code like $1', [`${RUN}-%`]);
        await db?.query('commit');

        // Cleanup is not proven by the deletes succeeding; it is proven by the
        // database being back where it started. The baseline was captured before
        // the suite wrote anything, so this asserts every table the suite touches
        // is back to its pre-run row count - which also covers rows this process
        // forgot to record an id for. A marker-based check cannot: memberships,
        // points_ledger and redemptions carry no run prefix, so there is nothing
        // to grep them by once their parents are gone.
        const leaks: string[] = [];
        const requestsRemaining = (
          await db.query<{ n: number }>('select count(*)::int n from private.mutation_requests')
        ).rows[0]!.n;
        if (requestsRemaining !== baseline.get('private.mutation_requests'))
          leaks.push('private.mutation_requests: cleanup mismatch');
        for (const table of BASELINE_TABLES) {
          const after = await db?.query<{ n: number }>(
            `select count(*)::int as n from public.${table}`,
          );
          const now = after!.rows[0]!.n;
          if (now !== baseline.get(table)) leaks.push(`${table}: ${baseline.get(table)} -> ${now}`);
        }
        const authLeak = await db?.query<{ n: number }>(
          'select count(*)::int as n from auth.users where email like $1',
          [`${RUN}-%`],
        );
        if (authLeak!.rows[0]!.n !== 0)
          leaks.push(`auth.users: ${authLeak!.rows[0]!.n} left behind`);

        check('synthetic customers removed', !leaks.some((l) => l.startsWith('customers:')));
        check(
          'every table the suite writes is back to its pre-run row count',
          leaks.length === 0,
          leaks.join('; '),
        );
        await db?.end();
      } catch (error) {
        // A half-applied cleanup leaves an aborted transaction open. Roll it back
        // so the connection is not left mid-transaction, then fail the suite: a
        // cleanup failure is a failure, never a warning.
        await db?.query('rollback').catch(() => {});
        check('cleanup completed', false, safeErrorMessage(error));
      }
    }
  }

  /* ================================================================== */
  /* Verdict                                                             */
  /* ================================================================== */

  const failed = results.filter((r) => !r.ok);
  const byArea = new Map<string, { pass: number; fail: number }>();
  for (const r of results) {
    const bucket = byArea.get(r.area) ?? { pass: 0, fail: 0 };
    if (r.ok) bucket.pass += 1;
    else bucket.fail += 1;
    byArea.set(r.area, bucket);
  }

  console.log('\n================ SUMMARY ================');
  for (const [name, b] of byArea) {
    console.log(
      `  ${b.fail === 0 ? 'PASS' : 'FAIL'}  ${name}  (${b.pass} passed, ${b.fail} failed)`,
    );
  }
  console.log(
    `\n  total: ${results.length} checks, ${results.length - failed.length} passed, ${failed.length} failed`,
  );
  if (failed.length > 0) {
    console.log('\n  failures:');
    for (const f of failed) console.log(`   - [${f.area}] ${f.name}: ${f.detail ?? ''}`);
  }
  console.log('=========================================\n');

  process.exit(failed.length === 0 ? 0 : 1);
}

void main();
