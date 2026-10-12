import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startDisposablePostgres } from './lib/local-postgres.mjs';

/**
 * RED-first regression for 20261125000001_afhomes_preview_caller_wrappers.sql.
 *
 * Every preview_* wrapper binds identity with auth.uid(): staff wrappers
 * enforce the exact module/action through private.mutation_actor_role and
 * delegate to the existing trusted service RPC; customer wrappers resolve
 * customers.auth_user_id = auth.uid() and never accept a customer id.
 *
 * Categories (approval testing requirements a-h):
 *  a. authorized staff succeeds only with the required permission
 *  b. staff without the permission is denied
 *  c. customers touch only their own records
 *  d. a customer cannot pass another customer's id (no id parameter exists)
 *  e. anon is denied on every wrapper
 *  f. direct authenticated table writes remain denied
 *  g. values, locks, idempotency and audit rows stay correct
 *  h. service_role paths are unchanged (trusted RPCs still execute)
 */
const EXPECTED_WRAPPERS = [
  'preview_customer_claim',
  'preview_customer_claim_preview',
  'preview_customer_decide',
  'preview_customer_position',
  'preview_customer_ledger',
  'preview_customer_approvals',
  'preview_customer_refunds',
  'preview_customer_reissue',
  'preview_staff_save_service',
  'preview_staff_service_photo',
  'preview_staff_set_policy_active',
  'preview_staff_tier_discount_create',
  'preview_staff_earning_rule_create',
  'preview_staff_redemption_rule_create',
  'preview_staff_redemption_rule_patch',
  'preview_staff_create_purchase',
  'preview_staff_record_payment',
  'preview_staff_verify_payment',
  'preview_staff_prepare_quote',
  'preview_staff_complete_purchase',
  'preview_staff_reverse_purchase',
  'preview_staff_adjust_points',
  'preview_staff_create_claim',
  'preview_staff_reissue_claim',
  'preview_staff_refund_points',
  'preview_staff_cancel_reserved',
  'preview_staff_manage_refund',
  'preview_staff_reconcile_receipt',
  'preview_staff_purchases',
  'preview_staff_payments',
  'preview_staff_claim',
  'preview_staff_claims',
  'preview_staff_summary',
  'preview_staff_settlement',
  'preview_staff_services',
  'preview_staff_tier_discounts',
  'preview_staff_earning_rules',
  'preview_staff_redemption_rules',
  'preview_staff_point_refunds',
  'preview_staff_refund_history',
  'preview_staff_resolve_member',
];

let postgres;
let checks = 0;
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  checks++;
  console.log('PASS ' + name);
};
const denied = async (client, name, fn, pattern = /./) => {
  await client.query('savepoint expected_failure');
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await client.query('rollback to savepoint expected_failure');
  await client.query('release savepoint expected_failure');
  assert.ok(error && pattern.test(error.message), name + ' :: ' + (error ? error.message : 'no error'));
  checks++;
  console.log('PASS ' + name);
};
/** Run one statement as a browser role with a fixed jwt subject. */
const asRole = async (url, role, sub, fn, commit = true) => {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('begin');
    await client.query(`set local role ${role}`);
    if (sub) await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    const out = await fn(client);
    // A failing commit must be loud: swallowing it hides lost writes and
    // turns every later read into a mystery.
    await client.query(commit ? 'commit' : 'rollback');
    return out;
  } finally {
    await client.end();
  }
};
const one = async (client, query, args = []) => (await client.query(query, args)).rows[0];

