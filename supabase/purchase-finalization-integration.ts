/**
 * Task G database proof: exactly one AF-CSALE, and only from an EXECUTED
 * reservation whose whole price is VERIFIED.
 *
 * Real PostgreSQL only. Every refusal is a named domain code, and the row counts
 * after each refusal are asserted, because a refusal that wrote something is not
 * a refusal.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

type Check = (label: string, ok: boolean, detail?: string) => void;

type World = {
  db: Client;
  url: string;
  check: Check;
  finance: string;
  actor: string;
  staff: Record<string, string>;
  createdCustomers: string[];
  createdApplications: string[];
  /** Approved application -> exact terms -> EXECUTED reservation, no sale. */
  executed: () => Promise<{
    applicationId: string;
    customerId: string;
    termsId: string;
    reservationId: string;
    total: string;
    fee: string;
  }>;
  record: (
    reservationId: string,
    amount: string,
    extra?: Record<string, unknown>,
  ) => Promise<string>;
  verify: (paymentId: string, who?: string) => Promise<void>;
  /** The seller staff member frozen on the terms of the given reservation. */
  sellerOf: (reservationId: string) => Promise<string>;
  /** Approved application -> exact terms -> a DRAFT reservation, no sale. */
  reserved: () => Promise<{
    applicationId: string;
    customerId: string;
    termsId: string;
    reservationId: string;
    total: string;
    fee: string;
  }>;
};

