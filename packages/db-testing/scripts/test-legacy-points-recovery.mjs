import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import { atomicMigrationSql } from '../../../supabase/recovery/atomic-migration.ts';
import { startDisposablePostgres, listMigrations } from './lib/local-postgres.mjs';
import { startVipHttpHarness } from './lib/vip-http-harness.mjs';
const root = path.resolve(import.meta.dirname, '../../..');
const sql = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const excluded = [
  '20261030000001_afhomes_customer_directory_id_filter.sql',
  '20261031000001_afhomes_customer_directory_payment_filter.sql',
];
const selected = listMigrations().filter((f) => f >= '20261102000001' && !excluded.includes(f));
const check = (name, actual, expected) => {
  assert.deepEqual(actual, expected, name);
  checks++;
  console.log('PASS ' + name);
};
let postgres,
  db,
  restored,
  httpHarness,
  fatalFailure = false,
  checks = 0;
const one = async (query, args = []) => (await db.query(query, args)).rows[0];
const state = async (client) =>
  (
    await client.query(
      `select jsonb_build_object('accounts',(select jsonb_agg(jsonb_build_object('id',a.id,'membership',a.membership_id,'balance',a.balance,'cache',m.points_balance) order by a.id) from public.points_accounts a join public.memberships m on m.id=a.membership_id),'ledger',(select jsonb_agg(to_jsonb(l) order by l.id) from public.points_ledger l),'history',(select jsonb_agg(to_jsonb(h) order by h.version) from supabase_migrations.schema_migrations h)) value`,
    )
  ).rows[0].value;