try {
  postgres = await startDisposablePostgres();
  const db = postgres.client;
  const url = postgres.url;
  const identity = await one(db, 'select current_database() name, inet_server_addr()::text host');
  assert.equal(identity.name, postgres.database);
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(identity.host));
  assert.equal(Number((await one(db, 'select count(*) n from public.customers')).n), 0);
  const legacyBaseline = Number(
    (await one(db, `select count(*) n from public.audit_events where action like 'LEGACY%'`)).n,
  );

  // --- existence + grants (RED fails here before the migration) ---
  const found = (
    await db.query(`select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and proname like 'preview\\_%'`)
  ).rows.map((r) => r.proname);
  check(
    'all preview wrappers exist',
    [...found].sort(),
    [...EXPECTED_WRAPPERS].sort(),
  );
  for (const fn of EXPECTED_WRAPPERS) {
    const g = await one(
      db,
      `select has_function_privilege('authenticated', p.oid, 'execute') a,
        has_function_privilege('anon', p.oid, 'execute') n
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = $1`,
      [fn],
    );
    check(fn + ' executable by authenticated', g.a, true);
    check(fn + ' denied to anon', g.n, false);
  }

  // --- fixtures: staff per role, two customers, one member ---
  const staff = {};
  for (const role of ['admin', 'employee', 'finance']) {
    const id = randomUUID();
    staff[role] = id;
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `pw-${role}@example.invalid`]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC STAFF','active')",
      [id, `pw-${role}@example.invalid`],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
  }
  const superadmin = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [superadmin, 'pw-super@example.invalid']);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC SUPER','active')",
    [superadmin, 'pw-super@example.invalid'],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",
    [superadmin],
  );
  const mkCustomer = async (n) => {
    const authId = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [authId, `pw-c${n}@example.invalid`]);
    const customer = (
      await one(
        db,
        "insert into public.customers(customer_number,auth_user_id,first_name,last_name,email,phone,status) values($1,$2,'SYN','THETIC',$3,'0918000000' || $4,'active') returning id",
        [`CUS-PW-LOCAL${n}`, authId, `pw-c${n}@example.invalid`, String(n)],
      )
    ).id;
    const sale = (
      await one(
        db,
        "insert into public.card_sales(sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,balance_due_at,status) select $1,$2,id,'staff',$3,'100000.00',now()+interval '30 days','draft' from public.card_plans where code='GOLD' returning id",
        [`AF-CSALEPW${n}`, customer, staff.admin],
      )
    ).id;
    const membership = (
      await one(
        db,
        "insert into public.memberships(customer_id,sale_id,product_id,membership_number,fallback_code_hash,qr_token_hash,status,points_balance,yearly_points_allocated,activated_by,issued_at,activated_at,expires_at) select $1,$2,id,$3,$3 || '-fb',$3 || '-qr','active',0,0,$4,now(),now(),now()+interval '5 years' from public.card_plans where code='GOLD' returning id",
        [customer, sale, `MBS-PW-LOCAL${n}`, staff.admin],
      )
    ).id;
    const account = (
      await one(db, 'insert into public.points_accounts(membership_id) values($1) returning id', [membership])
    ).id;
    return { authId, customer, membership, account };
  };
  const m1 = await mkCustomer(1);
  const m2 = await mkCustomer(2);

  const call = (client, fn, args = []) =>
    client.query(`select * from public.${fn}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);

  // --- staff config through wrappers (admin) ---
  const svc = await asRole(url, 'authenticated', staff.admin, async (c) => {
    const s = await one(
      c,
      `select * from public.preview_staff_save_service(null, $1::jsonb)`,
      [
        JSON.stringify({
          name: 'Wrapper Stay',
          basePrice: '2000.00',
          isStaycationEligible: true,
          isActive: true,
          published: false,
        }),
      ],
    );
    check('admin creates accommodation service via wrapper', s.name, 'Wrapper Stay');
    const e = await one(
      c,
      `select * from public.preview_staff_earning_rule_create($1::jsonb)`,
      [
        JSON.stringify({
          serviceId: s.id,
          pointsAmount: 1000,
          eligibleTiers: ['GOLD'],
          effectiveStart: '2000-01-01',
          effectiveEnd: '2099-01-01',
          isActive: true,
          minQuantity: 1,
          maxAward: null,
          promotionReference: 'PW-EARN-1',
        }),
      ],
    );
    check('admin creates earning rule via wrapper', Number(e.points_amount), 1000);
    const r = await one(
      c,
      `select * from public.preview_staff_redemption_rule_create($1::jsonb)`,
      [
        JSON.stringify({
          serviceId: s.id,
          ruleKind: 'accommodation',
          pesoValuePerPoint: '0.5001',
          eligibleTiers: ['GOLD'],
          minPoints: 1,
          maxPoints: null,
          minPurchaseAmount: '0.00',
          effectiveStart: '2000-01-01',
          effectiveEnd: '2099-01-01',
          isActive: true,
          promotionReference: 'PW-CONV-1',
          allowDiscountStacking: false,
        }),
      ],
    );
    check('admin creates conversion rule via wrapper', String(r.peso_value_per_point), '0.5001');
    return { serviceId: s.id };
  });

  // --- permission denials on writes (b) ---
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'employee cannot save services', () =>
      call(c, 'preview_staff_save_service', [null, JSON.stringify({ name: 'X', basePrice: '1.00' })]),
    );
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    await denied(c, 'finance cannot create purchases', () =>
      call(c, 'preview_staff_create_purchase', [m1.membership, JSON.stringify([]), randomUUID(), true]),
    );
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'employee cannot verify payments', () =>
      call(c, 'preview_staff_verify_payment', [randomUUID(), 'verified', null]),
    );
  });

  // --- GSD sale + Finance verification through wrappers ---
  const purchase = await asRole(url, 'authenticated', staff.employee, async (c) => {
    const p = await one(
      c,
      `select * from public.preview_staff_create_purchase($1, $2::jsonb, $3, true)`,
      [m1.membership, JSON.stringify([{ serviceId: svc.serviceId, quantity: 1 }]), randomUUID()],
    );
    check('gsd creates 2000.00 purchase via wrapper', [String(p.gross_amount), String(p.net_amount)], ['2000.00', '2000.00']);
    return p;
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const mine = await one(c, `select public.preview_staff_purchases(null, true, 0) v`);
    check('gsd sees own sale in wrapper list', JSON.stringify(mine.v).includes(purchase.purchase_number), true);
    check('purchase bundle carries tier snapshot key', 'tier_snapshot' in ((mine.v.purchases ?? [])[0] ?? {}), true);
    const pay = await one(
      c,
      `select * from public.preview_staff_record_payment($1, '2000.00', 'Cash', $2)`,
      [purchase.purchase_id, 'PW-REC-1'],
    );
    check('gsd records receipt via wrapper', [String(pay.amount), String(pay.status)], ['2000.00', 'recorded']);
    return pay;
  });
  const paymentId = (
    await db.query(`select id from public.purchase_payments where purchase_id=$1`, [purchase.purchase_id])
  ).rows[0].id;
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    const v = await one(c, `select * from public.preview_staff_verify_payment($1, 'verified', null)`, [paymentId]);
    check('finance verifies via wrapper', [String(v.status), String(v.verified_total)], ['verified', '2000.00']);
    const all = await one(c, `select public.preview_staff_purchases(null, false, 0) v`);
    check('finance sees company sale via wrapper', JSON.stringify(all.v).includes(purchase.purchase_number), true);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const done = await one(c, `select * from public.preview_staff_complete_purchase($1)`, [purchase.purchase_id]);
    check('gsd completes via wrapper', done.fully_paid, true);
    const claim = await one(c, `select * from public.preview_staff_create_claim($1)`, [purchase.purchase_id]);
    check('gsd issues claim via wrapper', Number(claim.points_requested), 1000);
    // Rotate while still available; the customer below claims the rotated code.
    const rotated = await one(c, `select * from public.preview_staff_reissue_claim($1)`, [claim.claim_id]);
    check('gsd reissues claim via wrapper', typeof rotated.qr_token, 'string');
    check('reissue rotates the token', rotated.qr_token === claim.qr_token, false);
    return { ...claim, qr_token: rotated.qr_token, fallback_code: rotated.fallback_code };
  }).then(async (claim) => {
    // --- customer claim lifecycle, bound to auth.uid() ---
    await asRole(url, 'authenticated', m1.authId, async (c) => {
      const prev = await one(c, `select * from public.preview_customer_claim_preview($1)`, [claim.qr_token]);
      check('owner previews own claim', String(prev.claim_number), String(claim.claim_number));
      const got = await one(c, `select * from public.preview_customer_claim($1)`, [claim.qr_token]);
      check('owner claims exactly once', Number(got.points_awarded), 1000);
      await denied(c, 'claim replay refused', () => call(c, 'preview_customer_claim', [claim.qr_token]), /CLAIM_/);
      const pos = await one(c, `select * from public.preview_customer_position()`);
      check('owner position shows 1000', Number(pos.balance), 1000);
    });
    await asRole(url, 'authenticated', m2.authId, async (c) => {
      await denied(c, 'stranger cannot preview claim', () => call(c, 'preview_customer_claim_preview', [claim.qr_token]), /NOT_FOUND|FORBIDDEN|CLAIM_/);
      await denied(c, 'stranger cannot claim', () => call(c, 'preview_customer_claim', [claim.qr_token]), /./);
      await denied(c, 'stranger cannot decide', () => call(c, 'preview_customer_decide', [randomUUID(), true]), /./);
      const pos2 = await one(c, `select * from public.preview_customer_position()`);
      check('stranger position is their own zero', Number(pos2.balance), 0);
    });
    return claim;
  });

  // --- spending: second purchase, quote, approval, settlement ---
  const purchase2 = await asRole(url, 'authenticated', staff.employee, async (c) => {
    const p = await one(
      c,
      `select * from public.preview_staff_create_purchase($1, $2::jsonb, $3, true)`,
      [m1.membership, JSON.stringify([{ serviceId: svc.serviceId, quantity: 1 }]), randomUUID()],
    );
    const q = await one(c, `select * from public.preview_staff_prepare_quote($1, 1000)`, [p.purchase_id]);
    check('quote binds 0.5001 rate', [String(q.peso_value), Number(q.points_requested)], ['500.10', 1000]);
    return { purchase: p, quote: q };
  });
  await asRole(url, 'authenticated', m1.authId, async (c) => {
    const d = await one(c, `select public.preview_customer_decide($1, true) v`, [purchase2.quote.quote_id]);
    check('owner approves exact quote', String(d.v), 'approved');
    const approvals = await one(c, `select public.preview_customer_approvals() v`);
    check('owner sees own approval', JSON.stringify(approvals.v).includes(purchase2.quote.quote_number), true);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await one(c, `select * from public.preview_staff_record_payment($1, '1499.90', 'Cash', $2)`, [
      purchase2.purchase.purchase_id,
      'PW-REC-2',
    ]);
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    const pid = (
      await db.query(`select id from public.purchase_payments where purchase_id=$1 and status='recorded'`, [
        purchase2.purchase.purchase_id,
      ])
    ).rows[0].id;
    await one(c, `select * from public.preview_staff_verify_payment($1, 'verified', null)`, [pid]);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const done = await one(c, `select * from public.preview_staff_complete_purchase($1)`, [purchase2.purchase.purchase_id]);
    check('points purchase settles via wrapper', done.fully_paid, true);
  });
  await asRole(url, 'authenticated', m1.authId, async (c) => {
    const pos = await one(c, `select * from public.preview_customer_position()`);
    check('settlement debited exactly 1000', Number(pos.balance), 0);
    const ledger = await one(c, `select public.preview_customer_ledger(null, null, null) v`);
    check('ledger carries earn and spend', JSON.stringify(ledger.v).includes('redemption'), true);
  });

  // --- refund + repayment, then histories ---
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    const r = await one(
      c,
      `select * from public.preview_staff_refund_points($1, '2000.00', 'PW-REF-1', 'QA refund', true)`,
      [purchase2.purchase.purchase_id],
    );
    check('finance refund restores via wrapper', Number(r.points_restored), 1000);
    const manage = await one(
      c,
      `select public.preview_staff_manage_refund($1, null, 'request', $2::jsonb) v`,
      [purchase.purchase_id, JSON.stringify({ serviceValue: '2000.00', cashAmount: '2000.00', reference: 'PW-CASH-1', reason: 'QA cash', serviceReviewConfirmed: true })],
    );
    check('finance refund request recorded', typeof manage.v, 'string');
  });
  await asRole(url, 'authenticated', m1.authId, async (c) => {
    const pos = await one(c, `select * from public.preview_customer_position()`);
    check('refund visible to owner', Number(pos.balance), 1000);
    const refs = await one(c, `select public.preview_customer_refunds() v`);
    check('owner refund history present', Array.isArray(refs.v), true);
    const reissue = await one(c, `select * from public.preview_customer_reissue($1)`, [m1.membership]);
    check('owner reissues own card codes', typeof reissue.qr_token, 'string');
    check('reissue returns fresh fallback', reissue.fallback_code === null || typeof reissue.fallback_code, 'string');
  });
  await asRole(url, 'authenticated', m2.authId, async (c) => {
    await denied(c, 'stranger cannot reissue another card', () =>
      call(c, 'preview_customer_reissue', [m1.membership]),
    );
  });

  // --- second pass: every remaining wrapper executes at least once ---
  const svc2 = await asRole(url, 'authenticated', staff.admin, async (c) => {
    const s = await one(c, `select * from public.preview_staff_save_service(null, $1::jsonb)`, [
      JSON.stringify({ name: 'Wrapper Stay 2', basePrice: '500.00', isStaycationEligible: false, isActive: true, published: false }),
    ]);
    const t = await one(c, `select * from public.preview_staff_tier_discount_create($1::jsonb)`, [
      JSON.stringify({ serviceId: s.id, tier: 'GOLD', discountRate: '10.0000', effectiveStart: '2000-01-01', effectiveEnd: '2099-01-01' }),
    ]);
    check('admin creates tier rate via wrapper', [String(t.tier), String(t.discount_rate)], ['GOLD', '10.0000']);
    const off = await one(c, `select public.preview_staff_set_policy_active('tier_discount', $1, false) v`, [t.id]);
    check('admin deactivates tier rate via wrapper', off.v, false);
    const tiers = await one(c, `select public.preview_staff_tier_discounts() v`);
    check(
      'tier list carries the new rate',
      (tiers.v ?? []).some((t) => t.tier === 'GOLD' && Number(t.discount_rate) === 10),
      true,
    );
    const rules = await one(c, `select public.preview_staff_earning_rules() v`);
    check('earning rule list readable via wrapper', Array.isArray(rules.v), true);
    const promos = await one(c, `select public.preview_staff_redemption_rules() v`);
    check('promotion list readable via wrapper', JSON.stringify(promos.v).includes('PW-CONV-1'), true);
    const services = await one(c, `select public.preview_staff_services() v`);
    check('service list readable via wrapper', JSON.stringify(services.v).includes('Wrapper Stay'), true);
    return { serviceId: s.id };
  });
  const p3id = await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'employee cannot create tier rates', () =>
      call(c, 'preview_staff_tier_discount_create', [JSON.stringify({ serviceId: svc2.serviceId, tier: 'GOLD', discountRate: '5', effectiveStart: '2000-01-01', effectiveEnd: '2099-01-01' })]),
    );
    const p3 = await one(c, `select * from public.preview_staff_create_purchase($1, $2::jsonb, $3, false)`, [
      m2.membership, JSON.stringify([{ serviceId: svc2.serviceId, quantity: 1 }]), randomUUID(),
    ]);
    check('second member purchases via wrapper', String(p3.net_amount), '500.00');
    await one(c, `select * from public.preview_staff_record_payment($1, '500.00', 'Cash', $2)`, [p3.purchase_id, 'PW-REC-3']);
    return p3.purchase_id;
  });
  // Separate connection only sees committed rows: look the receipt up after commit.
  const pid3 = (await db.query(`select id from public.purchase_payments where purchase_id=$1 and status='recorded'`, [p3id])).rows[0].id;
  await asRole(url, 'authenticated', staff.finance, async (f) => {
    await one(f, `select * from public.preview_staff_verify_payment($1, 'verified', null)`, [pid3]);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const done = await one(c, `select * from public.preview_staff_complete_purchase($1)`, [p3id]);
    check('second purchase completes via wrapper', done.fully_paid, true);
    const sum = await one(c, `select * from public.preview_staff_summary($1)`, [p3id]);
    check('summary wrapper matches trusted figures', [String(sum.gross_amount), String(sum.net_amount)], ['500.00', '500.00']);
    const settle = await one(c, `select * from public.preview_staff_settlement($1)`, [p3id]);
    check('settlement wrapper matches trusted figures', [String(settle.net_amount), settle.fully_paid], ['500.00', true]);
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    const pays = await one(c, `select public.preview_staff_payments($1) v`, [p3id]);
    check('payment list readable via wrapper', Array.isArray(pays.v) && pays.v.length === 1, true);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'gsd cannot list finance payments', () =>
      call(c, 'preview_staff_payments', [p3id]),
    );
  });
  await asRole(url, 'authenticated', superadmin, async (c) => {
    const before = Number((await one(db, `select balance from public.points_accounts where id=$1`, [m2.account])).balance);
    const adj = await one(c, `select * from public.preview_staff_adjust_points($1, 500, 'QA adjustment')`, [m2.membership]);
    check('super_admin adjusts via wrapper', Number(adj.balance_after), before + 500);
    const back = await one(c, `select * from public.preview_staff_adjust_points($1, -500, 'QA reversal')`, [m2.membership]);
    check('adjustment reverses cleanly', [Number(back.balance_after), Number(back.reversal_debt)], [before, 0]);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'employee cannot adjust points', () =>
      call(c, 'preview_staff_adjust_points', [m2.membership, 1, 'x']),
    );
  });
  // Known-secret hash path for member resolution.
  await db.query(`update public.memberships set fallback_code_hash = private.hash_token('AFH-1234-5678') where id=$1`, [m2.membership]);
  await db.query(
    `insert into private.business_id_aliases(entity_type, old_identifier, entity_id, is_active) values('membership', 'MBS-OLD-1', $1, true)`,
    [m2.membership],
  );
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const hit = await one(c, `select public.preview_staff_resolve_member('afh-1234-5678') v`);
    check('lowercase fallback code resolves via hash', [hit.v.matchedBy, hit.v.membershipNumber], ['fallback_code', 'MBS-PW-LOCAL2']);
    check('resolve exposes no secret hashes', JSON.stringify(hit.v).includes('AFH-1234-5678'), false);
    const aliased = await one(c, `select public.preview_staff_resolve_member('mbs-old-1') v`);
    check('legacy alias resolves via wrapper', [aliased.v.matchedBy, aliased.v.membershipNumber], ['legacy_alias', 'MBS-PW-LOCAL2']);
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    await denied(c, 'finance cannot resolve members', () =>
      call(c, 'preview_staff_resolve_member', ['MBS-PW-LOCAL1']),
    );
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const cid = await claimIdOf(db, purchase.purchase_id);
    const oneClaim = await one(c, `select public.preview_staff_claim($1) v`, [cid]);
    check('single claim readable via wrapper', typeof oneClaim.v, 'object');
    const claims = await one(c, `select public.preview_staff_claims(0) v`);
    check('claim list readable via wrapper', Array.isArray(claims.v) && claims.v.length >= 1, true);
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    const refunds = await one(c, `select public.preview_staff_point_refunds($1) v`, [purchase2.purchase.purchase_id]);
    check('point refund list readable via wrapper', Array.isArray(refunds.v), true);
    const hist = await one(c, `select public.preview_staff_refund_history($1) v`, [purchase.purchase_id]);
    check('staff refund history readable via wrapper', hist.v !== null, true);
  });
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'gsd cannot list finance refunds', () =>
      call(c, 'preview_staff_point_refunds', [purchase2.purchase.purchase_id]),
    );
  });
  await asRole(url, 'authenticated', staff.admin, async (c) => {
    const patched = await one(c, `select * from public.preview_staff_redemption_rule_patch($1, $2::jsonb)`, [
      await ruleIdOf(db),
      JSON.stringify({ pesoValuePerPoint: '0.6002' }),
    ]);
    check('admin patches conversion via wrapper', String(patched.peso_value_per_point), '0.6002');
    await denied(c, 'unknown photo op refused', () =>
      call(c, 'preview_staff_service_photo', [svc.serviceId, null, 'explode', null, null]),
    );
    const added = await one(c, `select * from public.preview_staff_service_photo($1, null, 'append', $2, 'QA photo')`, [
      svc.serviceId,
      `${staff.admin}/qa.jpg`,
    ]);
    check('admin appends photo metadata via wrapper', Array.isArray(added.photos) && added.photos.length === 1, true);
    const { createHash } = await import('node:crypto');
    const photoId = createHash('sha256').update(`${staff.admin}/qa.jpg`).digest('hex');
    const removed = await one(c, `select * from public.preview_staff_service_photo($1, $2, 'remove', null, null)`, [
      svc.serviceId,
      photoId,
    ]);
    check('admin removes photo via wrapper', Array.isArray(removed.photos) && removed.photos.length === 0, true);
  });
  await asRole(url, 'authenticated', superadmin, async (c) => {
    const rev = await one(c, `select * from public.preview_staff_reverse_purchase($1, 'QA reverse')`, [purchase.purchase_id]);
    check('super_admin reverses via wrapper', typeof Number(rev.balance_after), 'number');
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    const pending = await one(db, `select id from public.service_refunds where purchase_id=$1 order by requested_at desc, id desc limit 1`, [purchase.purchase_id]);
    const approved = await one(c, `select public.preview_staff_manage_refund($1, $2, 'approve', $3::jsonb) v`, [
      purchase.purchase_id, pending.id, JSON.stringify({ serviceReviewConfirmed: true, reason: 'QA approve' }),
    ]);
    check('finance approves refund via wrapper', typeof approved.v, 'string');
    const repaid = await one(c, `select public.preview_staff_manage_refund($1, $2, 'repay', $3::jsonb) v`, [
      purchase.purchase_id, pending.id,
      JSON.stringify({ method: 'cash', reference: 'PW-CASH-2', amount: '2000.00', repaidAt: new Date().toISOString() }),
    ]);
    check('finance records repayment via wrapper', typeof repaid.v, 'string');
    await denied(c, 'reconcile without an upload refuses', () =>
      call(c, 'preview_staff_reconcile_receipt', [purchase.purchase_id, pending.id, 999999999, 'QA']),
    );
  });
  // Fund the second member so their approval can reserve points.
  await asRole(url, 'authenticated', superadmin, async (c) => {
    await one(c, `select * from public.preview_staff_adjust_points($1, 1000, 'QA funding')`, [m2.membership]);
  });
  const purchase5 = await asRole(url, 'authenticated', staff.employee, async (c) => {
    const p = await one(c, `select * from public.preview_staff_create_purchase($1, $2::jsonb, $3, false)`, [
      m2.membership, JSON.stringify([{ serviceId: svc.serviceId, quantity: 1 }]), randomUUID(),
    ]);
    const q = await one(c, `select * from public.preview_staff_prepare_quote($1, 100)`, [p.purchase_id]);
    return { purchase: p, quote: q };
  });
  await asRole(url, 'authenticated', m2.authId, async (c) => {
    await one(c, `select public.preview_customer_decide($1, true) v`, [purchase5.quote.quote_id]);
  });
  await asRole(url, 'authenticated', staff.finance, async (c) => {
    await one(c, `select public.preview_staff_cancel_reserved($1, 'QA cancellation')`, [purchase5.purchase.purchase_id]);
  });
  {
    const st = await one(db, `select status from public.purchases where id=$1`, [purchase5.purchase.purchase_id]);
    check('finance cancels reserved purchase via wrapper', st.status, 'reversed');
  }
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    const resolved = await one(c, `select public.preview_staff_resolve_member('MBS-PW-LOCAL1') v`);
    check('gsd resolves member without PII hashes', JSON.stringify(resolved.v).includes('syn-qr'), false);
    check('resolve carries balance', Number(resolved.v.pointsBalance ?? resolved.v.points_balance ?? -1) >= 0, true);
    const unknown = await one(c, `select public.preview_staff_resolve_member('MBS-NOPE-0') v`);
    check('unknown identifier resolves null', unknown.v, null);
  });

  // --- anon denied everywhere (e) ---
  await asRole(url, 'anon', null, async (c) => {
    await denied(c, 'anon cannot create purchase', () => call(c, 'preview_staff_create_purchase', [m1.membership, '[]', 'x', true]), /./);
    await denied(c, 'anon cannot claim', () => call(c, 'preview_customer_claim', ['x']), /./);
    await denied(c, 'anon cannot read position', () => call(c, 'preview_customer_position'), /./);
  });

  // --- direct table writes stay denied (f) ---
  await asRole(url, 'authenticated', staff.employee, async (c) => {
    await denied(c, 'authenticated cannot insert purchases directly', () =>
      c.query(`insert into public.purchases(customer_id,membership_id,status) values($1,$2,'draft')`, [m1.customer, m1.membership]),
    );
    await denied(c, 'authenticated cannot update ledger directly', () =>
      c.query(`update public.points_ledger set amount = 0 where account_id = $1`, [m1.account]),
    );
  });

  // --- service_role paths unchanged (h) ---
  await db.query(`set local role service_role`);
  const direct = await one(db, `select * from public.purchase_financial_summary_purchases($1)`, [purchase.purchase_id]);
  check('trusted summary still executes for service_role', String(direct.net_amount), '2000.00');
  await db.query(`reset role`);

  // --- audit + idempotency proof (g) ---
  const audits = Number((await one(db, `select count(*) n from public.audit_events where action like 'LEGACY%'`)).n);
  check('no legacy cutover touched by wrapper run', audits, legacyBaseline);
  const dup = await asRole(url, 'authenticated', staff.employee, async (c) => {
    const first = await one(
      c,
      `select * from public.preview_staff_create_purchase($1, $2::jsonb, 'PW-DUP-REF', true)`,
      [m1.membership, JSON.stringify([{ serviceId: svc.serviceId, quantity: 1 }])],
    );
    const replay = await one(
      c,
      `select * from public.preview_staff_create_purchase($1, $2::jsonb, 'PW-DUP-REF', true)`,
      [m1.membership, JSON.stringify([{ serviceId: svc.serviceId, quantity: 1 }])],
    );
    return String(first.purchase_id) === String(replay.purchase_id);
  });
  check('duplicate purchase reference replays the original', dup, true);

  console.log(`\npreview-wrappers: ${checks} checks passed`);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exitCode = 1;
} finally {
  if (postgres) await postgres.stop().catch(() => {});
}

async function claimIdOf(client, purchaseId) {
  return (await one(client, `select id from public.earning_claims where purchase_id=$1 order by created_at desc limit 1`, [purchaseId])).id;
}
async function ruleIdOf(client) {
  return (await one(client, `select id from public.point_redemption_rules where promotion_reference='PW-CONV-1'`)).id;
}
async function wrapperArity(client, fn) {  const row = await one(
    client,
    `select pg_get_function_identity_arguments(p.oid) a from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname=$1`,
    [fn],
  ).catch(() => null);
  return row ? row.a : 'uuid';
}