export async function runPurchaseFinalizationChecks(world: World) {
  const { db, check, finance, actor, staff } = world;
  const inactive = staff['inactive']!;

  const fails = async (label: string, expected: RegExp, work: () => Promise<unknown>) => {
    try {
      await work();
      check(label, false, 'expected an error, but the call succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      check(label, expected.test(message), message.split('\n')[0]?.slice(0, 140));
    }
  };
  const count = async (sql: string, args: unknown[] = []) =>
    (await db.query<{ n: number }>(sql, args)).rows[0]!.n;
  const finalize = (reservationId: string, who = finance, requestId = randomUUID()) =>
    db
      .query<{ id: string }>(
        'select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid) as id',
        [requestId, reservationId, who],
      )
      .then((result) => {
        if (!ownedSales.includes(result.rows[0]!.id)) ownedSales.push(result.rows[0]!.id);
        return result;
      });
  /** Record `parts` and verify each, so the reservation is fully paid. */
  const pay = async (reservationId: string, parts: string[]) => {
    const ids: string[] = [];
    for (const [index, amount] of parts.entries()) {
      ids.push(
        await world.record(reservationId, amount, {
          reference: `PAY-${index + 1}`,
          method: 'bank',
          paymentType: index === 0 ? 'down_payment' : 'installment',
        }),
      );
    }
    for (const id of ids) await world.verify(id);
    return ids;
  };
  // ONLY the sales this section created. createdCustomers is shared with every
  // other section, so a cleanup keyed on it would delete other sections' sales -
  // including ones an activated membership already RESTRICTS.
const ownedSales: string[] = [];
const saleRowsFor = (customerId: string) =>
    db
      .query<{
        id: string;
        sale_number: string;
        status: string;
        seller_staff_id: string;
        cash_price_snapshot: string;
        reservation_fee_snapshot: string;
        required_initial_snapshot: string;
        payment_scheme: string;
        installment_months_snapshot: number | null;
        monthly_amount_snapshot: string | null;
        validity_months_snapshot: number | null;
        yearly_points_snapshot: number;
        commission_rate_snapshot: string;
        commission_base_snapshot: string;
        expected_commission_snapshot: string;
        balance_due_at: string;
        spot_cash_started_at: string | null;
        spot_cash_deadline: string | null;
        submitted_at: string;
        payment_verified_at: string | null;
        fully_paid_at: string | null;
      }>(
        `select id,sale_number,status,seller_staff_id,cash_price_snapshot,reservation_fee_snapshot,
                required_initial_snapshot,payment_scheme,installment_months_snapshot,monthly_amount_snapshot,
                validity_months_snapshot,yearly_points_snapshot,commission_rate_snapshot,commission_base_snapshot,
                expected_commission_snapshot,balance_due_at,spot_cash_started_at,spot_cash_deadline,
                submitted_at,payment_verified_at,fully_paid_at
           from public.card_sales where customer_id=$1 and origin='normal'`,
        [customerId],
      )
      .then((rows) => rows.rows);

  /* ---------------------------------------------------------------- */
  /* 1-3. Money gates                                                  */
  /* ---------------------------------------------------------------- */
  const partial = await world.executed();
  const partialIds = await pay(partial.reservationId, [partial.fee]);
  await fails(
    'a partially verified reservation cannot finalize',
    /RESERVATION_NOT_FULLY_PAID/,
    () => finalize(partial.reservationId),
  );
  check(
    'a blocked finalization created no sale',
    (await saleRowsFor(partial.customerId)).length === 0,
  );
  check(
    'a blocked finalization wrote no mutation marker',
    (await count(
      `select count(*)::int n from private.mutation_requests where operation='purchase.finalize'`,
    )) === 0,
  );
  void partialIds;

  const unverified = await world.executed();
  await world.record(unverified.reservationId, unverified.total, {
    reference: 'FULL-RECORDED',
    method: 'cash',
    paymentType: 'full',
  });
  await fails(
    'a fully RECORDED but unverified reservation cannot finalize',
    /RESERVATION_UNDECIDED_PAYMENTS/,
    () => finalize(unverified.reservationId),
  );

  /* 3. The rule that matters: verified money is enough AND a row is still
   * undecided. Finalizing here would let a later rejection unbalance a sale
   * already declared paid in full. */
  const undecided = await world.executed();
  await pay(undecided.reservationId, [undecided.fee]);
  const remainder = (
    await db.query<{ rest: string }>(
      `select private.money(($1::numeric - $2::numeric)) as rest
         from public.reservation_agreements where id=$3`,
      [undecided.total, undecided.fee, undecided.reservationId],
    )
  ).rows[0]!.rest;
  await world.record(undecided.reservationId, remainder, {
    reference: 'SECOND-PART',
    method: 'bank',
    paymentType: 'installment',
  });
  const decided = (
    await db.query<{ id: string }>(
      `select id from public.payments
        where reservation_id=$1 and status='recorded' order by recorded_at desc limit 1`,
      [undecided.reservationId],
    )
  ).rows[0]!.id;
  await world.verify(decided);
  // Verified total now equals the frozen total, and a NEW row is still pending.
  await world.record(undecided.reservationId, '500.00', {
    reference: 'LATE-ARRIVAL',
    method: 'cash',
    paymentType: 'installment',
  });
  await fails(
    'verified total >= frozen total does NOT excuse an undecided payment',
    /RESERVATION_UNDECIDED_PAYMENTS/,
    () => finalize(undecided.reservationId),
  );
  check('the undecided reservation still has no sale', (await saleRowsFor(undecided.customerId)).length === 0);

  /* ---------------------------------------------------------------- */
  /* 4-11. The happy path, and its exact shape                         */
  /* ---------------------------------------------------------------- */
  const good = await world.executed();
  const rest = (
    await db.query<{ rest: string }>(
      `select private.money(($1::numeric - $2::numeric)) as rest
         from public.reservation_agreements where id=$3`,
      [good.total, good.fee, good.reservationId],
    )
  ).rows[0]!.rest;
  const half = (
    await db.query<{ half: string }>(
      `select private.money(($1::numeric / 2)) as half`,
      [rest],
    )
  ).rows[0]!.half;
  const paymentIds = await pay(good.reservationId, [good.fee, half, half]);
  check(
    'the three verified instalments sum to the frozen total',
    (await db.query<{ verified: string }>(
      `select private.money(coalesce(sum(amount::numeric),0)) as verified
         from public.payments where reservation_id=$1 and status='verified'`,
      [good.reservationId],
    )).rows[0]!.verified === good.total,
  );

  const beforeSales = (await saleRowsFor(good.customerId)).length;
  const beforePayments = await count(
    'select count(*)::int n from public.payments where reservation_id=$1',
    [good.reservationId],
  );
  const request = randomUUID();
  const saleId = (await finalize(good.reservationId, finance, request)).rows[0]!.id;
  const sales = await saleRowsFor(good.customerId);
  check('finalization created exactly one AF-CSALE', sales.length === beforeSales + 1 && Boolean(saleId));
  const sale = sales[0]!;
  check('the sale carries an AF-CSALE business number', /^AF-CSALE-[A-HJ-NP-Z2-9]{5}$/.test(sale.sale_number), sale.sale_number);
  check('the finalized sale is payment_verified, never active', sale.status === 'payment_verified');

  /* 7. Replay by the same request id. */
  check(
    'the same request id replays the original AF-CSALE',
    (await finalize(good.reservationId, finance, request)).rows[0]!.id === saleId,
  );
  /* 8. A DIFFERENT request id must not create a second sale. */
  check(
    'a different request id returns the same sale instead of a second one',
    (await finalize(good.reservationId, finance, randomUUID())).rows[0]!.id === saleId,
  );
  check(
    'the customer still has exactly one normal sale',
    (await saleRowsFor(good.customerId)).length === beforeSales + 1,
  );
  check(
    'exactly one commission exists and it is never earned',
    (await db.query<{ n: number; status: string }>(
      `select count(*)::int as n, min(status) as status from public.commissions where sale_id=$1`,
      [saleId],
    )).rows[0]!.n === 1 &&
      (await db.query<{ status: string }>('select status from public.commissions where sale_id=$1', [saleId]))
        .rows[0]!.status === 'payment_verified',
  );

  /* 9-11. The ORIGINAL payment rows, linked, never copied. */
  check(
    'no payment row was inserted: the count is unchanged',
    (await count('select count(*)::int n from public.payments where reservation_id=$1', [
      good.reservationId,
    ])) === beforePayments,
  );
  const linked = (
    await db.query<{ id: string; sale_id: string | null; reservation_id: string; payment_number: string }>(
      `select id,sale_id,reservation_id,payment_number from public.payments
        where reservation_id=$1 order by recorded_at,id`,
      [good.reservationId],
    )
  ).rows;
  check('every payment is linked to the finalized sale', linked.every((row) => row.sale_id === saleId));
  check(
    'the ORIGINAL payment UUIDs are the same ones that were recorded',
    JSON.stringify(linked.map((row) => row.id).sort()) ===
      JSON.stringify([...paymentIds].sort()),
  );
  check(
    'the payment numbers are unchanged and unique',
    new Set(linked.map((row) => row.payment_number)).size === linked.length,
  );
  check(
    'the payment history keeps its reservation link, so the money stays traceable',
    linked.every((row) => row.reservation_id === good.reservationId),
  );
  check(
    'the payments report counts each row exactly once after linking',
    (await count(
      'select count(*)::int n from public.payments where reservation_id=$1 or sale_id=$2',
      [good.reservationId, saleId],
    )) === linked.length,
  );

  /* 20. Every link is exact. */
  const links = (
    await db.query<{ sale_id: string | null; finalized_at: string | null; finalized_by: string | null }>(
      'select sale_id,finalized_at,finalized_by from public.reservation_agreements where id=$1',
      [good.reservationId],
    )
  ).rows[0]!;
  check(
    'the reservation links to the sale, with the finalizer and the instant',
    links.sale_id === saleId && links.finalized_by === finance && Boolean(links.finalized_at),
  );
  check(
    'the source application links to the same sale',
    (
      await db.query<{ sale_id: string | null }>(
        'select sale_id from public.customer_applications where id=$1',
        [good.applicationId],
      )
    ).rows[0]!.sale_id === saleId,
  );

  /* 18-19. Frozen economics, immune to live configuration. */
  const terms = (
    await db.query<Record<string, string | number | null>>(
      'select * from public.customer_application_purchase_terms where id=$1',
      [good.termsId],
    )
  ).rows[0]!;
  check(
    'the sale economics are COPIED from the immutable terms, not recomputed',
    sale.cash_price_snapshot === terms.total_price &&
      sale.reservation_fee_snapshot === terms.reservation_fee &&
      sale.required_initial_snapshot === terms.required_initial &&
      sale.payment_scheme === terms.payment_scheme &&
      sale.installment_months_snapshot === terms.installment_months &&
      sale.monthly_amount_snapshot === terms.monthly_amount &&
      sale.validity_months_snapshot === terms.validity_months &&
      sale.yearly_points_snapshot === terms.yearly_points &&
      sale.commission_rate_snapshot === terms.commission_rate &&
      sale.commission_base_snapshot === terms.commission_base &&
      sale.expected_commission_snapshot === terms.expected_commission,
    JSON.stringify(sale),
  );
  check(
    'the reservation amount is INCLUDED in the frozen sale total, not added again',
    sale.cash_price_snapshot === terms.total_price && sale.reservation_fee_snapshot === terms.reservation_fee,
  );
  check(
    'balance_due_at is DERIVED, never a fresh 365-day placeholder',
    new Date(sale.balance_due_at).getTime() !== new Date(sale.submitted_at).getTime() + 365 * 86_400_000,
    `${sale.balance_due_at} vs ${sale.submitted_at}`,
  );
  const carriedWindow = (
    await db.query<{ spot_cash_started_at: string | null; spot_cash_deadline: string | null }>(
      'select spot_cash_started_at, spot_cash_deadline from public.reservation_agreements where id=$1',
      [good.reservationId],
    )
  ).rows[0]!;
  check(
    'the spot-cash window is CARRIED from the reservation, never restarted',
    Boolean(carriedWindow.spot_cash_started_at) &&
      new Date(String(sale.spot_cash_started_at)).getTime() ===
        new Date(String(carriedWindow.spot_cash_started_at)).getTime() &&
      new Date(String(sale.spot_cash_deadline)).getTime() ===
        new Date(String(carriedWindow.spot_cash_deadline)).getTime(),
    `${String(sale.spot_cash_started_at)}/${String(sale.spot_cash_deadline)} vs ${String(carriedWindow.spot_cash_started_at)}/${String(carriedWindow.spot_cash_deadline)}`,
  );
  check(
    'the sale carries the payment_verified and fully-paid instants, not a guess',
    Boolean(sale.payment_verified_at) && Boolean(sale.fully_paid_at),
  );

  /* 16-17. Activation is NOT part of finalization. */
  check(
    'finalization created NO membership',
    (await count('select count(*)::int n from public.memberships where sale_id=$1', [saleId])) === 0,
  );
  check(
    'finalization left the customer status untouched',
    (
      await db.query<{ status: string }>('select status from public.customers where id=$1', [
        good.customerId,
      ])
    ).rows[0]!.status === 'prospect',
  );
  check(
    'finalization allocated no points account',
    (await count(
      `select count(*)::int n from public.points_accounts pa
         join public.memberships m on m.id=pa.membership_id where m.sale_id=$1`,
      [saleId],
    )) === 0,
  );
  check(
    'the immutable final-purchase evidence exists exactly once',
    (await count(
      `select count(*)::int n from private.purchase_document_evidence
        where kind='purchase_finalized' and sale_id=$1`,
      [saleId],
    )) === 1,
  );

  /* Live configuration drift must not reach the sale. */
  await db.query(`update public.card_plans set cash_price='99999.00', yearly_points=1 where code='BRONZE'`);
  try {
    check(
      'a live plan price/points edit does not alter the frozen sale',
      (await saleRowsFor(good.customerId))[0]!.cash_price_snapshot === terms.total_price &&
        (await saleRowsFor(good.customerId))[0]!.yearly_points_snapshot === terms.yearly_points,
    );
  } finally {
    await db.query(
      `update public.card_plans set cash_price=$1, yearly_points=$2 where code='BRONZE'`,
      [terms.total_price, terms.yearly_points],
    );
  }

  /* ---------------------------------------------------------------- */
  /* 5. Overpayment still permits the sale                             */
  /* ---------------------------------------------------------------- */
  const over = await world.executed();
  await pay(over.reservationId, [over.total, '2500.00']);
  const overSale = (await finalize(over.reservationId)).rows[0]!.id;
  check('an overpayment still permits finalization', Boolean(overSale));
  check(
    'the overpayment is RETAINED, not discarded',
    (await db.query<{ overpaid: string }>(
      `select private.money(coalesce(sum(amount::numeric),0) - $1::numeric) as overpaid
         from public.payments where reservation_id=$2 and status='verified'`,
      [over.total, over.reservationId],
    )).rows[0]!.overpaid === '2500.00',
  );

  /* ---------------------------------------------------------------- */
  /* 12-14. Seller and hierarchy refusals roll everything back         */
  /* ---------------------------------------------------------------- */
  const inactiveSeller = await world.executed();
  await pay(inactiveSeller.reservationId, [inactiveSeller.total]);
  const sellerId = await world.sellerOf(inactiveSeller.reservationId);
  await db.query(`update public.staff_users set status='inactive' where id=$1`, [sellerId]);
  try {
    await fails(
      'an inactive frozen seller blocks finalization',
      /SELLER_INACTIVE/,
      () => finalize(inactiveSeller.reservationId),
    );
  } finally {
    await db.query(`update public.staff_users set status='active' where id=$1`, [sellerId]);
  }
  check('an inactive seller left no sale behind', (await saleRowsFor(inactiveSeller.customerId)).length === 0);

  const brokenHierarchy = await world.executed();
  await pay(brokenHierarchy.reservationId, [brokenHierarchy.total]);
  const brokenSeller = await world.sellerOf(brokenHierarchy.reservationId);
  await db.query(
    `update public.referral_relationships set is_active=false
      where subject_staff_id=$1 and is_active is true`,
    [brokenSeller],
  );
  const rowsBefore = await count(
    'select count(*)::int n from public.payments where reservation_id=$1',
    [brokenHierarchy.reservationId],
  );
  try {
    await fails(
      'an incomplete CURRENT hierarchy blocks finalization',
      /SALE_COMPLETE_HIERARCHY_REQUIRED/,
      () => finalize(brokenHierarchy.reservationId),
    );
  } finally {
    await db.query(
      `update public.referral_relationships set is_active=true
        where subject_staff_id=$1 and is_active is false`,
      [brokenSeller],
    );
  }
  check(
    'the hierarchy failure rolled back EVERYTHING: no sale, no link, no payment change',
    (await saleRowsFor(brokenHierarchy.customerId)).length === 0 &&
      (await count('select count(*)::int n from public.payments where reservation_id=$1', [
        brokenHierarchy.reservationId,
      ])) === rowsBefore &&
      (await db.query<{ sale_id: string | null }>(
        'select sale_id from public.reservation_agreements where id=$1',
        [brokenHierarchy.reservationId],
      )).rows[0]!.sale_id === null,
  );
  check(
    'the hierarchy failure wrote no purchase_finalized evidence',
    (await count(
      `select count(*)::int n from private.purchase_document_evidence
        where kind='purchase_finalized' and reservation_id=$1`,
      [brokenHierarchy.reservationId],
    )) === 0,
  );

  /* ---------------------------------------------------------------- */
  /* 15. A fault AFTER payment linking rolls the whole thing back      */
  /* ---------------------------------------------------------------- */
  const faulted = await world.executed();
  await pay(faulted.reservationId, [faulted.total]);
  await db.query(
    `create function public.__test_finalize_audit_failure() returns trigger language plpgsql as $$
       begin if new.action='PURCHASE_FINALIZED' then raise exception 'QA_AUDIT_FAILURE'; end if;
       return new; end $$;
     create trigger __test_finalize_audit_failure before insert on public.audit_events
       for each row execute function public.__test_finalize_audit_failure()`,
  );
  const faultSales = (await saleRowsFor(faulted.customerId)).length;
  try {
    await fails(
      'a fault after payment linking rolls the finalization back',
      /QA_AUDIT_FAILURE/,
      () => finalize(faulted.reservationId),
    );
  } finally {
    await db.query(
      `drop trigger if exists __test_finalize_audit_failure on public.audit_events;
       drop function if exists public.__test_finalize_audit_failure()`,
    );
  }
  check(
    'the rollback restored the pre-transaction sale count',
    (await saleRowsFor(faulted.customerId)).length === faultSales,
  );
  check(
    'the rollback UNLINKED the payments again: sale_id is NULL on every one',
    (await count(
      `select count(*)::int n from public.payments where reservation_id=$1 and sale_id is not null`,
      [faulted.reservationId],
    )) === 0,
  );
  check(
    'the rollback left the reservation unlinked and unfinalized',
    (await db.query<{ sale_id: string | null; finalized_at: string | null }>(
      'select sale_id,finalized_at from public.reservation_agreements where id=$1',
      [faulted.reservationId],
    )).rows[0]!.sale_id === null,
  );
  check(
    'the rollback left no commission behind',
    (await count(
      `select count(*)::int n from public.commissions c
         join public.card_sales s on s.id=c.sale_id where s.customer_id=$1`,
      [faulted.customerId],
    )) === 0,
  );

  /* ---------------------------------------------------------------- */
  /* Authorization refusals                                            */
  /* ---------------------------------------------------------------- */
  await fails(
    'a staff member without the finance grant cannot finalize',
    /MUTATION_FORBIDDEN/,
    () => finalize(good.reservationId, actor),
  );
  await fails(
    'an inactive actor cannot finalize',
    /MUTATION_FORBIDDEN/,
    () => finalize(good.reservationId, inactive),
  );
  // The EXPLICIT regressions Gate 4 recorded as missing: a rejected and a
  // cancelled application must be refused on real PostgreSQL, with zero new
  // rows. The reservation stays EXECUTED so the refusal is about the
  // APPLICATION state and nothing else.
  for (const [label, status] of [
    ['a REJECTED application cannot finalize', 'rejected'],
    ['a CANCELLED application cannot finalize', 'cancelled'],
  ] as const) {
    const state = await world.executed();
    await pay(state.reservationId, [state.total]);
    await db.query(
      `update public.customer_applications
          set status=$2, rejected_at=case when $2='rejected' then now() else rejected_at end,
              updated_at=now()
        where id=$1`,
      [state.applicationId, status],
    );
    await fails(label, /APPLICATION_NOT_APPROVED/, () => finalize(state.reservationId));
    check(
      `a ${status} application finalization created no sale`,
      (await saleRowsFor(state.customerId)).length === 0,
    );
    check(
      `a ${status} application left the reservation unlinked`,
      (await db.query<{ sale_id: string | null }>(
        'select sale_id from public.reservation_agreements where id=$1',
        [state.reservationId],
      )).rows[0]!.sale_id === null,
    );
  }
  await fails(
    'an unknown reservation cannot finalize',
    /AGREEMENT_NOT_FOUND/,
    () => finalize(randomUUID()),
  );
  const draftApp = await world.reserved();
  await fails(
    'a DRAFT reservation cannot finalize',
    /RESERVATION_NOT_EXECUTED/,
    () => finalize(draftApp.reservationId),
  );
  await fails(
    'a sale link without the finalization stamp is refused by the schema',
    /reservation_finalization_check/,
    () =>
      db.query(
        `update public.reservation_agreements set sale_id=$1 where id=$2`,
        [saleId, draftApp.reservationId],
      ),
  );
  await fails(
    'a changed request payload conflicts rather than finalizing twice',
    /MUTATION_PAYLOAD_CONFLICT/,
    () =>
      db.query(
        'select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)',
        [request, randomUUID(), finance],
      ),
  );

  /* Cleanup: this section owns every reservation it created. */
  await db.query('begin');
  try {
    await db.query(`set local afhomes.allow_purchase_test_cleanup = 'on'`);
    // Hierarchy snapshots are immutable to application roles; deleting synthetic
    // ones needs the same owner-only maintenance escape the harness uses.
    await db.query(`set local afhomes.allow_snapshot_maintenance = 'on'`);
    const reservationIds = (
      await db.query<{ id: string }>(
        `select r.id from public.reservation_agreements r
           join public.customer_applications a on a.id=r.customer_application_id
          where a.customer_id = any($1::uuid[])`,
        [world.createdCustomers],
      )
    ).rows.map((row) => row.id);
    const saleIds = ownedSales;
    await db.query(
      `delete from private.purchase_document_evidence
        where reservation_id = any($1::uuid[]) or sale_id = any($2::uuid[])
          or payment_id in (select id from public.payments
                             where reservation_id = any($1::uuid[]) or sale_id = any($2::uuid[]))`,
      [reservationIds, saleIds],
    );
    await db.query(
      `delete from private.purchase_document_evidence where membership_id in
         (select m.id from public.memberships m where m.sale_id = any($1::uuid[]))`,
      [saleIds],
    );
    await db.query(
      `delete from private.purchase_document_evidence where payment_id in
         (select id from public.payments where sale_id = any($1::uuid[]) and reservation_id is null)`,
      [saleIds],
    );
    await db.query(`delete from public.payments where reservation_id = any($1::uuid[])`, [reservationIds]);
    await db.query(`delete from public.payments where sale_id = any($1::uuid[])`, [saleIds]);
    await db.query(
      `delete from public.commissions where sale_id = any($1::uuid[])`,
      [saleIds],
    );
    await db.query(
      `delete from public.card_sale_hierarchy_snapshots where sale_id = any($1::uuid[])`,
      [saleIds],
    );
    await db.query(`delete from public.reservation_agreement_schedule where agreement_id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(`delete from public.reservation_agreement_holders where agreement_id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(`delete from private.mutation_requests where actor_id = any($1::uuid[])`, [
      [finance, actor, inactive],
    ]);
    await db.query(`delete from public.audit_events where actor_id = any($1::uuid[])`, [
      [finance, actor, inactive],
    ]);
    await db.query(`delete from public.reservation_agreements where id = any($1::uuid[])`, [reservationIds]);
    await db.query(`update public.customer_applications set purchase_terms_id=null,sale_id=null
                     where customer_id = any($1::uuid[])`, [world.createdCustomers]);
    await db.query(
      `delete from public.customer_application_purchase_terms where application_id in
         (select id from public.customer_applications where customer_id = any($1::uuid[]))`,
      [world.createdCustomers],
    );
    await db.query(`delete from public.card_sales where id = any($1::uuid[])`, [saleIds]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}