const denied = async (name, fn, pattern) => {
  await db.query('savepoint expected_failure');
  let error;
  try {
    await fn();
  } catch (e) {
    error = e;
  }
  await db.query('rollback to savepoint expected_failure');
  await db.query('release savepoint expected_failure');
  assert.ok(error && pattern.test(error.message), name);
  checks++;
  console.log('PASS ' + name);
};
async function migrate(injectFailure = false) {
  const pending = [];
  for (const f of selected)
    if (
      !(await one('select 1 n from supabase_migrations.schema_migrations where version=$1', [
        f.split('_')[0],
      ]))
    )
      pending.push(f);
  if (!pending.length) return;
  await db.query('begin');
  try {
    await db.query(sql('supabase/recovery/legacy-points-preflight.sql'));
    for (const f of pending) {
      await db.query(atomicMigrationSql(f, sql('supabase/migrations/' + f)));
      if (f.startsWith('20261104000001'))
        check(
          'Original cutover accounting really runs inside the isolated transaction',
          Number((await one('select sum(balance) n from public.points_accounts')).n),
          0,
        );
      await db.query(
        'insert into supabase_migrations.schema_migrations(version,name,statements) values($1,$2,$3)',
        [f.split('_')[0], f, [sql('supabase/migrations/' + f)]],
      );
    }
    if (injectFailure) throw Error('INJECTED_BATCH_FAILURE');
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    throw e;
  }
}
try {
  postgres = await startDisposablePostgres({
    beforeMigration: '20261102000001_afhomes_customer_directory_workflow_filter.sql',
    excludedMigrations: excluded,
  });
  db = postgres.client;
  const identity = await one('select current_database() name,inet_server_addr()::text host');
  assert.equal(identity.name, postgres.database);
  assert.ok(['127.0.0.1', '127.0.0.1/32', '::1', '::1/128'].includes(identity.host));
  assert.equal(new URL(postgres.url).hostname, '127.0.0.1');
  assert.equal(Number((await one('select count(*) n from public.customers')).n), 0);
  await db.query("set statement_timeout='15s';set lock_timeout='5s'");
  await db.query(
    'create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[])',
  );
  for (const f of postgres.applied)
    await db.query('insert into supabase_migrations.schema_migrations values($1,$2,$3)', [
      f.split('_')[0],
      f,
      [sql('supabase/migrations/' + f)],
    ]);
  const staff = {};
  for (const role of ['admin', 'employee', 'finance']) {
    const id = randomUUID();
    staff[role] = id;
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      id,
      'legacy-' + role + '@example.invalid',
    ]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC STAFF','active')",
      [id, 'legacy-' + role + '@example.invalid'],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
  }
  const balances = [52000, 25000, 25000, 20000, 12500, 12500, 10000, 10000, 0, 0],
    members = [];
  async function member(index, balance) {
    const auth = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      auth,
      'legacy-' + index + '@example.invalid',
    ]);
    const customer = (
      await one(
        "insert into public.customers(customer_number,auth_user_id,first_name,last_name,email,phone,status) values($1,$2,'SYNTHETIC','LEGACY',$3,'09180000003','active') returning id",
        ['LEGACY-LOCAL-' + index, auth, 'legacy-' + index + '@example.invalid'],
      )
    ).id;
    const tier = ['GOLD', 'SILVER', 'BRONZE'][index % 3];
    const sale = (
      await one(
        "insert into public.card_sales(sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,balance_due_at,status) select $1,$2,id,'staff',$3,'100000.00',now()+interval '30 days','draft' from public.card_plans where code=$4 returning id",
        ['LEGACY-SALE-' + index, customer, staff.admin, tier],
      )
    ).id;
    const membership = (
      await one(
        "insert into public.memberships(customer_id,sale_id,product_id,membership_number,fallback_code_hash,qr_token_hash,status,points_balance,yearly_points_allocated,activated_by,issued_at,activated_at,expires_at) select $1,$2,id,$3,$4,$5,'active',$6,0,$7,now()-interval '180 days',now()-interval '180 days',now()+interval '5 years' from public.card_plans where code=$8 returning id",
        [
          customer,
          sale,
          'LEGACY-MEMBER-' + index,
          'legacy-fallback-' + index,
          'legacy-qr-' + index,
          balance,
          staff.admin,
          tier,
        ],
      )
    ).id;
    const account = (
      await one(
        'insert into public.points_accounts(membership_id,balance) values($1,$2) returning id',
        [membership, balance],
      )
    ).id;
    return { auth, customer, membership, account, tier, balance };
  }
  for (let i = 0; i < balances.length; i++) {
    const m = await member(i, balances[i]);
    members.push(m);
    if (balances[i]) {
      await db.query(
        "insert into public.points_ledger(account_id,entry_type,amount,balance_after,reason) values($1,'adjustment',$2,$2,'Synthetic historical opening credit')",
        [m.account, balances[i] + (i === 0 ? 18000 : 0)],
      );
      if (i === 0) {
        await db.query(
          "insert into public.points_ledger(account_id,entry_type,amount,balance_after,reason) values($1,'redemption',-5000,65000,'Synthetic historical redemption'),($1,'reversal',-14000,51000,'Synthetic historical reversal'),($1,'adjustment',1000,52000,'Synthetic historical correction')",
          [m.account],
        );
      }
    }
  }
  for (const index of [1, 2, 3, 6, 7])
    await db.query('update public.memberships set points_balance=0 where id=$1', [
      members[index].membership,
    ]);
  const before = await state(db);
  check(
    'Representative baseline: 10 accounts, 167000 points, 11 immutable ledger rows',
    [
      before.accounts.length,
      before.accounts.reduce((s, a) => s + a.balance, 0),
      before.ledger.length,
    ],
    [10, 167000, 11],
  );
  check('Applied baseline matches the 39 managed versions', postgres.applied.length, 39);
  await db.query('begin');
  await denied(
    'Ledger discrepancy fails closed without silently fixing balances',
    async () => {
      await db.query('update public.points_accounts set balance=balance+1 where id=$1', [
        members[0].account,
      ]);
      await db.query(sql('supabase/recovery/legacy-points-preflight.sql'));
    },
    /LEGACY_POINTS_DISCREPANCY/,
  );
  await db.query('rollback');
  check('Failed discrepancy probe leaves original accounting intact', await state(db), before);
  const require = createRequire(import.meta.url);
  const nativeRequire = createRequire(require.resolve('embedded-postgres'));
  const nativePath = nativeRequire.resolve(
    '@embedded-postgres/' +
      (process.platform === 'win32' ? 'windows' : process.platform) +
      '-' +
      process.arch,
  );
  const embeddedBin = path.resolve(path.dirname(nativePath), '../native/bin');
  const bin = fs.existsSync(
    path.join(embeddedBin, 'pg_dump' + (process.platform === 'win32' ? '.exe' : '')),
  )
    ? embeddedBin
    : 'C:/Program Files/PostgreSQL/18/bin';
  const u = new URL(postgres.url);
  const env = { ...process.env, PGPASSWORD: decodeURIComponent(u.password) };
  const backup = path.join(root, '.tmp-bin', 'legacy-points-synthetic-before.dump');
  const args = ['-h', '127.0.0.1', '-p', u.port, '-U', decodeURIComponent(u.username)];
  execFileSync(
    path.join(bin, 'pg_dump' + (process.platform === 'win32' ? '.exe' : '')),
    [...args, '-d', postgres.database, '-Fc', '--no-owner', '-f', backup],
    { env, timeout: 60000, windowsHide: true, stdio: 'pipe' },
  );
  check(
    'Recoverable synthetic pre-migration custom backup exists',
    fs.statSync(backup).size > 0,
    true,
  );
  await db.query('create database afhomes_restore');
  const restoreUrl = new URL(postgres.url);
  restoreUrl.pathname = '/afhomes_restore';
  restored = new pg.Client({ connectionString: restoreUrl.toString() });
  await restored.connect();
  assert.equal(
    (await restored.query('select current_database() name')).rows[0].name,
    'afhomes_restore',
  );
  execFileSync(
    path.join(bin, 'pg_restore' + (process.platform === 'win32' ? '.exe' : '')),
    [...args, '-d', 'afhomes_restore', '--no-owner', '--exit-on-error', backup],
    { env, timeout: 60000, windowsHide: true, stdio: 'pipe' },
  );
  check(
    'Independent database restore reproduces all balances, history and migration records',
    await state(restored),
    before,
  );
  let injected;
  try {
    await migrate(true);
  } catch (e) {
    injected = e;
  }
  assert.match(injected?.message ?? '', /INJECTED_BATCH_FAILURE/);
  check(
    'Injected batch failure rolls back schema, accounting and all migration records',
    await state(db),
    before,
  );
  check(
    'Rollback leaves points RPC undeployed',
    (await one("select to_regprocedure('public.customer_points_position(uuid)') fn")).fn,
    null,
  );
  await migrate();
  const after = await state(db);
  check(
    'All 10 account balances are preserved and stale membership caches are reconciled',
    after.accounts,
    before.accounts.map((a) => ({ ...a, cache: a.balance })),
  );
  check(
    'All original ledger payloads and IDs are preserved',
    before.ledger.every((old) => {
      const now = after.ledger.find((l) => l.id === old.id);
      return (
        now && Object.entries(old).every(([k, v]) => JSON.stringify(now[k]) === JSON.stringify(v))
      );
    }),
    true,
  );
  check(
    'Historical migration records are unchanged',
    after.history.slice(0, before.history.length),
    before.history,
  );
  check(
    'Explicit reset and preservation entries reconcile without creating extra points',
    after.ledger.reduce((s, l) => s + l.amount, 0),
    167000,
  );
  check(
    'Only nonzero accounts receive paired cutover compensation rows',
    after.ledger.length,
    before.ledger.length + 2 * before.accounts.filter((a) => a.balance > 0).length,
  );
  check(
    'Five stale derived caches are auditable without changing authoritative balances',
    Number(
      (
        await one(
          "select count(*) n from public.audit_events where action='LEGACY_POINTS_PRESERVED' and (before_data->>'membershipCache')::bigint<>(after_data->>'balance')::bigint",
        )
      ).n,
    ),
    5,
  );
  const preReplay = await state(db);
  await migrate();
  check('Migration replay cannot duplicate restorations', await state(db), preReplay);
  for (const m of members) {
    const p = await one('select * from public.customer_points_position($1)', [m.membership]);
    check(
      'First position preserves legacy balance and cap for ' +
        m.tier +
        ' ' +
        balances.indexOf(m.balance),
      [
        Number(p.balance),
        Number(p.spendable),
        Number(p.reversal_debt),
        Number(p.remaining_earning_capacity),
        Number(p.earned_this_period),
      ],
      [m.balance, m.balance, 0, Number(p.annual_cap), 0],
    );
  }
  await db.query('begin');
  await member(10, 0).then(async (m) => {
    check(
      'Fresh member starts with no period',
      Number(
        (await one('select count(*) n from public.points_periods where account_id=$1', [m.account]))
          .n,
      ),
      0,
    );
    const p = await one('select * from public.customer_points_position($1)', [m.membership]);
    check(
      'First call creates a real period and returns its full earning capacity',
      !!p.period_start &&
        Number(p.annual_cap) > 0 &&
        Number(p.remaining_earning_capacity) === Number(p.annual_cap),
      true,
    );
  });
  await db.query('rollback');
  await db.query('begin');
  await denied(
    'Preservation migration refuses execution without a captured preflight',
    () => db.query(sql('supabase/migrations/20261123000001_afhomes_preserve_legacy_points.sql')),
    /LEGACY_PRESERVATION_SNAPSHOT_REQUIRED/,
  );
  await db.query('rollback');
  const allowlist = selected.map((f) => ({
    file: f,
    transactionEnvelope: f.startsWith('20261112000001')
      ? 'reviewed BEGIN/COMMIT replaced by the outer atomic transaction'
      : 'none',
    sha256: createHash('sha256')
      .update(fs.readFileSync(path.join(root, 'supabase/migrations', f)))
      .digest('hex'),
  }));
  fs.writeFileSync(
    path.join(root, '.tmp-bin', 'legacy-points-migration-allowlist.json'),
    JSON.stringify(
      {
        excluded,
        allowlist,
        syntheticBefore: before.accounts,
        syntheticAfter: after.accounts,
        backupSha256: createHash('sha256').update(fs.readFileSync(backup)).digest('hex'),
      },
      null,
      2,
    ),
  );
  check('Exact preservation allowlist includes the server-only ACL correction', selected.length, 27);
  check(
    'Selected batch ends with the forward-only ACL patch',
    selected.at(-1),
    '20261124000001_afhomes_points_position_service_acl.sql',
  );
  await db.query('begin');
  const m = members[0],
    admin = staff.admin,
    gsd = staff.employee,
    finance = staff.finance;
  httpHarness = await startVipHttpHarness(
    db,
    new Map([admin, gsd, finance, m.auth].map((id) => [id, id])),
  );
  const http = httpHarness.request;
  const dates = { effectiveStart: '2000-01-01', effectiveEnd: '2099-01-01' };
  const restaurant = await http(
    '/earning/services',
    admin,
    {
      name: 'Synthetic legacy restaurant',
      basePrice: '1000.00',
      pricingUnit: 'unit',
      isStaycationEligible: false,
    },
    201,
  );
  await http(
    '/earning/tier-discounts',
    admin,
    { serviceId: restaurant.id, tier: 'GOLD', discountRate: 10, ...dates },
    201,
  );
  await http(
    '/earning/rules',
    admin,
    { serviceId: restaurant.id, pointsAmount: 1000, eligibleTiers: ['GOLD'], ...dates },
    201,
  );
  const room = await http(
    '/earning/services',
    admin,
    {
      name: 'Synthetic legacy staycation',
      basePrice: '1000.00',
      pricingUnit: 'unit',
      isStaycationEligible: true,
    },
    201,
  );
  await http(
    '/earning/redemption-rules',
    admin,
    {
      serviceId: room.id,
      ruleKind: 'accommodation',
      pesoValuePerPoint: '0.5001',
      eligibleTiers: ['GOLD'],
      promotionReference: 'SYNTHETIC-LEGACY',
      ...dates,
    },
    201,
  );
  const sale = async (service, reference, tier = false) =>
    http(
      '/earning/purchases',
      gsd,
      {
        membershipId: m.membership,
        reference,
        applyTierDiscount: tier,
        lines: [{ serviceId: service, quantity: 2 }],
      },
      201,
    );
  const pay = async (purchaseId, amount, reference) => {
    const p = await http(
      '/earning/purchases/' + purchaseId + '/payments',
      gsd,
      { amount, method: 'cash', reference },
      201,
    );
    await http('/earning/payments/' + p.paymentId + '/verify', finance, { decision: 'verified' });
  };
  const position = () => http('/customer/points/position', m.auth);
  const earned = await sale(restaurant.id, 'LEGACY-EARNING', true);
  check('HTTP Admin rules and GSD sale preserve exact tier pricing', earned.netAmount, '1800.00');
  await http('/earning/purchases/' + earned.purchaseId + '/complete', gsd, {}, 409);
  await pay(earned.purchaseId, '1800.00', 'LEGACY-EARNING-PAY');
  await http('/earning/purchases/' + earned.purchaseId + '/complete', gsd, {});
  const claim = await http('/earning/claims', gsd, { purchaseId: earned.purchaseId }, 201);
  await http('/earning/claim', gsd, { token: claim.qrToken }, 403);
  await http('/earning/claim', m.auth, { token: claim.qrToken });
  await http('/earning/claim', m.auth, { token: claim.qrToken }, 409);
  check(
    'HTTP personal QR claim credits legacy wallet exactly once',
    (await position()).balance,
    m.balance + 2000,
  );
  const deniedSale = await sale(restaurant.id, 'LEGACY-DENIED');
  await http(
    '/earning/purchases/' + deniedSale.purchaseId + '/quote',
    gsd,
    { pointsRequested: 1000 },
    409,
  );
  check(
    'HTTP restaurant spending denied without promotion',
    (await position()).spendable,
    m.balance + 2000,
  );
  const spending = await sale(room.id, 'LEGACY-SPENDING');
  const quote = await http('/earning/purchases/' + spending.purchaseId + '/quote', gsd, {
    pointsRequested: 1000,
  });
  const approvals = await http('/earning/approvals', m.auth);
  const displayed = approvals.data.find((q) => q.quoteId === quote.quoteId);
  check(
    'HTTP customer quote exposes quantities, gross, tier choice and points discount',
    [
      displayed.lines[0].quantity,
      displayed.lines[0].tierDiscountRate,
      displayed.grossAmount,
      displayed.tierDiscountAmount,
      displayed.pointsRequested,
      displayed.pesoValue,
    ],
    [2, null, '2000.00', '0.00', 1000, '500.10'],
  );
  check(
    'HTTP approval has a bounded future expiration',
    Date.parse(displayed.expiresAt) > Date.now() &&
      Date.parse(displayed.expiresAt) < Date.now() + 3600000,
    true,
  );
  check('HTTP quote preserves four-decimal conversion', displayed.pesoValuePerPoint, '0.5001');
  check('HTTP quote preserves exact cash payable', displayed.finalAmountPayable, '1499.90');
  await http('/earning/approvals/' + quote.quoteId + '/decision', gsd, { approve: true }, 403);
  await http(
    '/earning/approvals/' + quote.quoteId + '/decision',
    m.auth,
    { approve: true, pointsRequested: 1 },
    400,
  );
  check(
    'HTTP tampered approval cannot reserve a different quote',
    (await position()).spendable,
    m.balance + 2000,
  );
  await http('/earning/approvals/' + quote.quoteId + '/decision', m.auth, { approve: true });
  check(
    'HTTP customer approval reserves without permanent deduction',
    [(await position()).balance, (await position()).spendable],
    [m.balance + 2000, m.balance + 1000],
  );
  await pay(spending.purchaseId, '1499.90', 'LEGACY-SPENDING-PAY');
  await http('/earning/purchases/' + spending.purchaseId + '/complete', gsd, {});
  await http('/earning/purchases/' + spending.purchaseId + '/complete', gsd, {});
  check(
    'HTTP settlement debits legacy wallet exactly once',
    (await position()).balance,
    m.balance + 1000,
  );
  const refund = {
    serviceValue: '1000.00',
    reference: 'LEGACY-PARTIAL',
    reason: 'Synthetic Finance reviewed refund',
    serviceReviewConfirmed: true,
  };
  const partial = await http(
    '/earning/purchases/' + spending.purchaseId + '/point-refunds',
    finance,
    refund,
  );
  check('HTTP partial refund restores attributable redeemed points', partial.pointsRestored, 500);
  await http('/earning/purchases/' + spending.purchaseId + '/point-refunds', finance, refund);
  check('HTTP duplicate refund creates no points', (await position()).balance, m.balance + 1500);
  await http('/earning/purchases/' + spending.purchaseId + '/point-refunds', finance, {
    ...refund,
    reference: 'LEGACY-REMAINING',
  });
  check(
    'HTTP full restoration preserves earned credit',
    (await position()).balance,
    m.balance + 2000,
  );
  const cashPath = '/earning/purchases/' + earned.purchaseId + '/refunds';
  const cashRefund = await http(
    cashPath,
    finance,
    {
      ...refund,
      serviceValue: '1800.00',
      cashAmount: '1800.00',
      reference: 'LEGACY-EARNED-REVERSAL',
    },
    201,
  );
  await http(cashPath + '/' + cashRefund.id + '/decision', finance, {
    decision: 'approve',
    serviceReviewConfirmed: true,
  });
  const approved = (await http(cashPath, finance)).data[0];
  check(
    'HTTP Finance approval does not invent external cash repayment',
    [approved.cashRepaid, approved.cashOutstanding, approved.earnedPointsAdjusted],
    ['0.00', '1800.00', 2000],
  );
  const repayment = {
    amount: '1800.00',
    method: 'cash',
    reference: 'SYNTHETIC-EXTERNAL-REPAYMENT',
    repaidAt: new Date(Date.now() - 1000).toISOString(),
  };
  await http(cashPath + '/' + cashRefund.id + '/repayments', finance, repayment);
  await http(cashPath + '/' + cashRefund.id + '/repayments', finance, repayment);
  check(
    'HTTP synthetic externally recorded repayment completes exactly once',
    (await http(cashPath, finance)).data[0].repayments.length,
    1,
  );
  check(
    'HTTP earning reversal returns wallet to its original legacy balance',
    (await position()).balance,
    m.balance,
  );
  const history = await http('/customer/points/ledger', m.auth);
  check(
    'HTTP customer history exposes earning and redemption events',
    history.data.some((row) => row.entryType === 'earned') &&
      history.data.some((row) => row.entryType === 'redemption'),
    true,
  );
  check(
    'Post-lifecycle ledger reconciles to original preserved balance',
    Number(
      (await one('select sum(amount) n from public.points_ledger where account_id=$1', [m.account]))
        .n,
    ),
    m.balance,
  );
  check(
    'Unrelated legacy accounts remain unchanged',
    (await state(db)).accounts.filter((a) => a.id !== m.account),
    before.accounts.filter((a) => a.id !== m.account).map((a) => ({ ...a, cache: a.balance })),
  );
  console.log(
    'LEGACY PRESERVATION: ' +
      checks +
      ' real PostgreSQL checks passed; synthetic restore verified; no shared database touched.',
  );
} catch (error) {
  console.error('FAIL ' + error.stack);
  fatalFailure = true;
  process.exitCode = 1;
} finally {
  if (httpHarness) await httpHarness.stop();
  if (restored) await restored.end().catch(() => {});
  if (db) await db.query('rollback').catch(() => {});
  if (postgres) {
    await postgres.stop();
    assert.equal(fs.existsSync(postgres.dataDir), false);
    console.log('PASS disposable cluster removed; synthetic backup retained');
  }
}

if (fatalFailure) process.exit(1);
