/**
 * Task E/F database proof: Finance collects against an EXECUTED reservation with
 * no card sale, in the ONE existing ledger, and verification takes the parent
 * locks first - on REAL PostgreSQL, with two independent sessions where the
 * question is lock order.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

type Check = (label: string, ok: boolean, detail?: string) => void;

type Summary = {
  origin: string;
  reservationId: string | null;
  saleId: string | null;
  status: string;
  totalPrice: string;
  reservationFee: string;
  requiredInitial: string;
  recordedTotal: string;
  verifiedTotal: string;
  rejectedTotal: string;
  recordedPaymentCount: number;
  remainingBalance: string;
  overpaidAmount: string;
  fullyPaid: boolean;
  firstVerifiedPayment: string | null;
  spotCashDeadline: string | null;
};

type VerificationResult = {
  paymentId: string;
  reservationId: string | null;
  saleId: string | null;
  status: string;
  verifiedBefore: string;
  verifiedTotal: string;
  balanceBefore: string;
  remainingBalance: string;
  fullyPaid: boolean;
  documentEvidenceId: string | null;
};

/**
 * A scalar `returns jsonb` RPC comes back from the raw driver under the
 * function-name column. PostgREST hands the API handler the object itself, so
 * only the driver needs the unwrap.
 */
function unwrap<T>(column: unknown): T {
  const value = (column ?? {}) as Record<string, unknown>;
  return (('v' in value ? value.v : 's' in value ? value.s : value) ?? value) as T;
}
void unwrap;

type World = {
  db: Client;
  url: string;
  check: Check;
  actor: string;
  finance: string;
  superAdmin: string;
  staff: Record<string, string>;
  /** An approved application with frozen terms and an EXECUTED reservation. */
  executed: () => Promise<{
    applicationId: string;
    customerId: string;
    reservationId: string;
    termsId: string;
    total: string;
    fee: string;
  }>;
  record: (reservationId: string, amount: string, extra?: Record<string, unknown>) => Promise<string>;
  createdCustomers: string[];
};

