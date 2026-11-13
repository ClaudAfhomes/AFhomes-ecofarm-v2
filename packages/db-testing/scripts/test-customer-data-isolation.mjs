/**
 * Customer data isolation on a disposable PostgreSQL with every migration applied.
 *
 *   node packages/db-testing/scripts/test-customer-data-isolation.mjs
 *
 * Proves, with real `anon` / `authenticated` roles and PostgREST-style JWT
 * claims (transaction-local `request.jwt.claim.*`), that a signed-in customer
 * reads only their own permitted customer/membership columns, cannot read or
 * write anyone else's, cannot reach protected identity/credential columns,
 * inherits no staff permission, and that staff visibility follows the seeded
 * role permissions. Also asserts the effective ACL catalog (no anon access, no
 * PUBLIC-executable SECURITY DEFINER, definer search_path pinned).
 *
 * Loopback disposable server only (lib/local-postgres.mjs); exit code = result.
 */
import { randomUUID } from 'node:crypto';

import { startDisposablePostgres } from './lib/local-postgres.mjs';

let failures = 0;
let passes = 0;
const check = (name, ok, detail = '') => {
  if (ok) passes += 1;
  else failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`);
};
const section = (title) => console.log(`\n== ${title}`);

const pg = await startDisposablePostgres();
const db = pg.client;

/** Run `sql` as a browser role in its own rolled-back transaction. */
async function as(identity, sql, params = []) {
  await db.query('begin');
  try {
    if (identity === 'anon') {
      await db.query('set local role anon');
      await db.query(`select set_config('request.jwt.claim.role', 'anon', true)`);
    } else {
      await db.query('set local role authenticated');
      await db.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`);
      await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [identity]);
    }
    const res = await db.query(sql, params);
    return { rows: res.rows, error: null };
  } catch (error) {
    return { rows: [], error };
  } finally {
    await db.query('rollback').catch(() => {});
  }
}
const denied = (r) => r.error?.code === '42501';
const rejected = (r) => Boolean(r.error);

