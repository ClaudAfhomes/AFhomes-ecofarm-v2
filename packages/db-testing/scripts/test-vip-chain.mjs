import fs from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
import { startVipHttpHarness } from './lib/vip-http-harness.mjs';
import { customerPointsEntrySchema } from '../../contracts/src/schemas/customer.ts';
import { pointApprovalSchema } from '../../contracts/src/schemas/point-approvals.ts';

// SQL lifecycle proof only: this fixture does not emulate Auth or PostgREST.
let postgres;
let httpHarness;
let fixturesCommitted = false;
let fatalFailure = false;
let db;
const checks = [];
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  checks.push(name);
  console.log('PASS ' + name);
};
const denied = async (name, sql, args, pattern) => {
  await db.query('savepoint denial');
  let failure;
  try {
    await db.query(sql, args);
  } catch (error) {
    failure = error;
  }
  await db.query('rollback to savepoint denial');
  await db.query('release savepoint denial');
  assert.ok(failure && pattern.test(failure.message), name);
  checks.push(name);
  console.log('PASS ' + name);
};
try {
  postgres = await startDisposablePostgres({
    beforeMigration: '20261121000001_afhomes_external_service_refunds.sql',
    // November 2 replaces both unapplied October directory-function definitions.
    excludedMigrations: [
      '20261030000001_afhomes_customer_directory_id_filter.sql',
      '20261031000001_afhomes_customer_directory_payment_filter.sql',
    ],
  });
  assert.equal(new URL(postgres.url).hostname, '127.0.0.1');
  assert.ok(postgres.dataDir.endsWith('pg-integration'));
  const identity = (
    await postgres.client.query(
      'select current_database() name,inet_server_addr()::text host,inet_server_port() port',
    )
  ).rows[0];
  assert.equal(identity.name, postgres.database);
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(identity.host));
  assert.equal(
    Number((await postgres.client.query('select count(*) n from public.customers')).rows[0].n),
    0,
  );
  await postgres.client.query("set statement_timeout='15s'; set lock_timeout='5s'");
  await postgres.client.query(
    fs
      .readFileSync(
        new URL(
          '../../../supabase/migrations/20261121000001_afhomes_external_service_refunds.sql',
          import.meta.url,
        ),
        'utf8',
      )
      .replace(/^\uFEFF/, ''),
  );
  check(
    'Exact 24 pending November versions execute without the superseded October files',
    postgres.applied.filter((file) => file.startsWith('202611') && file >= '20261102000001').length +
      1,
    24,
  );
  check(
    'approved new migration runs only on proven disposable loopback with no customers',
    true,
    true,
  );
  db = postgres.client;
  await db.query('begin');
  const principal = async (role) => {
    const id = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      id,
      'vip-' + role + '@example.invalid',
    ]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,$3,'active')",
      [id, 'vip-' + role + '@example.invalid', 'VIP LOCAL ' + role],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    return id;
  };
  const admin = await principal('admin');
  const gsd = await principal('employee');
  const finance = await principal('finance');
  const auth = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    auth,
    'vip-customer@example.invalid',
  ]);
  const customer = (
    await one(
      "insert into public.customers(customer_number,auth_user_id,first_name,last_name,email,phone,status) values('CUS-VIP-LOCAL',$1,'SYNTHETIC','BUYER','vip-customer@example.invalid','09180000003','active') returning id",
      [auth],
    )
  ).id;
  // A pre-existing active member is a fixture; no card onboarding/payment workflow is exercised.
  const sale = (
    await one(
      "insert into public.card_sales(sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,balance_due_at,status) select 'AF-CSALEVIPLOCAL',$1,id,'staff',$2,'100000.00',now()+interval '30 days','draft' from public.card_plans where code='GOLD' returning id",
      [customer, admin],
    )
  ).id;
  const membership = (
    await one(
      "insert into public.memberships(customer_id,sale_id,product_id,membership_number,fallback_code_hash,qr_token_hash,status,points_balance,yearly_points_allocated,activated_by,issued_at,activated_at,expires_at) select $1,$2,id,'MBS-VIP-LOCAL','synthetic-fallback','synthetic-qr','active',0,0,$3,now(),now(),now()+interval '5 years' from public.card_plans where code='GOLD' returning id",
      [customer, sale, admin],
    )
  ).id;
  const account = (
    await one('insert into public.points_accounts(membership_id) values($1) returning id', [
      membership,
    ])
  ).id;
  const wallet = async () =>
    Number(
      (await one('select balance from public.points_accounts where id=$1', [account])).balance,
    );
  check('initial member has no free points', await wallet(), 0);
  const service = async (name, accommodation) =>
    (
      await one('select id from public.save_service_catalog(null,$1::jsonb,$2)', [
        JSON.stringify({
          name,
          basePrice: '1000.00',
          isStaycationEligible: accommodation,
          pricingUnit: 'unit',
        }),
        admin,
      ])
    ).id;
  const earningService = await service('Synthetic earning service', false);
  const room = await service('Synthetic accommodation', true);
  await db.query(
    "insert into public.service_tier_discounts(service_id,tier,discount_rate,effective_start,effective_end,created_by) values($1,'GOLD',10,'2000-01-01','2099-01-01',$2)",
    [earningService, admin],
  );
  await db.query(
    "insert into public.point_earning_rules(service_id,points_amount,min_quantity,eligible_tiers,effective_start,effective_end,created_by) values($1,1000,1,array['GOLD'],'2000-01-01','2099-01-01',$2)",
    [earningService, admin],
  );
  await db.query(
    "insert into public.point_redemption_rules(service_id,rule_kind,peso_value_per_point,eligible_tiers,min_points,effective_start,effective_end,promotion_reference,allow_discount_stacking,created_by) values($1,'accommodation',0.5001,array['GOLD'],1,'2000-01-01','2099-01-01','VIP-LOCAL-RATE',false,$2)",
    [room, admin],
  );
  const purchase = async (serviceId, ref, tier) =>
    (
      await one("select purchase_id from public.create_purchase($1,'0.00',$2::jsonb,$3,$4,$5)", [
        membership,
        JSON.stringify([{ serviceId, quantity: 2, unitAmount: '0.00' }]),
        ref,
        gsd,
        tier,
      ])
    ).purchase_id;
  const pay = async (id, amount, ref) => {
    const payment = await one(
      "select payment_id from public.record_purchase_payment($1,$2,'cash',$3,$4)",
      [id, amount, ref, gsd],
    );
    await db.query("select * from public.verify_purchase_payment($1,'verified',null,$2)", [
      payment.payment_id,
      finance,
    ]);
  };
  const earnedPurchase = await purchase(earningService, 'VIP-EARN', true);
  const totals = await one(
    'select gross_amount,tier_discount_amount,net_amount from public.purchases where id=$1',
    [earnedPurchase],
  );
  check('catalog price and 10-percent VIP discount determine the sale', totals, {
    gross_amount: '2000.00',
    tier_discount_amount: '200.00',
    net_amount: '1800.00',
  });
  await denied(
    'unverified purchase cannot complete',
    'select * from public.complete_purchase($1,$2)',
    [earnedPurchase, gsd],
    /PAYMENT|SETTLE|PAID/,
  );
  await pay(earnedPurchase, '1800.00', 'VIP-EARN-PAY');
  await db.query('select * from public.complete_purchase($1,$2)', [earnedPurchase, gsd]);
  const claim = await one('select * from public.create_earning_claim($1,$2)', [
    earnedPurchase,
    gsd,
  ]);
  check('issuing the claim does not credit points', await wallet(), 0);
  const awarded = await one('select * from public.claim_earning_points($1,$2)', [
    claim.qr_token,
    customer,
  ]);
  check('personal claim credits configured per-unit earning', Number(awarded.points_awarded), 2000);
  check('newly credited balance', await wallet(), 2000);
  await denied(
    'claim replay cannot credit again',
    'select * from public.claim_earning_points($1,$2)',
    [claim.qr_token, customer],
    /CLAIM/,
  );
  const spentPurchase = await purchase(room, 'VIP-SPEND', false);
  const quote = await one('select * from public.prepare_customer_point_redemption($1,1000,$2)', [
    spentPurchase,
    gsd,
  ]);
  const stored = await one(
    'select approval_snapshot,approval_expires_at from public.redemption_quotes where id=$1',
    [quote.quote_id],
  );
  const snap = stored.approval_snapshot;
  const approval = pointApprovalSchema.parse({
    quoteId: quote.quote_id,
    quoteNumber: quote.quote_number,
    purchaseNumber: snap.purchase.purchase_number,
    serviceName: snap.lines[0].service_name_snapshot,
    lines: snap.lines.map((line) => ({
      serviceName: line.service_name_snapshot,
      quantity: line.quantity,
      tierDiscountRate: line.tier_discount_rate,
    })),
    pesoValuePerPoint: String(snap.rate),
    pointsRequested: 1000,
    pesoValue: quote.peso_value,
    grossAmount: snap.purchase.gross_amount,
    tierDiscountAmount: snap.purchase.tier_discount_amount,
    finalAmountPayable: '1499.90',
    expiresAt: stored.approval_expires_at.toISOString(),
    status: 'pending',
  });
  check('exact quote quantity', approval.lines[0].quantity, 2);
  check(
    'quote monetary fields match the frozen purchase',
    {
      gross: approval.grossAmount,
      tier: approval.tierDiscountAmount,
      points: approval.pesoValue,
      cash: approval.finalAmountPayable,
    },
    { gross: '2000.00', tier: '0.00', points: '500.10', cash: '1499.90' },
  );
  check(
    'earning-sale percentage remains frozen',
    Number(
      (
        await one('select tier_discount_rate from public.purchase_lines where purchase_id=$1', [
          earnedPurchase,
        ])
      ).tier_discount_rate,
    ),
    10,
  );
  check(
    'pending approval has a future short-lived expiration',
    Date.parse(approval.expiresAt) > Date.now() &&
      Date.parse(approval.expiresAt) <= Date.now() + 30 * 60 * 1000,
    true,
  );

  check('frozen conversion retains four decimal places', approval.pesoValuePerPoint, '0.5001');
  check('configured conversion produces the points discount', approval.pesoValue, '500.10');
  check('quote creation does not deduct points', await wallet(), 2000);
  await denied(
    'staff identity cannot authorize the customer quote',
    'select public.decide_point_redemption_approval($1,$2,$3,true)',
    [quote.quote_id, customer, gsd],
    /APPROVAL_NOT_FOUND/,
  );
  await db.query('select public.decide_point_redemption_approval($1,$2,$3,true)', [
    quote.quote_id,
    customer,
    auth,
  ]);
  check('customer approval only reserves points', await wallet(), 2000);
  check(
    'reserved points are unavailable to other purchases',
    Number(
      (await one('select spendable from public.customer_points_position($1)', [membership]))
        .spendable,
    ),
    1000,
  );
  await pay(spentPurchase, '500.00', 'VIP-SPEND-PARTIAL');
  await denied(
    'partial cash cannot finalize the deduction',
    'select * from public.complete_purchase($1,$2)',
    [spentPurchase, gsd],
    /PAYMENT|SETTLE|PAID/,
  );
  await pay(spentPurchase, '999.90', 'VIP-SPEND-REMAINING');
  await db.query('select * from public.complete_purchase($1,$2)', [spentPurchase, gsd]);
  await db.query('select * from public.complete_purchase($1,$2)', [spentPurchase, gsd]);
  check('settlement retries deduct exactly once', await wallet(), 1000);
  check(
    'one spending ledger entry',
    Number(
      (
        await one(
          "select count(*) n from public.points_ledger where account_id=$1 and entry_type='redemption'",
          [account],
        )
      ).n,
    ),
    1,
  );
  const refundArgs = [spentPurchase, 'VIP-REFUND-PARTIAL', finance];
  const refundSql =
    "select * from public.refund_purchase_redeemed_points($1,'1000.00',$2,'Synthetic Finance-reviewed partial refund',true,$3)";
  const refund = await one(refundSql, refundArgs);
  check('partial refund restores attributable points', Number(refund.points_restored), 500);
  await one(refundSql, refundArgs);
  check('refund replay restores nothing twice', await wallet(), 1500);
  await one(
    "select * from public.refund_purchase_redeemed_points($1,'1000.00','VIP-REFUND-REMAINING','Synthetic Finance-reviewed remaining refund',true,$2)",
    [spentPurchase, finance],
  );
  check('full refund restores only the original spending', await wallet(), 2000);
  check(
    'ledger sum reconciles with the account',
    Number(
      (await one('select sum(amount) n from public.points_ledger where account_id=$1', [account]))
        .n,
    ),
    await wallet(),
  );
  check(
    'membership cached balance reconciles',
    Number(
      (await one('select points_balance from public.memberships where id=$1', [membership]))
        .points_balance,
    ),
    await wallet(),
  );
  check(
    'new history join resolves only customer-owned quote numbers',
    (
      await one(
        'select q.quote_number from public.points_ledger l join public.redemption_quotes q on q.id::text=l.reference_id where l.account_id=$1 and q.approval_customer_id=$2',
        [account, customer],
      )
    ).quote_number,
    quote.quote_number,
  );
  check(
    'new history join resolves the personally claimed earning reference',
    (
      await one(
        'select c.claim_number from public.points_ledger l join public.earning_claims c on c.id::text=l.reference_id where l.account_id=$1 and c.customer_id=$2',
        [account, customer],
      )
    ).claim_number,
    claim.claim_number,
  );
  const boundPurchase = await purchase(room, 'VIP-BOUND', false);
  const boundQuote = await one(
    'select * from public.prepare_customer_point_redemption($1,1000,$2)',
    [boundPurchase, gsd],
  );
  await db.query('select * from public.save_service_catalog($1,$2::jsonb,$3)', [
    room,
    JSON.stringify({ basePrice: '2000.00' }),
    admin,
  ]);
  await denied(
    'changing quoted service pricing invalidates prior approval',
    'select public.decide_point_redemption_approval($1,$2,$3,true)',
    [boundQuote.quote_id, customer, auth],
    /APPROVAL_CHANGED/,
  );
  check('invalidated quote takes no points', await wallet(), 2000);
  const history = (
    await db.query(
      'select id,entry_type,amount,balance_after,reason,created_at from public.points_ledger where account_id=$1',
      [account],
    )
  ).rows;
  check(
    'real lifecycle entries pass the customer response contract',
    history.every(
      (row) =>
        customerPointsEntrySchema.safeParse({
          id: String(row.id),
          entryType: row.entry_type,
          amount: Number(row.amount),
          balanceAfter: Number(row.balance_after),
          reason: row.reason,
          occurredAt: row.created_at.toISOString(),
        }).success,
    ),
    true,
  );
  httpHarness = await startVipHttpHarness(
    db,
    new Map([
      [admin, admin],
      [gsd, gsd],
      [finance, finance],
      [auth, auth],
    ]),
  );
  const http = httpHarness.request;
  await http('/customer/points/position', undefined, undefined, 401);
  await http('/customer/points/position', 'invalid-local-session', undefined, 401);
  check('HTTP anonymous and invalid sessions denied', true, true);
  const newService = await http(
    '/earning/services',
    admin,
    {
      name: 'HTTP synthetic service',
      basePrice: '1000.00',
      pricingUnit: 'unit',
      isStaycationEligible: false,
    },
    201,
  );
  check(
    'HTTP Admin service creation persists to PostgreSQL',
    Boolean((await one('select id from public.service_catalog where id=$1', [newService.id]))?.id),
    true,
  );
  await http(
    '/earning/tier-discounts',
    admin,
    {
      serviceId: newService.id,
      tier: 'GOLD',
      discountRate: 10,
      effectiveStart: '2000-01-01',
      effectiveEnd: '2099-01-01',
    },
    201,
  );
  await http(
    '/earning/rules',
    admin,
    {
      serviceId: newService.id,
      pointsAmount: 1000,
      eligibleTiers: ['GOLD'],
      effectiveStart: '2000-01-01',
      effectiveEnd: '2099-01-01',
    },
    201,
  );
  await http(
    '/earning/rules',
    admin,
    {
      serviceId: room,
      pointsAmount: 1000,
      maxAward: 900,
      eligibleTiers: ['GOLD'],
      effectiveStart: '2000-01-01',
      effectiveEnd: '2099-01-01',
    },
    201,
  );
  check(
    'HTTP Admin tier and earning rules persist',
    Number(
      (
        await one('select count(*) n from public.point_earning_rules where service_id=$1', [
          newService.id,
        ])
      ).n,
    ),
    1,
  );
  const earned = await http(
    '/earning/purchases',
    gsd,
    {
      membershipId: membership,
      reference: 'HTTP-EARNING-SALE',
      applyTierDiscount: true,
      lines: [{ serviceId: newService.id, quantity: 2 }],
    },
    201,
  );
  check('HTTP GSD server-priced sale', earned.netAmount, '1800.00');
  await http('/earning/purchases/' + earned.purchaseId + '/complete', gsd, {}, 409);
  const payHttp = async (id, amount, reference) => {
    const payment = await http(
      '/earning/purchases/' + id + '/payments',
      gsd,
      { amount, method: 'cash', reference },
      201,
    );
    await http('/earning/payments/' + payment.paymentId + '/verify', finance, {
      decision: 'verified',
    });
  };
  await payHttp(earned.purchaseId, '1800.00', 'HTTP-EARNING-PAY');
  await http('/earning/purchases/' + earned.purchaseId + '/complete', gsd, {});
  const earnedClaim = await http('/earning/claims', gsd, { purchaseId: earned.purchaseId }, 201);
  await http('/earning/claim', auth, { token: earnedClaim.qrToken });
  check(
    'HTTP customer personally claims real SQL earning',
    (await http('/customer/points/position', auth)).balance,
    4000,
  );
  await http('/earning/claim', auth, { token: earnedClaim.qrToken }, 409);
  const spending = await http(
    '/earning/purchases',
    gsd,
    {
      membershipId: membership,
      reference: 'HTTP-SPENDING-SALE',
      applyTierDiscount: false,
      lines: [{ serviceId: room, quantity: 2 }],
    },
    201,
  );
  const quoted = await http('/earning/purchases/' + spending.purchaseId + '/quote', gsd, {
    pointsRequested: 1000,
  });
  const approvals = await http('/earning/approvals', auth);
  const displayed = pointApprovalSchema.parse(
    approvals.data.find((q) => q.quoteId === quoted.quoteId),
  );
  check('HTTP customer quote retains four-decimal rate', displayed.pesoValuePerPoint, '0.5001');
  check('HTTP customer quote exposes exact cash payable', displayed.finalAmountPayable, '3499.90');
  await http('/earning/approvals/' + quoted.quoteId + '/decision', gsd, { approve: true }, 403);
  await http('/earning/approvals/' + quoted.quoteId + '/decision', auth, { approve: true });
  check(
    'HTTP approval reserves without debit',
    (await http('/customer/points/position', auth)).balance,
    4000,
  );
  check(
    'HTTP reservation reduces spendable',
    (await http('/customer/points/position', auth)).spendable,
    3000,
  );
  await payHttp(spending.purchaseId, '3499.90', 'HTTP-SPENDING-PAY');
  await http('/earning/purchases/' + spending.purchaseId + '/complete', gsd, {});
  await http('/earning/purchases/' + spending.purchaseId + '/complete', gsd, {});
  check('HTTP settlement debits exactly once', await wallet(), 3000);
  const spendingClaim = await http(
    '/earning/claims',
    gsd,
    { purchaseId: spending.purchaseId },
    201,
  );
  check('HTTP capped earning claim starts at frozen maximum', spendingClaim.pointsRequested, 900);
  const refundBody = {
    serviceValue: '2000.00',
    reference: 'HTTP-REFUND-PARTIAL',
    reason: 'Synthetic Finance-approved refund',
    serviceReviewConfirmed: true,
  };
  await http('/earning/purchases/' + spending.purchaseId + '/point-refunds', gsd, refundBody, 403);
  await http(
    '/earning/purchases/' + spending.purchaseId + '/point-refunds',
    finance,
    { ...refundBody, serviceReviewConfirmed: false },
    400,
  );
  const httpRefund = await http(
    '/earning/purchases/' + spending.purchaseId + '/point-refunds',
    finance,
    refundBody,
  );
  check('HTTP partial refund restores attributable points', httpRefund.pointsRestored, 500);
  await http('/earning/purchases/' + spending.purchaseId + '/point-refunds', finance, refundBody);
  check('HTTP duplicate refund does not create points', await wallet(), 3500);
  check(
    'HTTP unclaimed partial-refund award preserves F1 cap',
    Number(
      (
        await one('select points_requested from public.earning_claims where purchase_id=$1', [
          spending.purchaseId,
        ])
      ).points_requested,
    ),
    900,
  );
  await http('/earning/claim', auth, { token: spendingClaim.qrToken });
  check('HTTP customer claims retained award after partial refund', await wallet(), 4400);
  await http('/earning/purchases/' + spending.purchaseId + '/point-refunds', finance, {
    ...refundBody,
    reference: 'HTTP-REFUND-REMAINING',
  });
  check(
    'HTTP full refund compensates claimed earning and restores remaining spending',
    await wallet(),
    4000,
  );
  check(
    'HTTP refunds leave immutable approval audit records',
    Number(
      (
        await one(
          "select count(*) n from public.audit_events where action='POINT_REDEMPTION_REFUNDED' and entity_id=$1",
          [spending.purchaseId],
        )
      ).n,
    ),
    2,
  );
  const httpHistory = await http('/customer/points/ledger', auth);
  check(
    'HTTP real ledger validates and carries earning references',
    httpHistory.data.every((row) => customerPointsEntrySchema.safeParse(row).success) &&
      httpHistory.data.some((row) => row.entryType === 'earned' && row.referenceNumber),
    true,
  );
  check(
    'HTTP ledger and account reconcile',
    Number(
      (await one('select sum(amount) n from public.points_ledger where account_id=$1', [account]))
        .n,
    ),
    await wallet(),
  );
  const cashPurchase = await http(
    '/earning/purchases',
    gsd,
    {
      membershipId: membership,
      reference: 'HTTP-CASH-REFUND-SALE',
      applyTierDiscount: true,
      lines: [{ serviceId: newService.id, quantity: 2 }],
    },
    201,
  );
  await payHttp(cashPurchase.purchaseId, '1800.00', 'HTTP-CASH-REFUND-PAY');
  await http('/earning/purchases/' + cashPurchase.purchaseId + '/complete', gsd, {});
  const cashClaim = await http(
    '/earning/claims',
    gsd,
    { purchaseId: cashPurchase.purchaseId },
    201,
  );
  const cashPath = '/earning/purchases/' + cashPurchase.purchaseId + '/refunds';
  const cashBody = {
    serviceValue: '900.00',
    cashAmount: '900.00',
    reference: 'HTTP-CASH-REFUND-HALF',
    reason: 'Synthetic eligible external repayment review',
    serviceReviewConfirmed: true,
  };
  await http(cashPath, gsd, cashBody, 403);
  const cashRefund = await http(cashPath, finance, cashBody, 201);
  await http(cashPath, finance, cashBody, 201);
  check(
    'HTTP refund request neither restores points nor marks cash paid',
    (await http(cashPath, finance)).data[0].status,
    'pending_approval',
  );
  await http(cashPath + '/' + cashRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  await http(cashPath + '/' + cashRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  const approvedCash = (await http(cashPath, finance)).data[0];
  check(
    'HTTP cash approval keeps actual repayment separate',
    {
      status: approvedCash.status,
      paid: approvedCash.cashRepaid,
      outstanding: approvedCash.cashOutstanding,
    },
    { status: 'approved_pending_repayment', paid: '0.00', outstanding: '900.00' },
  );
  check(
    'HTTP cash-only partial refund corrects unclaimed earned entitlement',
    approvedCash.earnedPointsAdjusted,
    1000,
  );
  await http('/earning/claim', auth, { token: cashClaim.qrToken });
  check('HTTP customer receives only retained cash-sale earning', await wallet(), 5000);
  const repayment = {
    amount: '400.00',
    method: 'cash',
    reference: 'HTTP-EXTERNAL-CASH-1',
    repaidAt: new Date(Date.now() - 1000).toISOString(),
  };
  await http(cashPath + '/' + cashRefund.id + '/repayments', gsd, repayment, 403);
  await http(cashPath + '/' + cashRefund.id + '/repayments', finance, repayment);
  await http(cashPath + '/' + cashRefund.id + '/repayments', finance, repayment);
  const partiallyRepaid = (await http(cashPath, finance)).data[0];
  check(
    'HTTP repayment is partial and duplicate-safe',
    {
      status: partiallyRepaid.status,
      paid: partiallyRepaid.cashRepaid,
      outstanding: partiallyRepaid.cashOutstanding,
      count: partiallyRepaid.repayments.length,
    },
    { status: 'partially_repaid', paid: '400.00', outstanding: '500.00', count: 1 },
  );
  await http(
    cashPath + '/' + cashRefund.id + '/repayments',
    finance,
    { ...repayment, amount: '501.00', reference: 'HTTP-OVER-REPAY' },
    409,
  );
  await http(cashPath + '/' + cashRefund.id + '/repayments', finance, {
    ...repayment,
    amount: '500.00',
    reference: 'HTTP-EXTERNAL-CASH-2',
    method: 'gcash',
  });
  check(
    'HTTP external repayment completion is explicit',
    (await http(cashPath, finance)).data[0].status,
    'completed',
  );
  const remainingRefund = await http(
    cashPath,
    finance,
    { ...cashBody, reference: 'HTTP-CASH-REFUND-REMAINING' },
    201,
  );
  await http(cashPath + '/' + remainingRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  check(
    'HTTP full cash refund compensates previously claimed retained earning',
    await wallet(),
    4000,
  );
  const ownerHistory = await http('/customer/refunds', auth);
  check(
    'HTTP customer sees separate cash and earning adjustment history',
    ownerHistory.data.length,
    2,
  );
  check('HTTP repayment never changes customer points balance', await wallet(), 4000);
  const zeroService = await http(
    '/earning/services',
    admin,
    {
      name: 'HTTP zero-cash accommodation',
      basePrice: '500.10',
      pricingUnit: 'unit',
      isStaycationEligible: true,
    },
    201,
  );
  await http(
    '/earning/redemption-rules',
    admin,
    {
      serviceId: zeroService.id,
      ruleKind: 'accommodation',
      pesoValuePerPoint: '0.5001',
      eligibleTiers: ['GOLD'],
      effectiveStart: '2000-01-01',
      effectiveEnd: '2099-01-01',
      promotionReference: 'HTTP-ZERO-CASH',
    },
    201,
  );
  check(
    'HTTP Admin accommodation rate persists with four-decimal precision',
    String(
      (
        await one(
          'select peso_value_per_point from public.point_redemption_rules where service_id=$1',
          [zeroService.id],
        )
      ).peso_value_per_point,
    ),
    '0.5001',
  );
  const discountedPurchase = async (quantity, reference) => {
    const p = await http(
      '/earning/purchases',
      gsd,
      {
        membershipId: membership,
        reference,
        applyTierDiscount: false,
        lines: [{ serviceId: zeroService.id, quantity }],
      },
      201,
    );
    const q = await http('/earning/purchases/' + p.purchaseId + '/quote', gsd, {
      pointsRequested: 1000,
    });
    await http('/earning/approvals/' + q.quoteId + '/decision', auth, { approve: true });
    if (quantity > 1) await payHttp(p.purchaseId, '500.10', reference + '-CASH');
    await http('/earning/purchases/' + p.purchaseId + '/complete', gsd, {});
    return p;
  };
  const zeroPurchase = await discountedPurchase(1, 'HTTP-POINTS-ONLY');
  check('HTTP zero-cash settlement needs no invented receipt', await wallet(), 3000);
  const zeroPath = '/earning/purchases/' + zeroPurchase.purchaseId + '/refunds';
  const zeroBody = {
    ...cashBody,
    serviceValue: '500.10',
    cashAmount: '0.00',
    reference: 'HTTP-POINTS-ONLY-REFUND',
  };
  const rejectedZero = await http(
    zeroPath,
    finance,
    { ...zeroBody, reference: 'HTTP-REJECTED-REFUND' },
    201,
  );
  await http(zeroPath + '/' + rejectedZero.id + '/decision', finance, {
    decision: 'reject',
    serviceReviewConfirmed: true,
  });
  check('HTTP rejection restores nothing', await wallet(), 3000);
  const zeroRefund = await http(zeroPath, finance, zeroBody, 201);
  await http(zeroPath + '/' + zeroRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  await http(zeroPath + '/' + zeroRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  const zeroRow = (await http(zeroPath, finance)).data.find((r) => r.id === zeroRefund.id);
  check(
    'HTTP points-only refund completes without claiming cash was repaid',
    {
      balance: await wallet(),
      points: zeroRow.pointsRestored,
      cash: zeroRow.cashRepaid,
      status: zeroRow.status,
    },
    { balance: 4000, points: 1000, cash: '0.00', status: 'completed' },
  );
  const mixedPurchase = await discountedPurchase(2, 'HTTP-MIXED-REFUND');
  const mixedPath = '/earning/purchases/' + mixedPurchase.purchaseId + '/refunds';
  const excessive = await http(
    mixedPath,
    finance,
    { ...cashBody, serviceValue: '500.10', cashAmount: '500.10', reference: 'HTTP-EXCESSIVE-CASH' },
    201,
  );
  await http(
    mixedPath + '/' + excessive.id + '/decision',
    finance,
    { decision: 'approve', serviceReviewConfirmed: true },
    409,
  );
  check('HTTP mixed cash ceiling refusal is atomic', await wallet(), 3000);
  await http(mixedPath + '/' + excessive.id + '/decision', finance, {
    decision: 'cancel',
    serviceReviewConfirmed: true,
  });
  const mixedBody = {
    ...cashBody,
    serviceValue: '500.10',
    cashAmount: '250.05',
    reference: 'HTTP-MIXED-HALF',
  };
  const mixedRefund = await http(mixedPath, finance, mixedBody, 201);
  await http(mixedPath + '/' + mixedRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  const mixedRow = (await http(mixedPath, finance)).data.find((r) => r.id === mixedRefund.id);
  check(
    'HTTP mixed points restoration is independent of cash repayment',
    {
      balance: await wallet(),
      points: mixedRow.pointsRestored,
      cash: mixedRow.cashRepaid,
      outstanding: mixedRow.cashOutstanding,
    },
    { balance: 3500, points: 500, cash: '0.00', outstanding: '250.05' },
  );
  await http(mixedPath + '/' + mixedRefund.id + '/repayments', finance, {
    ...repayment,
    amount: '250.05',
    method: 'bank_transfer',
    reference: 'HTTP-MIXED-BANK',
  });
  check('HTTP bank repayment does not restore points again', await wallet(), 3500);
  const mixedRemaining = await http(
    mixedPath,
    finance,
    { ...mixedBody, reference: 'HTTP-MIXED-REMAINING' },
    201,
  );
  await http(mixedPath + '/' + mixedRemaining.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  check('HTTP full mixed refund never restores beyond original points', await wallet(), 4000);
  const legacyPurchase = await http(
    '/earning/purchases',
    gsd,
    {
      membershipId: membership,
      reference: 'HTTP-LEGACY-REFUND',
      applyTierDiscount: true,
      lines: [{ serviceId: newService.id, quantity: 2 }],
    },
    201,
  );
  await payHttp(legacyPurchase.purchaseId, '1800.00', 'HTTP-LEGACY-PAY');
  await http('/earning/purchases/' + legacyPurchase.purchaseId + '/complete', gsd, {});
  await http('/earning/claims', gsd, { purchaseId: legacyPurchase.purchaseId }, 201);
  await db.query('update public.earning_claims set original_quantity=null where purchase_id=$1', [
    legacyPurchase.purchaseId,
  ]);
  const legacyPath = '/earning/purchases/' + legacyPurchase.purchaseId + '/refunds';
  const legacyRefund = await http(
    legacyPath,
    finance,
    { ...cashBody, reference: 'HTTP-LEGACY-REVIEW' },
    201,
  );
  await http(
    legacyPath + '/' + legacyRefund.id + '/decision',
    finance,
    { decision: 'approve', serviceReviewConfirmed: true },
    409,
  );
  check(
    'HTTP insufficient legacy snapshots block approval atomically',
    Number(
      (
        await one('select count(*) n from public.purchase_point_refunds where purchase_id=$1', [
          legacyPurchase.purchaseId,
        ])
      ).n,
    ),
    0,
  );
  check(
    'Final points ledger and balance reconcile after cash/mixed/zero refunds',
    Number(
      (await one('select sum(amount) n from public.points_ledger where account_id=$1', [account]))
        .n,
    ),
    await wallet(),
  );
  const debtPurchase = await http(
    '/earning/purchases',
    gsd,
    {
      membershipId: membership,
      reference: 'HTTP-DEBT-CASH-SALE',
      applyTierDiscount: true,
      lines: [{ serviceId: newService.id, quantity: 2 }],
    },
    201,
  );
  await payHttp(debtPurchase.purchaseId, '1800.00', 'HTTP-DEBT-CASH-PAY');
  await http('/earning/purchases/' + debtPurchase.purchaseId + '/complete', gsd, {});
  const debtClaim = await http(
    '/earning/claims',
    gsd,
    { purchaseId: debtPurchase.purchaseId },
    201,
  );
  await http('/earning/claim', auth, { token: debtClaim.qrToken });
  const consumed = await http(
    '/earning/purchases',
    gsd,
    {
      membershipId: membership,
      reference: 'HTTP-DEBT-SPEND',
      applyTierDiscount: false,
      lines: [{ serviceId: zeroService.id, quantity: 5 }],
    },
    201,
  );
  const consumedQuote = await http('/earning/purchases/' + consumed.purchaseId + '/quote', gsd, {
    pointsRequested: 5000,
  });
  await http('/earning/approvals/' + consumedQuote.quoteId + '/decision', auth, { approve: true });
  await http('/earning/purchases/' + consumed.purchaseId + '/complete', gsd, {});
  const debtPath = '/earning/purchases/' + debtPurchase.purchaseId + '/refunds';
  const debtRefund = await http(
    debtPath,
    finance,
    { ...cashBody, serviceValue: '1800.00', cashAmount: '1800.00', reference: 'HTTP-DEBT-REFUND' },
    201,
  );
  await http(debtPath + '/' + debtRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  const debtPosition = await http('/customer/points/position', auth);
  check(
    'HTTP already-spent earned reversal preserves debt accounting',
    { balance: debtPosition.balance, debt: debtPosition.reversalDebt },
    { balance: 0, debt: 1000 },
  );
  const debtRestorePath = '/earning/purchases/' + consumed.purchaseId + '/refunds';
  const debtRestore = await http(
    debtRestorePath,
    finance,
    { ...cashBody, serviceValue: '2500.50', cashAmount: '0.00', reference: 'HTTP-DEBT-RESTORE' },
    201,
  );
  await http(debtRestorePath + '/' + debtRestore.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  const restoredPosition = await http('/customer/points/position', auth);
  check(
    'HTTP compensating restoration repays reversal debt without creating points',
    { balance: restoredPosition.balance, debt: restoredPosition.reversalDebt },
    { balance: 4000, debt: 0 },
  );
  check(
    'Membership cached balance matches authoritative account',
    Number(
      (await one('select points_balance from public.memberships where id=$1', [membership]))
        .points_balance,
    ),
    await wallet(),
  );
  await denied(
    'Service role cannot mutate immutable repayment history',
    "set local role service_role; update public.service_refund_repayments set amount='1.00'",
    [],
    /permission denied/,
  );

  const receiptSql = "select public.manage_service_refund($1,$2,'repay',$3::jsonb,$4) id";
  const receiptPath =
    'service-refunds/' + debtRefund.id + '/' + finance + '/' + randomUUID() + '/synthetic.pdf';
  const receiptInput = {
    amount: '100.00',
    method: 'bank_transfer',
    reference: 'SQL-RECEIPT-EXTERNAL',
    repaidAt: new Date(Date.now() - 1000).toISOString(),
    receiptPath,
  };
  await denied(
    'SQL rejects a missing private receipt atomically',
    receiptSql,
    [debtPurchase.purchaseId, debtRefund.id, JSON.stringify(receiptInput), finance],
    /REFUND_RECEIPT_INVALID/,
  );
  await db.query(
    "insert into storage.objects(bucket_id,name) values('afhomes-payment-receipts',$1)",
    [receiptPath],
  );
  await denied(
    'SQL rejects a receipt bound to another actor',
    receiptSql,
    [
      debtPurchase.purchaseId,
      debtRefund.id,
      JSON.stringify({ ...receiptInput, receiptPath: receiptPath.replace(finance, gsd) }),
      finance,
    ],
    /REFUND_RECEIPT_INVALID/,
  );
  check(
    'SQL accepts the private actor-bound receipt',
    (
      await one(receiptSql, [
        debtPurchase.purchaseId,
        debtRefund.id,
        JSON.stringify(receiptInput),
        finance,
      ])
    ).id,
    debtRefund.id,
  );
  check(
    'SQL receipt repayment is idempotent',
    (
      await one(receiptSql, [
        debtPurchase.purchaseId,
        debtRefund.id,
        JSON.stringify(receiptInput),
        finance,
      ])
    ).id,
    debtRefund.id,
  );
  check(
    'SQL receipt attachment is visible without exposing its storage path',
    (await http(debtPath, finance)).data[0].repayments[0].receiptAttached,
    true,
  );

  const prepared = async (path) =>
    (
      await one(
        "insert into public.audit_events(actor_id,action,entity_type,entity_id,after_data) values($1,'SERVICE_REFUND_RECEIPT_PREPARED','service_refund',$2,$3::jsonb) returning id",
        [
          finance,
          debtRefund.id,
          JSON.stringify({ receiptPath: path, reference: 'SYNTHETIC-UNCERTAIN' }),
        ],
      )
    ).id;
  const reconcileSql = 'select public.reconcile_service_refund_receipt($1,$2,$3,$4,$5) result';
  const reviewArgs = (id, actor = finance) => [
    debtPurchase.purchaseId,
    debtRefund.id,
    id,
    actor,
    'Synthetic Finance receipt review',
  ];
  const referencedAudit = await prepared(receiptPath);
  check(
    'Reconciliation preserves a committed receipt',
    (await one(reconcileSql, reviewArgs(referencedAudit))).result,
    { status: 'referenced', receiptPath: null },
  );
  const abandonedPath = receiptPath.replace('synthetic.pdf', 'abandoned.pdf');
  await db.query(
    "insert into storage.objects(bucket_id,name) values('afhomes-payment-receipts',$1)",
    [abandonedPath],
  );
  const abandonedAudit = await prepared(abandonedPath);
  await denied(
    'GSD cannot reconcile Finance receipts',
    reconcileSql,
    reviewArgs(abandonedAudit, gsd),
    /MUTATION_FORBIDDEN/,
  );
  await denied(
    'A missing prepared audit cannot authorize deletion',
    reconcileSql,
    reviewArgs('9223372036854775807'),
    /REFUND_RECEIPT_INVALID/,
  );
  const attempt = (await http(debtPath, finance)).data[0].receiptAttempts[0];
  check(
    'Finance history identifies unresolved receipt without raw storage path',
    { ...attempt, preparedAt: new Date(attempt.preparedAt).toISOString() },
    {
      auditId: abandonedAudit,
      reference: 'SYNTHETIC-UNCERTAIN',
      preparedAt: (
        await one('select created_at from public.audit_events where id=$1', [abandonedAudit])
      ).created_at.toISOString(),
      status: 'unresolved',
    },
  );
  check(
    'Reconciliation authorizes only the abandoned object',
    (await one(reconcileSql, reviewArgs(abandonedAudit))).result,
    { status: 'abandoned', receiptPath: abandonedPath },
  );
  await one(reconcileSql, reviewArgs(abandonedAudit));
  check(
    'Duplicate reconciliation does not duplicate abandonment',
    (
      await one(
        "select count(*) n from public.audit_events where action='SERVICE_REFUND_RECEIPT_ABANDONED' and after_data->>'receiptPath'=$1",
        [abandonedPath],
      )
    ).n,
    '1',
  );
  await denied(
    'Abandonment prevents a late repayment from claiming the removed receipt',
    receiptSql,
    [
      debtPurchase.purchaseId,
      debtRefund.id,
      JSON.stringify({ ...receiptInput, reference: 'ABANDONED-LATE', receiptPath: abandonedPath }),
      finance,
    ],
    /REFUND_RECEIPT_INVALID/,
  );
  check(
    'Customer history does not expose pending receipt attempts',
    (await http('/customer/refunds', auth)).data.every((r) => r.receiptAttempts.length === 0),
    true,
  );
  check(
    'Browser cannot execute receipt reconciliation',
    (
      await one(
        "select has_function_privilege('authenticated','public.reconcile_service_refund_receipt(uuid,uuid,bigint,uuid,text)','EXECUTE') allowed",
      )
    ).allowed,
    false,
  );
  await db.query('commit');
  fixturesCommitted = true;

  for (const repaymentFirst of [false, true]) {
    const suffix = repaymentFirst ? 'repay-first' : 'review-first';
    const racePath = receiptPath.replace('synthetic.pdf', suffix + '.pdf');
    await db.query(
      "insert into storage.objects(bucket_id,name) values('afhomes-payment-receipts',$1)",
      [racePath],
    );
    const raceAudit = await prepared(racePath);
    const payload = { ...receiptInput, reference: 'RACE-' + suffix, receiptPath: racePath };
    const first = new db.constructor({ connectionString: postgres.url });
    const second = new db.constructor({ connectionString: postgres.url });
    await Promise.all([first.connect(), second.connect()]);
    try {
      for (const connection of [first, second])
        await connection.query(
          "begin; set local statement_timeout='10s'; set local lock_timeout='5s'",
        );
      await first.query(
        repaymentFirst ? receiptSql : reconcileSql,
        repaymentFirst
          ? [debtPurchase.purchaseId, debtRefund.id, JSON.stringify(payload), finance]
          : reviewArgs(raceAudit),
      );
      const pending = second
        .query(
          repaymentFirst ? reconcileSql : receiptSql,
          repaymentFirst
            ? reviewArgs(raceAudit)
            : [debtPurchase.purchaseId, debtRefund.id, JSON.stringify(payload), finance],
        )
        .then(
          (result) => ({ result }),
          (error) => ({ error }),
        );
      await first.query('commit');
      const outcome = await pending;
      if (repaymentFirst) {
        assert.ok(outcome.result);
        check(
          'Concurrent repayment winning preserves referenced receipt',
          outcome.result.rows[0].result.status,
          'referenced',
        );
        await second.query('commit');
      } else {
        assert.ok(outcome.error && /REFUND_RECEIPT_INVALID/.test(outcome.error.message));
        check('Concurrent reconciliation winning refuses late receipt attachment', true, true);
        await second.query('rollback');
      }
    } finally {
      await Promise.all([first.end(), second.end()]);
    }
  }
  const repaymentSql = "select public.manage_service_refund($1,$2,'repay',$3::jsonb,$4) id";
  const concurrent = async (payload) => {
    const client = new db.constructor({ connectionString: postgres.url });
    await client.connect();
    try {
      await client.query('begin');
      await client.query("set local statement_timeout='10s'; set local lock_timeout='5s'");
      await client.query('savepoint repayment');
      try {
        const result = await client.query(repaymentSql, [
          cashPurchase.purchaseId,
          remainingRefund.id,
          JSON.stringify(payload),
          finance,
        ]);
        await client.query('commit');
        return result.rows[0].id;
      } catch (error) {
        await client.query('rollback to savepoint repayment');
        await client.query('rollback');
        throw error;
      }
    } finally {
      await client.end();
    }
  };
  const concurrentBody = {
    amount: '200.00',
    method: 'other',
    reference: 'HTTP-CONCURRENT-SAME',
    repaidAt: new Date(Date.now() - 1000).toISOString(),
  };
  const same = await Promise.all([concurrent(concurrentBody), concurrent(concurrentBody)]);
  check('Concurrent identical repayments return the same immutable receipt', same[0], same[1]);
  check(
    'Concurrent replay records cash once',
    String(
      (
        await one(
          'select sum(amount::numeric) n from public.service_refund_repayments where refund_id=$1',
          [remainingRefund.id],
        )
      ).n,
    ),
    '200.00',
  );
  const distinct = await Promise.allSettled([
    concurrent({ ...concurrentBody, amount: '600.00', reference: 'HTTP-CONCURRENT-A' }),
    concurrent({ ...concurrentBody, amount: '600.00', reference: 'HTTP-CONCURRENT-B' }),
  ]);
  check(
    'Concurrent different repayments cannot exceed outstanding cash',
    distinct.filter((r) => r.status === 'fulfilled').length,
    1,
  );
  const failure = distinct.find((r) => r.status === 'rejected');
  assert.ok(failure && /REFUND_REPAYMENT_EXCEEDS_OUTSTANDING/.test(failure.reason.message));
  check(
    'Concurrent repayment sum remains capped',
    String(
      (
        await one(
          'select sum(amount::numeric) n from public.service_refund_repayments where refund_id=$1',
          [remainingRefund.id],
        )
      ).n,
    ),
    '800.00',
  );
  const invariant = await db.query(
    fs.readFileSync(
      new URL('../../../supabase/security/rls_invariants.sql', import.meta.url),
      'utf8',
    ),
  );
  check(
    'RLS invariant audit returns no violations',
    (Array.isArray(invariant) ? invariant : [invariant]).flatMap((r) => r.rows ?? []).length,
    0,
  );
  console.log(
    'LOCAL SQL + MOCKED-AUTH HTTP: ' +
      checks.length +
      ' checks passed; managed Auth/Storage/browser E2E remains unverified.',
  );
} catch (error) {
  console.error('FAIL ' + error.message);
  process.exitCode = 1;
  fatalFailure = true;
} finally {
  try {
    if (db && !fixturesCommitted) {
      await db.query('rollback');
      check(
        'synthetic customer and Auth fixtures were rolled back',
        Number(
          (await one("select count(*) n from auth.users where email like 'vip-%@example.invalid'"))
            .n,
        ),
        0,
      );
    }
  } finally {
    if (httpHarness) await httpHarness.stop();
    if (postgres) {
      await postgres.stop();
      if (fixturesCommitted)
        check(
          'Disposable cluster containing only synthetic committed concurrency fixtures was removed',
          fs.existsSync(postgres.dataDir),
          false,
        );
    }
  }
}
// Deterministic failure gate: exitCode assignment alone was observed not to
// propagate on this script's pg-cleanup path (see release notes). An explicit
// exit after cleanup cannot be neutralized and never runs on the pass path.
if (fatalFailure) process.exit(1);