export async function runReservationFinanceChecks(world: World) {
  const { db, check, finance, staff } = world;
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

  type VerifyExtra = { requestId?: string; reason?: string; actor?: string };
  const verify = (
    paymentId: string,
    decision: 'verified' | 'rejected',
    extra: VerifyExtra = {},
  ) =>
    db.query<{ v: VerificationResult }>(
      'select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid) as v',
      [extra.requestId ?? randomUUID(), paymentId, decision, extra.reason ?? null, extra.actor ?? finance],
    ).then((rows) => unwrap<VerificationResult>(rows.rows[0]!.v));

  const summaryOf = async (sourceId: string) =>
    unwrap<Summary>(
      (
        await db.query<{ s: Summary }>(
          'select public.purchase_financial_summary($1::uuid) as s',
          [sourceId],
        )
      ).rows[0]!.s,
    );

  /* ---------------------------------------------------------------- */
  /* The queue must include the executed reservation with no sale      */
  /* ---------------------------------------------------------------- */
  const purchase = await world.executed();
  const queueRow = (
    await db.query<{
      id: string;
      reservation_number: string;
      status: string;
      sale_id: string | null;
      application_status: string;
    }>(
      `select r.id, r.reservation_number, r.status, r.sale_id, a.status as application_status
         from public.reservation_agreements r
         join public.customer_applications a on a.id = r.customer_application_id
        where r.origin='application' and r.status='executed' and r.sale_id is null`,
    )
  ).rows;
  check(
    'an executed application-origin reservation is queue-eligible',
    queueRow.some((row) => row.id === purchase.reservationId && row.application_status === 'approved'),
  );
  check(
    'the queued reservation still has no card sale',
    Boolean(purchase.reservationId) && queueRow.every((row) => row.sale_id === null),
  );

  /* ---------------------------------------------------------------- */
  /* Collection before any verification                               */
  /* ---------------------------------------------------------------- */
  const firstPayment = await world.record(purchase.reservationId, purchase.fee);
  const paymentRow = (
    await db.query<{
      id: string;
      origin: string;
      reservation_id: string;
      sale_id: string | null;
      customer_id: string;
      payment_number: string;
      status: string;
      amount: string;
    }>('select * from public.payments where id=$1', [firstPayment])
  ).rows[0]!;
  check(
    'the recorded payment is ONE row in the existing ledger',
    Boolean(paymentRow),
    JSON.stringify(paymentRow ?? {}),
  );
  check('the payment is reservation-origin', paymentRow.origin === 'reservation');
  check('the reservation link is populated', paymentRow.reservation_id === purchase.reservationId);
  check('sale_id is NULL before finalization', paymentRow.sale_id === null);
  check(
    'the customer link is populated from the reservation',
    paymentRow.customer_id === purchase.customerId,
  );
  check(
    'the payment carries an AF-PAY business number',
    /^AF-PAY-[A-HJ-NP-Z2-9]{5}$/.test(String(paymentRow.payment_number)),
    String(paymentRow.payment_number),
  );

  const recordedSummary = await summaryOf(purchase.reservationId);
  check(
    'the reserved-to-total amount is INCLUDED, so the remaining balance is the full total',
    recordedSummary.remainingBalance === purchase.total,
    `${recordedSummary.verifiedTotal}/${recordedSummary.remainingBalance}`,
  );
  check(
    'recorded but NOT verified: verified total is zero and nothing is fully paid',
    recordedSummary.verifiedTotal === '0.00' && recordedSummary.fullyPaid === false,
    recordedSummary.verifiedTotal,
  );
  check(
    'the recorded total shows the amount awaiting verification',
    recordedSummary.recordedTotal === purchase.fee,
    recordedSummary.recordedTotal,
  );

  /* ---------------------------------------------------------------- */
  /* Only Finance may record, and only on an executed reservation     */
  /* ---------------------------------------------------------------- */
  await fails(
    'a staff member without the finance grant cannot record',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query('select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [
        randomUUID(),
        purchase.reservationId,
        { amount: '1.00', method: 'cash', paymentType: 'installment' },
        world.actor,
      ]),
  );
  await fails(
    'an inactive actor cannot record',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query('select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [
        randomUUID(),
        purchase.reservationId,
        { amount: '1.00', method: 'cash', paymentType: 'installment' },
        inactive,
      ]),
  );
  await fails(
    'a non-positive amount is refused',
    /AMOUNT_MUST_BE_POSITIVE/,
    () =>
      db.query('select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [
        randomUUID(),
        purchase.reservationId,
        { amount: '0.00', method: 'cash', paymentType: 'installment' },
        finance,
      ]),
  );
  await fails(
    'an unknown payment type is refused',
    /INVALID_PAYMENT_TYPE/,
    () =>
      db.query('select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [
        randomUUID(),
        purchase.reservationId,
        { amount: '1.00', method: 'cash', paymentType: 'cash_topup' },
        finance,
      ]),
  );
  check(
    'no refused recording attempt created a payment row',
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from public.payments where reservation_id=$1',
        [purchase.reservationId],
      )
    ).rows[0]!.n === 1,
  );

  /* Idempotency and duplicate references */
  // Argument order mirrors the signature exactly: request, reservation, input,
  // actor. Every call site below states the reservation second, so a swapped pair
  // is a type error rather than a silently recorded payment against the wrong row.
  const recordRaw = (
    requestId: string,
    input: Record<string, unknown>,
    who: string,
    reservationId = purchase.reservationId,
  ) =>
    db.query<{ id: string }>(
      'select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid) as id',
      [requestId, reservationId, input, who],
    );
  const recordRequest = randomUUID();
  const firstInstallment = {
    amount: '25000.00',
    method: 'bank',
    paymentType: 'installment',
    reference: 'REF-A',
  };
  const replay = (await recordRaw(recordRequest, firstInstallment, finance)).rows[0]!.id;
  const replayAgain = (await recordRaw(recordRequest, firstInstallment, finance)).rows[0]!.id;
  check('the same request id replays the same payment', replay === replayAgain);
  await fails(
    'the same request id with a changed amount conflicts',
    /MUTATION_PAYLOAD_CONFLICT/,
    () => recordRaw(recordRequest, { ...firstInstallment, amount: '25000.01' }, finance),
  );
  await fails(
    'a duplicate reference on the same reservation is refused',
    /payments_reservation_reference_unique/,
    () =>
      recordRaw(
        randomUUID(),
        { amount: '1.00', method: 'bank', paymentType: 'installment', reference: 'REF-A' },
        finance,
      ),
  );
  check(
    'exactly two payments exist: the replay and the duplicate added nothing',
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from public.payments where reservation_id=$1',
        [purchase.reservationId],
      )
    ).rows[0]!.n === 2,
  );

  /* ---------------------------------------------------------------- */
  /* Verification: parent-first, recorded only, reason on rejection    */
  /* ---------------------------------------------------------------- */
  await fails(
    'verifying an already-decided payment is refused',
    /PAYMENT_NOT_PENDING/,
    async () => {
      await verify(replay, 'verified');
      await verify(replay, 'verified');
    },
  );
  await fails(
    'a rejection without a reason is refused',
    /REJECTION_REASON_REQUIRED/,
    () => db.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [randomUUID(), firstPayment, 'rejected', null, finance]),
  );
  await fails(
    'a non-finance actor cannot verify',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [
        randomUUID(),
        firstPayment,
        'verified',
        null,
        world.actor,
      ]),
  );

  // The first verification below is of the FEE, but the 25,000 installment was