try {
  /* ------------------------------------------------------------------ */
  section('effective catalog');
  /* ------------------------------------------------------------------ */
  const one = async (sql) => (await db.query(sql)).rows[0];
  const anonTables = await one(`select count(*)::int n from information_schema.role_table_grants
    where grantee = 'anon' and table_schema in ('public','private')`);
  check('anon holds no table privilege in public/private', anonTables.n === 0, String(anonTables.n));
  const anonCols = await one(`select count(*)::int n from information_schema.column_privileges
    where grantee = 'anon' and table_schema in ('public','private')`);
  check('anon holds no column privilege in public/private', anonCols.n === 0, String(anonCols.n));
  const anonFns = await one(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')`);
  check('anon can execute no SECURITY DEFINER function', anonFns.n === 0, String(anonFns.n));
  // SECURITY INVOKER functions keep PostgreSQL's default PUBLIC EXECUTE; they run
  // with anon's own (empty) table privileges. Listed for the audit, not failed.
  const anonInvoker = await db.query(`select n.nspname||'.'||p.proname f from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and not p.prosecdef and has_function_privilege('anon', p.oid, 'execute') order by 1`);
  console.log(`INFO  anon-executable SECURITY INVOKER functions (${anonInvoker.rows.length}): ${anonInvoker.rows.map((x) => x.f).join(', ')}`);
  const publicDefiner = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
      and exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE')`);
  check(
    'no SECURITY DEFINER function is executable by PUBLIC',
    publicDefiner.rows.length === 0,
    publicDefiner.rows.map((r) => r.proname).join(','),
  );
  const unpinned = await db.query(`select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private') and p.prosecdef
      and has_function_privilege('authenticated', p.oid, 'execute')
      and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%pg_temp')`);
  check(
    'every authenticated-callable SECURITY DEFINER pins search_path ending in pg_temp',
    unpinned.rows.length === 0,
    unpinned.rows.map((r) => r.proname).join(','),
  );
  const createPriv = await one(`select bool_or(has_schema_privilege(r, s, 'create')) any
    from unnest(array['anon','authenticated']) r, unnest(array['public','private','extensions']) s`);
  check('browser roles cannot CREATE in public/private/extensions', createPriv.any === false);
  const writeGrants = await one(`select count(*)::int n from information_schema.role_table_grants
    where grantee in ('anon','authenticated','PUBLIC') and table_schema = 'public'
      and table_name in ('customers','memberships','points_accounts','points_ledger')
      and privilege_type <> 'SELECT'`);
  check('no browser write privilege on customers/memberships/points', writeGrants.n === 0, String(writeGrants.n));
  for (const t of ['customers', 'memberships']) {
    const tbl = await one(`select has_table_privilege('authenticated', 'public.${t}', 'select') ok`);
    check(`authenticated has no table-wide SELECT on ${t} (column grants only)`, tbl.ok === false);
  }

  /* ------------------------------------------------------------------ */
  section('fixtures (superuser, disposable)');
  /* ------------------------------------------------------------------ */
  const id = () => randomUUID();
  const U = {
    custA: id(), custB: id(), custNoLink: id(),
    ost: id(), sm: id(), finance: id(), admin: id(), hr: id(), gsd: id(),
  };
  for (const [label, uid] of Object.entries(U))
    await db.query('insert into auth.users (id, email) values ($1, $2)', [uid, `${label.toLowerCase()}@example.invalid`]);
  const roleId = async (slug) => (await db.query('select id from public.roles where slug = $1', [slug])).rows[0].id;
  for (const [label, slug] of [['ost', 'ost'], ['sm', 'sales_manager'], ['finance', 'finance'], ['admin', 'admin'], ['hr', 'hr'], ['gsd', 'employee']]) {
    await db.query(`insert into public.staff_users (id, email, full_name, status) values ($1, $2, $3, 'active')`,
      [U[label], `${label}@example.invalid`, `Isolation ${label}`]);
    await db.query('insert into public.staff_role_assignments (staff_id, role_id) values ($1, $2)', [U[label], await roleId(slug)]);
  }
  const C = { A: id(), B: id() };
  const num = async () => (await db.query('select * from public.next_customer_number()')).rows[0].customer_number;
  for (const [k, auth, vip] of [['A', U.custA, '90000000001B1C01S'], ['B', U.custB, '90000000002B1C01S']]) {
    await db.query(
      `insert into public.customers (id, auth_user_id, customer_number, first_name, last_name, birth_date, email, phone, status,
         government_id_type, government_id_number, notes, tin_number, vip_card_number, referral_code_used)
       values ($1,$2,$3,$4,'Isolation','1990-01-01',$5,'09170000000','active','passport',$6,'internal note','123-456',$7,'REF-X')`,
      [C[k], auth, await num(), `Cust${k}`, `cust${k.toLowerCase()}@example.invalid`, `GOV-SECRET-${k}`, vip],
    );
  }
  const plan = (await db.query(`select * from public.card_plans where code = 'BRONZE'`)).rows[0];
  const M = {};
  // Read-isolation fixture only: the sale workflow (hierarchy, payment,
  // activation) is proven elsewhere (supabase/db-integration.ts). Business
  // triggers are suspended for these superuser inserts alone so the rows exist;
  // every assertion below runs with triggers, RLS and grants fully active.
  await db.query('begin');
  await db.query('set local session_replication_role = replica');
  for (const k of ['A', 'B']) {
    const sale = id();
    M[k] = id();
    const sn = (await db.query('select * from public.next_sale_number()')).rows[0].sale_number;
    await db.query(
      `insert into public.card_sales (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id, cash_price,
         cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot, commission_rate_snapshot,
         expected_commission_snapshot, status, submitted_at, balance_due_at)
       values ($1,$2,$3,$4,'staff',$5,$6,$6,$7,$8,$9,'0.00','submitted', now(), now() + interval '365 days')`,
      [sale, sn, C[k], plan.id, U.sm, plan.cash_price, plan.minimum_down_payment, plan.yearly_points, plan.commission_rate],
    );
    await db.query(
      `insert into public.memberships (id, customer_id, sale_id, membership_number, status, activated_at, expires_at,
         activated_by, qr_token_hash, fallback_code_hash, product_id)
       values ($1,$2,$3,$4,'active',now(),now() + interval '1 year',$5,$6,$7,$8)`,
      [M[k], C[k], sale, `ISO-MEM-${k}`, U.finance, (k === 'A' ? 'a' : 'c').repeat(64), (k === 'A' ? 'b' : 'd').repeat(64), plan.product_id ?? null],
    );
    await db.query('insert into public.points_accounts (membership_id) values ($1)', [M[k]]);
  }
  await db.query('commit');
  check('two customers with activated memberships seeded', Boolean(M.A && M.B && M.A !== M.B));
  const hashes = await one(`select count(*)::int n from public.memberships where id in ('${M.A}','${M.B}') and qr_token_hash is not null`);
  check('seeded memberships carry credential hashes (so denial is meaningful)', hashes.n === 2, String(hashes.n));

  /* ------------------------------------------------------------------ */
  section('Customer A versus Customer B');
  /* ------------------------------------------------------------------ */
  const PROFILE = 'id, customer_number, first_name, last_name, email, phone, status, auth_user_id';
  let r = await as(U.custA, `select ${PROFILE} from public.customers`);
  check('A sees exactly one customer row: their own', !r.error && r.rows.length === 1 && r.rows[0].id === C.A, r.error?.message ?? JSON.stringify(r.rows.map((x) => x.id)));
  r = await as(U.custA, `select id from public.customers where id = $1`, [C.B]);
  check('A filtering by B id gets zero rows', !r.error && r.rows.length === 0);
  r = await as(U.custA, `select id, customer_id, status, membership_number, activated_at, expires_at, points_balance from public.memberships`);
  check('A sees exactly their own membership', !r.error && r.rows.length === 1 && r.rows[0].id === M.A, r.error?.message ?? JSON.stringify(r.rows));
  check('A own membership carries status/activation/expiry', r.rows[0]?.status === 'active' && Boolean(r.rows[0]?.activated_at), JSON.stringify(r.rows[0]));
  r = await as(U.custA, `select id from public.memberships where id = $1 or customer_id = $2`, [M.B, C.B]);
  check('A cannot read B membership by id or customer_id', !r.error && r.rows.length === 0);
  r = await as(U.custA, `select pa.id from public.points_accounts pa where pa.membership_id = $1`, [M.B]);
  check('A cannot read B points account', !r.error && r.rows.length === 0);
  r = await as(U.custB, `select id from public.customers`);
  check('B sees exactly their own customer row', !r.error && r.rows.length === 1 && r.rows[0].id === C.B);
  r = await as(U.custNoLink, `select id from public.customers`);
  check('auth user with no linked customer sees zero customers', !r.error && r.rows.length === 0);
  r = await as(U.custNoLink, `select id from public.memberships`);
  check('auth user with no linked customer sees zero memberships', !r.error && r.rows.length === 0);

  /* ------------------------------------------------------------------ */
  section('protected columns (direct browser access)');
  /* ------------------------------------------------------------------ */
  for (const col of ['government_id_number', 'government_id_type', 'referred_by_staff_id', 'referral_code_used', 'notes', 'tin_number', 'created_by', 'vip_card_number', 'ra_number']) {
    r = await as(U.custA, `select ${col} from public.customers where id = $1`, [C.A]);
    check(`A cannot select own customers.${col} directly`, denied(r), r.error?.message ?? 'returned rows');
  }
  for (const col of ['qr_token_hash', 'fallback_code_hash', 'activated_by', 'card_issued_by']) {
    r = await as(U.custA, `select ${col} from public.memberships where id = $1`, [M.A]);
    check(`A cannot select own memberships.${col} directly`, denied(r), r.error?.message ?? 'returned rows');
  }
  r = await as(U.custA, `select * from public.customers`);
  check('select * on customers is refused for a customer', denied(r));
  r = await as(U.custA, `select * from public.memberships`);
  check('select * on memberships is refused for a customer', denied(r));
  r = await as(U.custA, `select actor_id from public.points_ledger`);
  check('A cannot select points_ledger.actor_id', denied(r));

  /* ------------------------------------------------------------------ */
  section('writes are refused');
  /* ------------------------------------------------------------------ */
  r = await as(U.custA, `update public.customers set email = 'x@example.invalid' where id = $1`, [C.B]);
  check('A cannot update B customer', denied(r), r.error?.message ?? 'no error');
  r = await as(U.custA, `update public.customers set first_name = 'Mallory' where id = $1`, [C.A]);
  check('A cannot update even own customer row directly', denied(r));
  r = await as(U.custA, `update public.customers set auth_user_id = $1 where id = $2`, [U.custA, C.B]);
  check('A cannot re-link B customer to their auth user', denied(r));
  r = await as(U.custA, `update public.memberships set status = 'active' where id = $1`, [M.B]);
  check('A cannot update B membership', denied(r));
  r = await as(U.custA, `delete from public.memberships where id = $1`, [M.B]);
  check('A cannot delete B membership', denied(r));
  r = await as(U.custA, `insert into public.memberships (customer_id) values ($1)`, [C.A]);
  check('A cannot insert a membership', denied(r));
  r = await as(U.custA, `insert into public.customers (customer_number, first_name, last_name, email, phone) values ('X','Y','Z','z@example.invalid','0')`);
  check('A cannot insert a customer', denied(r));
  const intact = await one(`select (select count(*)::int from public.customers where auth_user_id = '${U.custB}') b, (select email from public.customers where id = '${C.B}') e`);
  check('B record unchanged after A attempts', intact.b === 1 && intact.e === 'custb@example.invalid');

  /* ------------------------------------------------------------------ */
  section('anonymous');
  /* ------------------------------------------------------------------ */
  for (const t of ['customers', 'memberships', 'points_accounts', 'points_ledger', 'card_sales', 'payments', 'customer_applications', 'reservation_agreements']) {
    r = await as('anon', `select id from public.${t} limit 1`);
    check(`anon cannot read ${t}`, denied(r), r.error?.message ?? `${r.rows.length} rows`);
  }
  r = await as('anon', `select public.afhomes_self_customer_profile()`);
  check('anon cannot execute afhomes_self_customer_profile', denied(r));
  r = await as('anon', `select private.has_permission('sales.customers')`);
  check('anon cannot execute private.has_permission', denied(r));

  /* ------------------------------------------------------------------ */
  section('customers inherit no staff permission');
  /* ------------------------------------------------------------------ */
  const KEYS = ['sales.customers', 'sales.card_sales', 'finance.payment_verification', 'finance.card_activation', 'finance.points', 'operations.redemption', 'organization.staff', 'organization.roles'];
  for (const who of ['custA', 'custNoLink']) {
    r = await as(U[who], `select k, private.has_permission(k, a) ok from unnest($1::text[]) k, unnest(array['view','create','update','delete']) a`, [KEYS]);
    check(`${who}: has_permission false for every staff module/action`, !r.error && r.rows.every((x) => x.ok === false), r.error?.message ?? JSON.stringify(r.rows.filter((x) => x.ok)));
  }
  for (const t of ['card_sales', 'payments', 'customer_applications', 'reservation_agreements', 'staff_users', 'commissions']) {
    r = await as(U.custA, `select count(*)::int n from public.${t}`);
    check(`customer A reads zero ${t} rows`, (!r.error && r.rows[0].n === 0) || denied(r), r.error?.message ?? String(r.rows[0]?.n));
  }

  /* ------------------------------------------------------------------ */
  section('staff visibility follows seeded role permissions');
  /* ------------------------------------------------------------------ */
  const expectation = {
    ost: { customers: 2, memberships: 2 },      // ost baseline: sales.customers view
    sm: { customers: 2, memberships: 2 },       // sales.customers
    finance: { customers: 2, memberships: 2 },  // sales.customers + finance.*
    admin: { customers: 2, memberships: 2 },
    hr: { customers: 0, memberships: 0 },       // no customer module
  };
  for (const [who, exp] of Object.entries(expectation)) {
    const c = await as(U[who], `select count(*)::int n from public.customers where id in ($1,$2)`, [C.A, C.B]);
    const m = await as(U[who], `select count(*)::int n from public.memberships where id in ($1,$2)`, [M.A, M.B]);
    check(`${who}: sees ${exp.customers} seeded customers`, !c.error && c.rows[0].n === exp.customers, c.error?.message ?? String(c.rows[0]?.n));
    check(`${who}: sees ${exp.memberships} seeded memberships`, !m.error && m.rows[0].n === exp.memberships, m.error?.message ?? String(m.rows[0]?.n));
    const g = await as(U[who], `select government_id_number from public.customers limit 1`);
    check(`${who}: direct government_id_number read refused`, denied(g));
    const h = await as(U[who], `select qr_token_hash from public.memberships limit 1`);
    check(`${who}: direct qr_token_hash read refused`, denied(h));
  }
  await db.query(`update public.staff_users set status = 'inactive' where id = $1`, [U.sm]);
  r = await as(U.sm, `select count(*)::int n from public.customers where id in ($1,$2)`, [C.A, C.B]);
  check('inactive SM loses customer visibility', !r.error && r.rows[0].n === 0, r.error?.message ?? String(r.rows[0]?.n));
  await db.query(`update public.staff_users set status = 'active' where id = $1`, [U.sm]);

  /* ------------------------------------------------------------------ */
  section('caller-bound RPCs');
  /* ------------------------------------------------------------------ */
  r = await as(U.custA, `select public.afhomes_self_customer_profile() p`);
  const prof = JSON.stringify(r.rows[0]?.p ?? null);
  check('self profile RPC returns A data only', !r.error && prof.includes(C.A) && !prof.includes(C.B), r.error?.message ?? prof.slice(0, 200));
  check('self profile RPC does not leak government id', !prof.includes('GOV-SECRET'), prof.slice(0, 300));
  r = await as(U.custNoLink, `select public.afhomes_self_customer_profile() p`);
  check('self profile RPC returns no customer for an unlinked user', rejected(r) || !JSON.stringify(r.rows[0]?.p ?? null).includes('Isolation'), JSON.stringify(r.rows[0]));
  r = await as(U.custA, `select public.preview_customer_reissue($1)`, [M.B]);
  check('A cannot reissue B membership credentials', rejected(r), JSON.stringify(r.rows));
  const bHash = await one(`select qr_token_hash from public.memberships where id = '${M.B}'`);
  check('B credential unchanged', Boolean(bHash.qr_token_hash));
  r = await as(U.custA, `select public.preview_staff_resolve_member($1)`, ['90000000002B1C01S']);
  check('customer cannot call staff resolve-member RPC', rejected(r), JSON.stringify(r.rows).slice(0, 200));
  r = await as(U.custA, `select public.preview_staff_purchases($1, false, 1)`, [C.B]);
  check('customer cannot list B purchases via staff RPC with forged customer_id', rejected(r), JSON.stringify(r.rows).slice(0, 200));
  r = await as(U.custA, `select public.preview_staff_adjust_points($1, 1000, 'forged')`, [M.A]);
  check('customer cannot adjust own points via staff RPC', rejected(r), JSON.stringify(r.rows).slice(0, 200));
  r = await as(U.custA, `select public.preview_staff_create_purchase($1, '[]'::jsonb, 'x', false)`, [M.B]);
  check('customer cannot create a purchase on B membership', rejected(r), JSON.stringify(r.rows).slice(0, 200));
  r = await as(U.custA, `select public.preview_customer_claim_preview($1)`, ['f'.repeat(64)]);
  check('unknown onboarding token preview discloses nothing', rejected(r) || !JSON.stringify(r.rows).includes('Isolation'), JSON.stringify(r.rows).slice(0, 200));
  r = await as(U.custA, `select private.can_read_identity_document($1)`, [randomUUID()]);
  check('identity-document gate is false for a customer on an unknown id', (!r.error && r.rows[0].can_read_identity_document === false) || rejected(r));
  const bypass = await one(`select pg_get_functiondef('private.mutation_actor_role(uuid,text,text)'::regprocedure) ~ 'mutation_test_cleanup_allowed' b,
    to_regprocedure('private.mutation_test_cleanup_allowed()') is not null h`);
  check('mutation_actor_role carries no test-cleanup bypass (helper dropped)', bypass.b === false && bypass.h === false, JSON.stringify(bypass));

  /* ------------------------------------------------------------------ */
  section('application / RA child tables');
  /* ------------------------------------------------------------------ */
  for (const t of ['customer_application_holders', 'customer_application_documents', 'reservation_agreement_holders', 'reservation_agreement_documents', 'reservation_agreement_schedule']) {
    const rls = await one(`select relrowsecurity r from pg_class where oid = 'public.${t}'::regclass`);
    check(`${t} has RLS enabled`, rls.r === true);
    r = await as(U.custA, `select count(*)::int n from public.${t}`);
    check(`customer A reads zero ${t} rows`, (!r.error && r.rows[0].n === 0) || denied(r), r.error?.message ?? String(r.rows[0]?.n));
    r = await as('anon', `select count(*)::int n from public.${t}`);
    check(`anon cannot read ${t}`, denied(r));
  }

  /* ------------------------------------------------------------------ */
  section('observations (reported, not pass/fail: policy or Preview-mode gaps)');
  /* ------------------------------------------------------------------ */
  const info = (name, value) => console.log(`INFO  ${name}: ${value}`);
  r = await as(U.custA, `select m.id, c.vip_card_number from public.memberships m join public.customers c on c.id = m.customer_id`);
  info('Preview /customer/membership embed (customers.vip_card_number) as customer', r.error ? `${r.error.code} ${r.error.message}` : `${r.rows.length} rows`);
  r = await as(U.custA, `select count(*)::int n from public.card_plans`);
  info('card_plans rows visible to a customer (card_plans!inner embed)', r.error ? r.error.code : r.rows[0].n);
  r = await as(U.custA, `select public.afhomes_self_customer_profile() ? 'vipCardNumber' has`);
  info('afhomes_self_customer_profile exposes vipCardNumber', r.error ? r.error.code : r.rows[0].has);
  r = await as(U.gsd, `select count(*)::int n from public.memberships where id in ($1,$2)`, [M.A, M.B]);
  info('GSD (employee) memberships visible via RLS', r.error ? r.error.code : r.rows[0].n);
  r = await as(U.gsd, `select public.preview_staff_resolve_member($1) ->> 'customerDisplayName' n`, ['ISO-MEM-B']);
  info('GSD direct-RPC resolve of B by membership number (no DB-side throttle)', r.error ? `${r.error.code} ${r.error.message}` : r.rows[0].n);
  const mine = await one(`select (regexp_replace(pg_get_functiondef('public.preview_staff_purchases(uuid,boolean,integer)'::regprocedure), '^.*?\\$function\\$', '', 's') ~ 'p_mine_only') used`);
  info('preview_staff_purchases body references p_mine_only', mine.used);
} catch (error) {
  failures += 1;
  console.error('FAIL  unexpected error:', error);
} finally {
  await pg.stop();
}

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
