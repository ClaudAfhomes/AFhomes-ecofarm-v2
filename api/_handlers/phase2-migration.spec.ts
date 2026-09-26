/**
 * AF Homes Phase 2 - migration invariants and the role authorization matrix.
 *
 * Two things are proven here that a handler test cannot prove on its own:
 *
 *  1. The MIGRATION SQL actually contains the load-bearing rules. The
 *     transactional RPCs are PL/pgSQL and cannot execute in-process, so their
 *     semantics are pinned structurally here - the activation invariant, the
 *     SELECT-only browser posture, and the deny-only RLS scopes.
 *  2. EVERY role in the selling hierarchy plus Finance, Admin and Super Admin
 *     is refused or allowed consistently across every Phase 2 endpoint.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  CUSTOMER,
  LINKS,
  PRODUCT,
  SALE,
  STAFF2,
  TOKEN,
  TOKEN2,
  UUID,
  moduleId,
  phase2World,
  phase2WorldTokens,
  UNIQUE,
} from '../_lib/testing/phase2-fixtures.js';
import { FakeSupabase, makeReq, makeRes } from '../_lib/testing/supabase-fake.js';

const MIGRATIONS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../supabase/migrations',
);

const read = (prefix: string) => {
  const file = fs
    .readdirSync(MIGRATIONS)
    .filter((n) => n.startsWith(prefix) && n.endsWith('.sql'))
    .sort()[0];
  if (!file) throw new Error(`no migration starting with ${prefix}`);
  return fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
};

const schema = read('20260927000001');
const rls = read('20260927000002');
const rpc = read('20260927000003');
const support = read('20260927000004');
/** Every function body, whichever migration declares it. */
const allSql = `${rpc}\n${support}`;
/** SQL with `--` line comments and `comment on ...` statements removed. */
const allCode = allSql
  .replace(/comment on [\s\S]*?;/g, '')
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

/* ================================================================== */
/* Migration invariants                                                */
/* ================================================================== */

describe('every Phase 2 business table has row level security', () => {
  const NEW_TABLES = [
    'referral_relationships',
    'points_accounts',
    'points_ledger',
    'customer_onboarding_tokens',
  ];

  it.each(NEW_TABLES)('enables RLS on %s and revokes anon/authenticated', (table) => {
    expect(rls).toContain(`'${table}'`);
    expect(rls).toContain('alter table public.%I enable row level security');
    expect(rls).toContain('revoke all on public.%I from anon, authenticated');
  });

  it('grants authenticated only SELECT on the new tables', () => {
    const grants = rls.match(/grant\s+(\w+)\s+on\s+public\.\w+\s+to\s+authenticated/g) ?? [];
    expect(grants.length).toBeGreaterThan(0);
    for (const grant of grants) expect(grant).toMatch(/^grant select /);
  });

  it('keeps onboarding tokens completely unreachable from a browser role', () => {
    expect(rls).toMatch(
      /revoke all on public\.customer_onboarding_tokens from anon, authenticated/,
    );
    // No policy, and no grant, may reference the token table.
    expect(rls).not.toMatch(/create policy[^\n]*customer_onboarding_tokens/);
  });

  it('never widens identity_documents to Finance', () => {
    const policy = rls.match(/create policy identity_documents[\s\S]*?;/);
    expect(policy?.[0] ?? '').not.toContain('finance.');
  });

  it('routes every new read policy through private.has_permission()', () => {
    const policies = rls.match(/create policy \w+[\s\S]*?;/g) ?? [];
    expect(policies.length).toBeGreaterThan(4);
    for (const policy of policies) {
      if (policy.includes('auth.uid()')) continue;
      expect(policy, policy.slice(0, 60)).toContain('private.has_permission');
    }
  });

  it('keeps the customer self-read and the seller self-read in the predicates', () => {
    expect(rls).toMatch(/create policy customers_read[\s\S]*?auth\.uid\(\)/);
    expect(rls).toMatch(/create policy card_sales_read[\s\S]*?seller_staff_id = \(select auth\.uid\(\)\)/);
  });
});