// verified earlier in this section, so the before figure is that money and the
// after figure is the running total. Asserted relatively and exactly in cents:
// a hard-coded zero here would only be right for the first payment ever made.
const verifiedBefore = '25000.00';
const verifyResult = await verify(firstPayment, 'verified');
check(
  'verification returns the exact before/after figures',
  verifyResult.verifiedBefore === verifiedBefore &&
    verifyResult.verifiedTotal === moneyAdd(verifiedBefore, purchase.fee) &&
    verifyResult.balanceBefore === moneySubtract(purchase.total, verifiedBefore) &&
    verifyResult.remainingBalance === moneySubtract(purchase.total, verifyResult.verifiedTotal) &&
    verifyResult.fullyPaid === false,
  JSON.stringify(verifyResult),
);
  check(
    'verification names the reservation source and never a sale',
    verifyResult.reservationId === purchase.reservationId && verifyResult.saleId === null,
  );
  const evidence = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from private.purchase_document_evidence
        where kind='payment_verified' and payment_id=$1 and revision=1`,
      [firstPayment],
    )
  ).rows[0]!.n;
  check('an immutable verified receipt was persisted', evidence === 1);
  const recordedEvidence = (
    await db.query<{ n: number }>(
      `select count(*)::int as n from private.purchase_document_evidence
        where kind='payment_recorded' and payment_id=$1`,
      [firstPayment],
    )
  ).rows[0]!.n;
  check('the recorded receipt from recording time still exists', recordedEvidence === 1);

  // The spot-cash window opens ONCE, on the first verified payment, with the
  // frozen number of days.
  const window = (
    await db.query<{ start: string | null; deadline: string | null; days: number }>(
      'select spot_cash_started_at as start, spot_cash_deadline as deadline, spot_cash_days_snapshot as days from public.reservation_agreements where id=$1',
      [purchase.reservationId],
    )
  ).rows[0]!;
  check('the spot-cash window opened on the first verified payment', Boolean(window.start && window.deadline));
  const days = (
    (new Date(String(window.deadline)).getTime() - new Date(String(window.start)).getTime()) /
    86_400_000
  ).toFixed(2);
  check(
    'the window uses the FROZEN spot-cash days, not a fresh constant',
    Number(days) === Number(window.days),
    `${days} vs ${window.days}`,
  );
  const startBefore = window.start;
  const deadlineBefore = window.deadline;
  // A SECOND, still-recorded payment. Verifying an already-decided one would be
  // refused outright, so the window check needs fresh money to move.
  const laterPayment = await world.record(purchase.reservationId, '500.00', {
    reference: 'REF-LATER',
    method: 'cash',
  });
  await verify(laterPayment, 'verified');
  const windowAfter = (
    await db.query<{ start: string | null; deadline: string | null }>(
      'select spot_cash_started_at as start, spot_cash_deadline as deadline from public.reservation_agreements where id=$1',
      [purchase.reservationId],
    )
  ).rows[0]!;
  check(
    'a later verification never restarts the window',
    new Date(String(windowAfter.start)).getTime() === new Date(String(startBefore)).getTime() &&
      new Date(String(windowAfter.deadline)).getTime() === new Date(String(deadlineBefore)).getTime(),
    `${String(startBefore)}->${String(windowAfter.start)} / ${String(deadlineBefore)}->${String(windowAfter.deadline)}`,
  );

  /* Replay preserves the ORIGINAL evidence, not the current totals. A fresh
   payment is used so the replay is the FIRST decision on it, exactly like a lost
   response retried after the commit. */
  const replayPayment = await world.record(purchase.reservationId, '750.00', {
    reference: 'REF-REPLAY',
    method: 'cash',
  });
  const replayRequest = randomUUID();
  const original = await verify(replayPayment, 'verified', { requestId: replayRequest });
  const replayed = await verify(replayPayment, 'verified', { requestId: replayRequest });
  check(
    'a verification replay returns the ORIGINAL committed result',
    JSON.stringify(original) === JSON.stringify(replayed),
    `${JSON.stringify(original)} vs ${JSON.stringify(replayed)}`,
  );
  check(
    'the replay reports the balance as it was when the decision committed',
    original.remainingBalance === replayed.remainingBalance,
  );
  await fails(
    'a replay with a changed decision conflicts',
    /MUTATION_PAYLOAD_CONFLICT/,
    () =>
      verify(replayPayment, 'rejected', {
        requestId: replayRequest,
        reason: 'Changed my mind on the replay.',
      }),
  );
  check(
    'the replay appended no second verified receipt',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from private.purchase_document_evidence
          where kind='payment_verified' and payment_id=$1`,
        [replayPayment],
      )
    ).rows[0]!.n === 1,
  );
  check(
    'verification never activates a membership',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.memberships m
           join public.reservation_agreements r on r.customer_id=m.customer_id
          where r.id=$1`,
        [purchase.reservationId],
      )
    ).rows[0]!.n === 0,
  );

  /* A rejection gets a decision audit and NO verified receipt. */
  const rejectedPayment = await world.record(purchase.reservationId, '500.00', {
    reference: 'REF-REJ',
    method: 'cash',
  });
  await verify(rejectedPayment, 'rejected', { reason: 'Cash not received in the bank.' });
  check(
    'a rejected payment gets a decision audit and no verified receipt',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from private.purchase_document_evidence
          where kind='payment_verified' and payment_id=$1`,
        [rejectedPayment],
      )
    ).rows[0]!.n === 0 &&
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.audit_events
            where entity_type='payment' and entity_id=$1 and action='PAYMENT_REJECTED' and reason is not null`,
          [rejectedPayment],
        )
      ).rows[0]!.n === 1,
  );
  check(
    'the rejection reason is stored on the payment',
    String(
      (
        await db.query<{ rejection_reason: string | null }>(
          'select rejection_reason from public.payments where id=$1',
          [rejectedPayment],
        )
      ).rows[0]!.rejection_reason,
    ) === 'Cash not received in the bank.',
  );

  /* ---------------------------------------------------------------- */
  /* CONCURRENCY: parent-first locking, two independent sessions      */
  /* ---------------------------------------------------------------- */
  const fresh = await world.executed();
  await world.record(fresh.reservationId, '10000.00', {
    reference: 'REF-C1',
    method: 'cash',
  });
  const concurrentPayment = (
    await db.query<{ id: string }>(
      'select id from public.payments where reservation_id=$1 order by recorded_at desc limit 1',
      [fresh.reservationId],
    )
  ).rows[0]!.id;

  // The deadlock pair: a recorder that takes RESERVATION then PAYMENT, and a
  // verifier that takes PAYMENT then RESERVATION. Under the old order these two
  // sessions deadlock and PostgreSQL answers 40P01; under the approved
  // parent-first order both simply queue behind each other and commit.
  const other = new Client({ connectionString: world.url });
  await other.connect();
  try {
    const recorder = other.query(
      `select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)`,
      [
        randomUUID(),
        fresh.reservationId,
        { amount: '100.00', method: 'cash', paymentType: 'installment', reference: 'REF-C2' },
        finance,
      ],
    );
    const verifier = verify(concurrentPayment, 'verified');
    const [recorderResult, verifierResult] = await Promise.allSettled([recorder, verifier]);
    check(
      'a recorder and a verifier on one reservation never deadlock',
      recorderResult.status === 'fulfilled' && verifierResult.status === 'fulfilled',
      `${recorderResult.status}(${recorderResult.status === 'rejected' ? String((recorderResult.reason as Error)?.message).split('\n')[0] : ''})/${verifierResult.status}(${verifierResult.status === 'rejected' ? String((verifierResult.reason as Error)?.message).split('\n')[0] : ''})`,
    );
    check(
      'a deadlock would surface as 40P01, not as any other failure',
      ![recorderResult, verifierResult].some(
        (result) =>
          result.status === 'rejected' &&
          /deadlock|40P01/i.test(
            result.reason instanceof Error ? result.reason.message : String(result.reason),
          ),
      ),
    );
  } finally {
    await other.end().catch(() => {});
  }

  check(
    'the concurrent pair left exactly one verified payment',
    (
      await db.query<{ verified: number }>(
        `select count(*) filter (where status='verified')::int as verified
           from public.payments where reservation_id=$1`,
        [fresh.reservationId],
      )
    ).rows[0]!.verified === 1,
  );

  /* Legacy sale-origin payments still verify through the parent-first RPC. */
  const legacy = await db.query<{ id: string }>(
    `insert into public.payments(sale_id,customer_id,amount,payment_type,method,reference,status,recorded_by)
     values ($1,$2,'100.00','installment','cash','LEG-1','recorded',$3) returning id`,
    [await legacySaleFor(db, world), world.createdCustomers[0]!, finance],
  );
  const legacyPayment = legacy.rows[0]!.id;
  const legacyResult = await verify(legacyPayment, 'verified');
  check(
    'a legacy sale-origin payment still verifies through the same RPC',
    legacyResult.status === 'verified' && legacyResult.reservationId === null,
    JSON.stringify(legacyResult),
  );

  /* Cleanup: everything this section created. */
  await db.query('begin');
  try {
    await db.query(`set local afhomes.allow_purchase_test_cleanup = 'on'`);
    const reservationIds = (
      await db.query<{ id: string }>(
        `select r.id from public.reservation_agreements r
           join public.customer_applications a on a.id = r.customer_application_id
          where a.customer_id = any($1::uuid[])`,
        [world.createdCustomers],
      )
    ).rows.map((row) => row.id);
    await db.query(`delete from private.purchase_document_evidence where reservation_id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(
      `delete from private.purchase_document_evidence where payment_id in
         (select id from public.payments where reservation_id = any($1::uuid[]))`,
      [reservationIds],
    );
    await db.query(`delete from public.payments where reservation_id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(`delete from public.reservation_agreement_schedule where agreement_id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(`delete from public.reservation_agreement_holders where agreement_id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(`delete from private.mutation_requests where actor_id = any($1::uuid[])`, [
      [finance, world.actor, inactive],
    ]);
    await db.query(`delete from public.audit_events where actor_id = any($1::uuid[])`, [
      [finance, world.actor, inactive],
    ]);
    // The agreements go FIRST. Nulling the application pointer while a live
    // agreement still references the terms trips PURCHASE_TERMS_VERSION_FROZEN,
    // which is the rule doing its job: a frozen source cannot be re-pointed.
    await db.query(`delete from public.reservation_agreements where id = any($1::uuid[])`, [
      reservationIds,
    ]);
    await db.query(`update public.customer_applications set purchase_terms_id=null where customer_id = any($1::uuid[])`, [
      world.createdCustomers,
    ]);
    await db.query(`delete from public.customer_application_purchase_terms where application_id in
                      (select id from public.customer_applications where customer_id = any($1::uuid[]))`, [
      world.createdCustomers,
    ]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}

/** A legacy sale row for this section's sale-origin verification check. */
async function legacySaleFor(db: Client, world: World): Promise<string> {
  const existing = await db.query<{ id: string }>(
    `select id from public.card_sales
      where customer_id = any($1::uuid[]) and origin='normal'
        and status not in ('cancelled','active')
      limit 1`,
    [world.createdCustomers],
  );
  if (existing.rows[0]) return existing.rows[0].id;
  const id = randomUUID();
  // The plan is resolved here rather than passed in: the sale only needs a valid
  // plan reference, and threading one through the section's world object would
  // add a field that is only ever read here.
  const planId = (
    await db.query<{ id: string }>(`select id from public.card_plans where code='BRONZE'`)
  ).rows[0]!.id;
  await db.query(
    `insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,
       cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
       commission_rate_snapshot,expected_commission_snapshot,status,submitted_at,balance_due_at)
     select $1, sale_number, $2, $3, 'staff', $4, '60000.00', '60000.00', '10000.00', 60000,
            '0', '0.00', 'submitted', now(), now()
     from public.next_sale_number()`,
    [id, world.createdCustomers[0]!, planId, world.actor],
  );
  return id;
}

/** Exact-decimal money arithmetic on cents, for the expected figures only. */
const cents = (value: string): bigint => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const money = (value: bigint): string =>
  `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
function moneySubtract(a: string, b: string): string {
  return money(cents(a) - cents(b));
}
function moneyAdd(a: string, b: string): string {
  return money(cents(a) + cents(b));
}