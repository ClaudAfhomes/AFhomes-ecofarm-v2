import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export async function checkStayDateAllowances({ db, url, actor, customerId, membershipId }) {
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
  const wallet = async () => one('select a.balance,a.weekday_balance,a.weekend_balance from public.points_accounts a where membership_id=$1', [membershipId]);
  for (const [dates, expected] of [
    [{ serviceDate: '2026-10-24' }, { weekday: 0, weekend: 1000, type: 'weekend' }],
    [{ serviceDate: '2026-10-26' }, { weekday: 1000, weekend: 0, type: 'weekday' }],
    [{ checkInDate: '2026-10-23', checkOutDate: '2026-10-26' }, { weekday: 334, weekend: 666, type: 'mixed' }],
    [{ checkInDate: '2026-10-24', checkOutDate: '2026-10-26' }, { weekday: 0, weekend: 1000, type: 'weekend' }],
  ]) {
    const row = await one('select private.stay_point_allocation(1000,$1,$2,$3) result', [dates.serviceDate, dates.checkInDate, dates.checkOutDate]);
    assert.deepEqual(row.result, expected);
  }
  await assert.rejects(db.query('select private.stay_point_allocation(1000,null,null,null)'), /STAY_SERVICE_DATES_REQUIRED/);
  await assert.rejects(db.query("select private.stay_point_allocation(1000,null,'2026-10-26','2026-10-24')"), /STAY_SERVICE_DATES_REQUIRED/);
  const owner = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [owner, `${owner}@example.invalid`]);
  await db.query('update public.customers set auth_user_id=$1 where id=$2', [owner, customerId]);
  const service = (await one("insert into public.service_catalog(code,name,base_price,is_staycation_eligible,is_active,availability) values($1,'Synthetic overnight stay','10000.00',true,true,'available') returning id", [randomUUID()])).id;
  await db.query("insert into public.point_redemption_rules(service_id,peso_value_per_point,eligible_tiers,effective_start,effective_end,promotion_reference,rule_kind,created_by) values($1,1,array['GOLD'],current_date-1,current_date+365,'Synthetic dated accommodation','accommodation',$2)", [service, actor]);
  const purchase = async () => (await one('select * from public.create_purchase($1,null,$2,$3,$4,false)', [membershipId, JSON.stringify([{ serviceId: service, quantity: 1 }]), randomUUID(), actor])).purchase_id;
  const quote = async (id, points, dates) => (await one('select * from public.prepare_customer_point_redemption($1,$2,$3,$4)', [id, points, actor, dates])).quote_id;
  const approve = (client, id) => client.query('select public.decide_point_redemption_approval($1,$2,$3,true)', [id, customerId, owner]);
  const before = await wallet();
  assert.equal(Number(before.weekday_balance), 6300);
  assert.equal(Number(before.weekend_balance), 2700);
  const saturday = { serviceDate: '2026-10-24' };
  await assert.rejects(quote(await purchase(), 3000, saturday), /INSUFFICIENT_DAY_ALLOWANCE/);
  const firstPurchase = await purchase();
  const secondPurchase = await purchase();
  await assert.rejects(db.query('select * from public.prepare_customer_point_redemption($1,100,$2)', [firstPurchase, actor]), /STAY_SERVICE_DATES_REQUIRED/);
  const firstQuote = await quote(firstPurchase, 2000, saturday);
  const secondQuote = await quote(secondPurchase, 2000, saturday);
  const other = new pg.Client({ connectionString: url });
  await other.connect();
  let outcomes;
  try {
    outcomes = await Promise.allSettled([approve(db, firstQuote), approve(other, secondQuote)]);
  } finally {
    await other.end();
  }
  assert.equal(outcomes.filter(r => r.status === 'fulfilled').length, 1, 'Concurrent approval cannot reserve the same weekend points twice');
  assert.match(outcomes.find(r => r.status === 'rejected').reason.message, /INSUFFICIENT_DAY_ALLOWANCE/);
  const winningPurchase = outcomes[0].status === 'fulfilled' ? firstPurchase : secondPurchase;
  const winningQuote = outcomes[0].status === 'fulfilled' ? firstQuote : secondQuote;
  const snapshot = (await one('select approval_snapshot from public.redemption_quotes where id=$1', [winningQuote])).approval_snapshot;
  assert.equal(snapshot.allowanceType, 'weekend');
  assert.equal(snapshot.serviceDates.serviceDate, saturday.serviceDate);
  assert.equal(snapshot.weekdayPoints, 0);
  const payment = (await one("select * from public.record_purchase_payment($1,'8000.00','cash',$2,$3)", [winningPurchase, randomUUID(), actor])).payment_id;
  await db.query("select * from public.verify_purchase_payment($1,'verified',null,$2)", [payment, actor]);
  await db.query('select * from public.complete_purchase($1,$2)', [winningPurchase, actor]);
  assert.deepEqual(Object.fromEntries(Object.entries(await wallet()).map(([k,v])=>[k, Number(v)])), { balance: 7000, weekday_balance: 6300, weekend_balance: 700 });
  await db.query('select * from public.complete_purchase($1,$2)', [winningPurchase, actor]);
  const committed = await one('select redemption_date,service_date::text from public.redemption_quotes where id=$1', [winningQuote]);
  assert(committed.redemption_date, 'Redemption audit time is generated on the server');
  assert.equal(committed.service_date, saturday.serviceDate);
  const refundReference = randomUUID();
  await db.query("select * from public.refund_purchase_redeemed_points($1,'10000.00',$2,'Synthetic full service refund',true,$3)", [winningPurchase, refundReference, actor]);
  assert.deepEqual(await wallet(), before, 'Refund restores the original weekend allowance');
  await db.query("select * from public.refund_purchase_redeemed_points($1,'10000.00',$2,'Synthetic full service refund',true,$3)", [winningPurchase, refundReference, actor]);
  assert.deepEqual(await wallet(), before, 'Retry cannot restore points twice');
  const mixed = await quote(await purchase(), 1000, { checkInDate: '2026-10-23', checkOutDate: '2026-10-26' });
  const allocation = await one('select allowance_type,weekday_points,weekend_points from public.redemption_quotes where id=$1', [mixed]);
  assert.equal(allocation.allowance_type, 'mixed');
  assert.equal(Number(allocation.weekday_points), 334);
  assert.equal(Number(allocation.weekend_points), 666);
  const position = (await one('select public.customer_points_position_with_allowances($1) result', [membershipId])).result;
  assert.equal(Number(position.weekday_spendable), 6300);
  assert.equal(Number(position.weekend_spendable), 2700);
  await assert.rejects(db.query('update public.points_accounts set weekend_balance=weekend_balance+1 where membership_id=$1',[membershipId]),/POINT_ALLOWANCE_LEDGER_MISMATCH/);
  const tiny=(await one("select private.stay_point_allocation(1,null,'2026-10-23','2026-10-26') result")).result;
  assert.equal(tiny.type,'mixed','Classification follows every actual night even when rounded deduction is zero');
  const reconciliation = await one('select a.balance-a.reversal_debt as net,a.weekday_balance+a.weekend_balance as allowances,(select sum(l.amount) from public.points_ledger l where l.account_id=a.id) as ledger from public.points_accounts a where membership_id=$1', [membershipId]);
  assert.equal(reconciliation.net, reconciliation.allowances);
  assert.equal(reconciliation.net, reconciliation.ledger);
  console.log('Stay-date allowances: PASS (classification, mixed nights, separate balances, concurrency, settlement, refunds, retries).');
}