describe('the schema migration freezes commercial terms and identity', () => {
  it('replaces the sale status CHECK with the documented lifecycle', () => {
    expect(schema).toContain('card_sales_status_check');
    for (const state of [
      'draft',
      'submitted',
      'payment_pending',
      'payment_in_progress',
      'payment_verified',
      'activation_pending',
      'active',
      'cancelled',
      'overdue',
    ]) {
      expect(schema).toContain(`'${state}'`);
    }
  });

  it('replaces the commission status CHECK with the 4% lifecycle', () => {
    expect(schema).toMatch(/commissions_status_check[\s\S]*'final_qualification_pending'/);
    expect(schema).toMatch(/commissions_status_check[\s\S]*'earned'/);
  });

  it('constrains the customer status to a person-level lifecycle', () => {
    expect(schema).toMatch(
      /customers_status_check\s+check \(status in \('prospect', 'active', 'suspended', 'cancelled'\)\)/,
    );
  });

  it('requires a CHECK regex on every money column it adds', () => {
    for (const column of [
      'cash_price_snapshot',
      'minimum_down_payment_snapshot',
      'expected_commission_snapshot',
      'basis_amount_snapshot',
      'rate_snapshot',
      'commission_rate_snapshot',
    ]) {
      expect(schema, column).toMatch(
        new RegExp(`${column}[\\s\\S]{0,200}?~ '\\^`),
      );
    }
  });

  it('allows at most one active upline per subject and many downlines per upline', () => {
    expect(schema).toMatch(
      /create unique index referral_relationships_one_active_upline[\s\S]*?on public\.referral_relationships \(subject_staff_id\)\s+where is_active/,
    );
    // A plain index (not unique) on the upline side: many downlines are legal.
    expect(schema).toMatch(/create index referral_relationships_upline_idx/);
  });

  it('forbids a self-referencing upline', () => {
    expect(schema).toMatch(/check \(subject_staff_id <> upline_staff_id\)/);
  });

  it('allows only one open application per customer and product', () => {
    expect(schema).toMatch(
      /create unique index card_sales_one_open_per_customer[\s\S]*?on public\.card_sales \(customer_id, plan_id\)\s+where status in/,
    );
  });

  it('registers the same government ID only once', () => {
    expect(schema).toMatch(/create unique index if not exists customers_gov_id_unique/);
    expect(schema).toMatch(/where government_id_number is not null/);
  });

  it('rejects a duplicate payment reference on the same sale', () => {
    expect(schema).toMatch(
      /create unique index if not exists payments_sale_reference_unique[\s\S]*?on public\.payments \(sale_id, reference\)\s+where reference is not null/,
    );
  });

  it('keeps exactly one commission per sale', () => {
    expect(schema).toMatch(
      /create unique index if not exists commissions_one_per_sale on public\.commissions \(sale_id\)/,
    );
  });

  it('keeps the points ledger append-only and allocates once per membership-year', () => {
    expect(schema).toMatch(/create unique index if not exists points_ledger_one_allocation_per_year/);
    expect(schema).toContain('Append-only points history');
  });

  it('requires the commission beneficiary to be exactly one of staff or OST', () => {
    expect(schema).toMatch(/constraint commissions_beneficiary_check/);
  });

  it('stores identifier hashes, never plaintext', () => {
    expect(schema).toMatch(/qr_token_hash text unique/);
    expect(schema).toMatch(/fallback_code_hash/);
  });

  it('adds only the two new modules and reuses the existing module keys', () => {
    expect(schema).toMatch(/insert into public\.modules[\s\S]*'sales\.uplines'/);
    expect(schema).toMatch(/insert into public\.modules[\s\S]*'finance\.points'/);
    const inserted = schema.match(/insert into public\.modules[\s\S]*?on conflict/)?.[0] ?? '';
    expect(inserted.match(/'[a-z]+\.[a-z_]+'/g) ?? []).toHaveLength(2);
  });
});

describe('the RPC migration keeps money server-computed and activation gated', () => {
  it('never uses float or real types in executable code', () => {
    // Comments are stripped first: the money helper's comment explains that no
    // float participates, and that sentence must not be read as usage.
    expect(allCode).not.toMatch(/\breal\b/);
    expect(allCode).not.toMatch(/\bfloat[48]?\b/);
    expect(rpc).toMatch(/round\(value, 2\)/);
  });

  it('formats money with two decimals without to_char', () => {
    expect(rpc).toContain('function private.money(value numeric)');
    expect(rpc).not.toMatch(/private\.money\([^)]*to_char/);
    // to_char is used only for a number sequence and a display timestamp.
    const moneyFn = rpc.slice(
      rpc.indexOf('function private.money'),
      rpc.indexOf('function private.hash_token'),
    );
    expect(moneyFn).not.toContain('to_char');
  });

  it('re-checks full verified payment INSIDE the activation transaction', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.activate_card_sale'),
      rpc.indexOf('function public.correct_referral_upline'),
    );
    // The sum is recomputed from the payment rows, not trusted from the caller.
    expect(fn).toMatch(/select coalesce\(sum\(\(amount\)::numeric\), 0\) into v_verified/);
    expect(fn).toMatch(/where sale_id = v_sale\.id and status = 'verified'/);
    expect(fn).toMatch(/if v_verified < v_price then[\s\S]*?SALE_NOT_FULLY_PAID/);
    // The guard precedes the membership insert.
    expect(fn.indexOf('SALE_NOT_FULLY_PAID')).toBeLessThan(fn.indexOf('insert into public.memberships'));
  });

  it('locks the sale row before reading money', () => {
    expect(rpc).toMatch(/from public\.card_sales where id = p_sale_id for update/);
  });

  it('is idempotent: an existing membership short-circuits before any insert', () => {
    const fn = rpc.slice(rpc.indexOf('function public.activate_card_sale'));
    const guard = fn.indexOf('select * into v_existing from public.memberships where sale_id');
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(fn.indexOf('insert into public.memberships'));
    expect(fn).toMatch(
      /if found then[\s\S]*?return query[\s\S]*?yearly_points_allocated::bigint, true;[\s\S]*?return;\s*end if;/,
    );
  });

  it('allocates points in the same transaction as activation', () => {
    const fn = rpc.slice(rpc.indexOf('function public.activate_card_sale'));
    const order = [
      'insert into public.memberships',
      'insert into public.points_accounts',
      'insert into public.points_ledger',
      "set status = 'active', activated_at = now()",
    ].map((needle) => fn.indexOf(needle));
    expect(order.every((i) => i > -1)).toBe(true);
    expect([...order]).toEqual([...order].sort((a, b) => a - b));
  });

  it('advances a commission to awaiting-qualification but never to earned', () => {
    const fn = rpc.slice(rpc.indexOf('function public.activate_card_sale'));
    expect(fn).toMatch(/set status = 'final_qualification_pending'/);
    expect(fn).not.toMatch(/set status = 'earned'/);
    expect(fn).not.toMatch(/earned_at = now\(\)/);
  });

  it('computes the spot-cash deadline once, server-side, from the first verified payment', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.verify_card_payment'),
      rpc.indexOf('function public.activate_card_sale'),
    );
    expect(fn).toMatch(/if p_decision = 'verified' and v_deadline is null then/);
    expect(fn).toMatch(/v_deadline := now\(\) \+ interval '7 days'/);
    // Recorded money must never open the window.
    expect(fn.slice(0, fn.indexOf('if p_decision'))).not.toContain("interval '7 days'");
  });

  it('counts only verified money toward the price', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.verify_card_payment'),
      rpc.indexOf('function public.activate_card_sale'),
    );
    expect(fn).toMatch(/where sale_id = v_sale\.id and status = 'verified'/);
  });

  it('advances the commission to payment_verified only on full payment', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.verify_card_payment'),
      rpc.indexOf('function public.activate_card_sale'),
    );
    const guard = fn.indexOf('if v_fully_paid then');
    const update = fn.indexOf("set status = 'payment_verified'");
    expect(guard).toBeGreaterThan(-1);
    expect(update).toBeGreaterThan(guard);
  });

  it('marks a sale fully paid only from verified totals', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.verify_card_payment'),
      rpc.indexOf('function public.activate_card_sale'),
    );
    expect(fn).toMatch(/v_fully_paid := v_verified >= v_price/);
    expect(fn).toMatch(/set status = 'payment_verified',[\s\S]*?fully_paid_at = now\(\)/);
  });

  it('never allows recorded money to be marked verified by the recorder', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.record_card_payment'),
      rpc.indexOf('function public.verify_card_payment'),
    );
    // The insert always writes status 'recorded', whatever the caller sent.
    expect(fn).toMatch(/'recorded', p_actor_id, now\(\)/);
    expect(fn).not.toMatch(/p_status/);
  });

  it('audits the payment mutations inside the same function', () => {
    const record = rpc.slice(
      rpc.indexOf('function public.record_card_payment'),
      rpc.indexOf('function public.verify_card_payment'),
    );
    expect(record).toContain("'PAYMENT_RECORDED'");
    const verify = rpc.slice(
      rpc.indexOf('function public.verify_card_payment'),
      rpc.indexOf('function public.activate_card_sale'),
    );
    expect(verify).toContain("'PAYMENT_VERIFIED'");
    expect(verify).toContain("'PAYMENT_REJECTED'");
    expect(verify).toContain("'SALE_FULLY_PAID'");
  });

  it('makes every mutating function SECURITY DEFINER with a pinned search_path', () => {
    const mutators = [
      'public.record_card_payment',
      'public.verify_card_payment',
      'public.activate_card_sale',
      'public.correct_referral_upline',
      'public.issue_customer_onboarding_token',
    ];
    for (const name of mutators) {
      const body = allSql.slice(allSql.indexOf(`function ${name}`));
      const segment = body.slice(0, body.indexOf('$$;'));
      expect(segment, name).toContain('security definer');
      expect(segment, name).toContain('set search_path = public, private, pg_temp');
    }
  });

  it('grants the mutating functions to nobody but the service role', () => {
    for (const name of [
      'public.record_card_payment(',
      'public.verify_card_payment(',
      'public.activate_card_sale(',
      'public.correct_referral_upline(',
      'public.next_customer_number(',
      'public.next_sale_number(',
      'public.issue_customer_onboarding_token(',
    ]) {
      const revokes = allSql.match(
        new RegExp(
          `revoke all on function ${name.replace(/[.(]/g, '\\$&')}[^;]*from public, anon, authenticated;`,
          'g',
        ),
      );
      expect(revokes, name).not.toBeNull();
    }
  });

  it('keeps the hashing helpers out of reach of browser roles', () => {
    for (const helper of [
      'private.money(numeric)',
      'private.hash_token(text)',
      'private.new_fallback_code()',
      'private.new_qr_token()',
    ]) {
      expect(rpc, helper).toContain(
        `revoke all on function ${helper} from public, anon, authenticated;`,
      );
    }
  });

  it('never stores a plaintext identifier', () => {
    expect(rpc).toMatch(/private\.hash_token\(v_fallback\), private\.hash_token\(v_qr\)/);
    // The plain values are only ever returned, never written.
    expect(rpc).not.toMatch(/insert into public\.memberships[^;]*v_qr,/);
  });

  it('generates identifiers with real entropy, not sequential ids', () => {
    expect(rpc).toMatch(/encode\(gen_random_bytes\(32\), 'base64'\)/);
    expect(rpc).toMatch(/encode\(gen_random_bytes\(4\), 'hex'\)/);
  });

  it('retires the old relationship atomically when correcting an upline', () => {
    const fn = rpc.slice(
      rpc.indexOf('function public.correct_referral_upline'),
      rpc.indexOf('Grants'),
    );
    const retire = fn.indexOf('set is_active = false');
    const insert = fn.indexOf('insert into public.referral_relationships');
    expect(retire).toBeGreaterThan(-1);
    expect(insert).toBeGreaterThan(retire);
    expect(fn).toMatch(/for update/);
    expect(fn).toContain("'UPLINE_CORRECTED'");
  });

  it('exposes the read-only summary to authenticated callers only', () => {
    expect(rpc).toContain('revoke all on function public.sale_financial_summary(uuid) from public, anon;');
    expect(rpc).toContain(
      'grant execute on function public.sale_financial_summary(uuid) to authenticated;',
    );
  });

  it('retires any outstanding onboarding token before issuing a new one', () => {
    const fn = support.slice(support.indexOf('function public.issue_customer_onboarding_token'));
    expect(fn).toMatch(/set consumed_at = now\(\)[\s\S]*?and consumed_at is null/);
  });

  it('requires an active customer before an account-activation token', () => {
    const fn = support.slice(support.indexOf('function public.issue_customer_onboarding_token'));
    expect(fn).toMatch(/p_purpose = 'account_activation' and v_customer\.status <> 'active'/);
  });

  it('allocates customer and sale numbers from sequences, not counts', () => {
    expect(support).toContain("nextval('public.customer_number_seq')");
    expect(support).toContain("nextval('public.sale_number_seq')");
  });
});

/* ================================================================== */
/* Role matrix                                                         */
/* ================================================================== */

const holder = vi.hoisted(() => ({ db: null as unknown }));

vi.mock('../_lib/rest.js', () => ({
  serviceClient: () => holder.db,
  anonClient: () => holder.db,
  requireService: () => holder.db,
  okList: () => {},
  methodNotAllowed: () => {},
  readJsonBody: () => ({ ok: true as const, body: {} }),
}));

const handlers = {
  cards: (await import('./cards.js')).default,
  customers: (await import('./customers.js')).default,
  sales: (await import('./sales.js')).default,
  memberships: (await import('./memberships.js')).default,
  commissions: (await import('./commissions.js')).default,
  referrals: (await import('./referrals.js')).default,
  queues: (await import('./queues.js')).default,
};

let rpcCounter = 0;
function install(overrides: Record<string, unknown[]> = {}) {
  rpcCounter += 1;
  holder.db = new FakeSupabase({
    tables: phase2World(overrides as never),
    tokens: phase2WorldTokens(),
    unique: UNIQUE,
    links: LINKS as never,
    // The transactional functions cannot run in-process; this matrix is about
    // WHO may call them, so a permissive scripted result is enough.
    rpcs: [
      { fn: 'next_customer_number', result: { customer_number: `CUS-8${rpcCounter}0000` } },
      { fn: 'next_sale_number', result: { sale_number: `SALE-8${rpcCounter}0000` } },
      { fn: 'record_card_payment', result: 'scripted-payment' },
      { fn: 'activate_card_sale', result: [{ membership_id: 'x', membership_number: 'MBS-1', fallback_code: null, qr_token: null, points_allocated: 0, already_active: false }] },
      { fn: 'verify_card_payment', result: [{ sale_id: 'x', status: 'payment_in_progress', verified_total: '0.00', remaining_balance: '0.00', fully_paid: false, spot_cash_deadline: null }] },
    ],
  });
  return holder.db as FakeSupabase;
}

async function call(
  family: keyof typeof handlers,
  options: { path: string; method?: string; token?: string; body?: unknown; query?: Record<string, string> },
) {
  const { res, state } = makeRes();
  await handlers[family](
    makeReq({
      method: options.method ?? 'GET',
      familyPath: options.path,
      body: options.body,
      token: options.token,
      query: options.query,
    }) as never,
    res as never,
  );
  return state.status;
}

/** One representative endpoint per permission. */
const MATRIX = [
  { label: 'read catalogue', family: 'cards', options: { path: '' } },
  { label: 'read customers', family: 'customers', options: { path: '' } },
  {
    label: 'create a sale',
    family: 'sales',
    options: {
      method: 'POST',
      path: '',
      body: { customerId: CUSTOMER.prospect, productId: PRODUCT.bronze },
    },
  },
  {
    label: 'record a payment',
    family: 'sales',
    options: {
      method: 'POST',
      path: `sales/${SALE.unpaid}/payments`,
      body: { amount: '100.00', paymentType: 'installment', method: 'cash' },
    },
  },
  {
    label: 'activate a sale',
    family: 'sales',
    options: { method: 'POST', path: `sales/${SALE.fullyPaid}/activate`, body: {} },
  },
  { label: 'read the finance queue', family: 'queues', options: { path: 'finance' } },
  { label: 'read the activation queue', family: 'queues', options: { path: 'activation' } },
  { label: 'read commissions', family: 'commissions', options: { path: '' } },
  { label: 'read uplines', family: 'referrals', options: { path: '' } },
  {
    label: 'assign an upline',
    family: 'referrals',
    options: {
      method: 'POST',
      path: '',
      body: { subjectStaffId: STAFF2.ost, uplineStaffId: STAFF2.salesManager, hierarchyRole: 'ost' },
    },
  },
] as const;

describe('Phase 2 role matrix', () => {
  it('a Sales Manager sells and manages customers but never handles money or uplines', async () => {
    install();
    const allowed = new Set<string>();
    for (const entry of MATRIX) {
      const status = await call(entry.family, { ...entry.options, token: TOKEN2.salesManager });
      if (status !== 403) allowed.add(entry.label);
    }
    expect([...allowed]).toEqual(['read catalogue', 'read customers', 'create a sale']);
  });

  it('an OST sells and manages customers, nothing more', async () => {
    install();
    const allowed = new Set<string>();
    for (const entry of MATRIX) {
      const status = await call(entry.family, { ...entry.options, token: TOKEN2.ost });
      if (status !== 403) allowed.add(entry.label);
    }
    expect([...allowed]).toEqual(['read catalogue', 'read customers', 'create a sale']);
  });

  it('a Vice Director holds no selling or finance permission in this phase', async () => {
    install();
    for (const entry of MATRIX) {
      expect(await call(entry.family, { ...entry.options, token: TOKEN2.viceDirector }), entry.label).toBe(403);
    }
  });

  it('Finance handles payments, activation and points but never creates a sale', async () => {
    install();
    const allowed = new Set<string>();
    for (const entry of MATRIX) {
      const status = await call(entry.family, { ...entry.options, token: TOKEN2.finance });
      if (status !== 403) allowed.add(entry.label);
    }
    expect([...allowed]).toEqual([
      'read customers',
      'record a payment',
      'activate a sale',
      'read the finance queue',
      'read the activation queue',
      'read commissions',
    ]);
  });

  it('an Admin may do every Phase 2 action', async () => {
    install();
    for (const entry of MATRIX) {
      expect(await call(entry.family, { ...entry.options, token: TOKEN.admin }), entry.label).not.toBe(403);
    }
  });

  it('a Super Admin may do every Phase 2 action', async () => {
    install();
    for (const entry of MATRIX) {
      expect(
        await call(entry.family, { ...entry.options, token: TOKEN.superAdmin }),
        entry.label,
      ).not.toBe(403);
    }
  });

  it('an HR account with no Phase 2 permission is refused everywhere', async () => {
    install();
    for (const entry of MATRIX) {
      expect(await call(entry.family, { ...entry.options, token: TOKEN2.hr }), entry.label).toBe(403);
    }
  });

  it('a staff member with no role assignment is refused everywhere', async () => {
    // Authenticated, but the principal has no role: FORBIDDEN, not UNAUTHORIZED.
    install();
    for (const entry of MATRIX) {
      expect(
        await call(entry.family, { ...entry.options, token: TOKEN.unassigned }),
        entry.label,
      ).toBe(403);
    }
  });

  it('a suspended staff account cannot use the business APIs with a valid session', async () => {
    install();
    for (const entry of MATRIX) {
      expect(
        await call(entry.family, { ...entry.options, token: TOKEN.inactive }),
        entry.label,
      ).toBe(403);
    }
  });

  it('a deny-only restriction SUBTRACTS a permission a role otherwise holds', async () => {
    // The Finance role holds finance.payment_verification. A deny-only
    // restriction removes it; the same role keeps everything else.
    const db = install();
    db.rows('staff_permission_restrictions').push({
      staff_id: STAFF2.finance,
      module_id: moduleId('finance.payment_verification'),
      deny_view: false,
      deny_create: false,
      deny_update: true,
      deny_delete: false,
    });

    const record = MATRIX.find((e) => e.label === 'record a payment')!;
    const queue = MATRIX.find((e) => e.label === 'read the finance queue')!;
    expect(await call(record.family, { ...record.options, token: TOKEN2.finance })).toBe(403);
    // A restriction on one action never widens and never removes other rights.
    expect(await call(queue.family, { ...queue.options, token: TOKEN2.finance })).toBe(200);
  });

  it('an unauthenticated caller is refused everywhere', async () => {
    install();
    for (const entry of MATRIX) {
      expect(await call(entry.family, entry.options), entry.label).toBe(401);
    }
  });
});
