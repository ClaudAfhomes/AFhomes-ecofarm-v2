/**
 * Task D database proof: an approved application with exact frozen terms creates
 * an AF-RES with NO card sale, freezes the commercial source immutably, refuses
 * every ineligible state, and keeps the legacy sale-origin path intact.
 *
 * Task E/F live in `reservation-finance-integration.ts`.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import type { PaymentScheme } from '../packages/contracts/src/schemas/lifecycle.js';

type Check = (label: string, ok: boolean, detail?: string) => void;

type PlanRow = { id: string; code: string; cash_price: string };

/**
 * Synthetic purchase fixtures shared by the Task D/E/F sections.
 *
 * One builder, so the two sections cannot disagree about what an approved
 * application with frozen terms and an executed reservation look like.
 */
export async function makePurchaseFixtures(
  db: Client,
  options: {
    actor: string;
    tier?: 'BRONZE' | 'SILVER' | 'GOLD';
    scheme?: PaymentScheme;
    createdCustomers: string[];
    createdApplications: string[];
  },
) {
  const { actor, createdCustomers, createdApplications } = options;
  const plan = (
    await db.query<PlanRow>(
      'select id, code, cash_price from public.card_plans where code=$1',
      [options.tier ?? 'BRONZE'],
    )
  ).rows[0]!;

  let seq = 0;
  const mkCustomer = async () => {
    seq += 1;
    const id = randomUUID();
    const cn = (
      await db.query<{ customer_number: string }>('select * from public.next_customer_number()')
    ).rows[0]!.customer_number;
    // The email carries the UUID, not a counter: this builder is instantiated
    // once per section and each one restarts its sequence, so a shared counter
    // would collide on the customers_email_unique constraint.
    await db.query(
      `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
       values ($1,$2,'Reserve','Test','1990-01-01',$3,'09175550001','prospect')`,
      [id, cn, `${id}@example.invalid`],
    );
    createdCustomers.push(id);
    return id;
  };

  /** A draft application with frozen terms, optionally moved to `status`. */
  const mkApproved = async (status: 'draft' | 'submitted' | 'approved' = 'approved') => {
    const customerId = await mkCustomer();
    const { rows } = await db.query<{ id: string }>(
      'select public.save_customer_application(null::uuid,$1::uuid,$2::jsonb,$3::jsonb,null::jsonb) as id',
      [
        actor,
        JSON.stringify({
          customerId,
          planId: plan.id,
          paymentScheme: options.scheme ?? 'spot_cash',
          acquisitionChannels: [],
          consentAcknowledged: true,
          acknowledgedAt: '2026-10-07',
          primarySignatureStatus: 'received',
          validIdReceived: true,
          reservationPaymentProofReceived: false,
        }),
        JSON.stringify({
          lastName: 'Reserve',
          firstName: `Test${seq}`,
          birthDate: '1990-04-05',
          permanentAddressLine1: '1 Reserve Street',
          cityMunicipality: 'Calamba',
          province: 'Laguna',
          mobile: '09170000003',
          email: `${customerId}-holder@example.invalid`,
          printedName: `Test${seq} Reserve`,
        }),
      ],
    );
    const id = rows[0]!.id;
    createdApplications.push(id);
    // `submitted` is reached through the LEGACY submit (no frozen terms), which is
    // exactly the shape of an old application. The approved path goes through the
    // purchase submit, which freezes terms and performs the transition itself -
    // calling the legacy submit first would already have left the draft.
    if (status === 'submitted') {
      await db.query('select public.submit_customer_application($1::uuid,$2::uuid)', [id, actor]);
    }
    if (status === 'approved') {
      const offer = await fetchProposalHash(db, id, actor);
      await db.query(
        `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)`,
        [randomUUID(), actor, id, offer, null],
      );
      await db.query(
        `select public.decide_purchase_application_once($1::uuid,$2::uuid,$3::uuid,'approved')`,
        [randomUUID(), actor, id],
      );
    }
    const terms = (
      await db.query<{ id: string; version: number }>(
        'select id, version from public.customer_application_purchase_terms where application_id=$1 order by version desc limit 1',
        [id],
      )
    ).rows;
    return { id, customerId, termsId: terms[0]?.id ?? null, termsVersion: terms[0]?.version ?? 0 };
  };

  const reserveInput = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({
      reservationDate: '2026-10-07',
      agreementDate: '2026-10-07',
      primarySignatureStatus: 'received',
      primaryAddress: '1 Reserve Street',
      ...extra,
    });

  const reserve = async (app: string, terms: string | null, requestId = randomUUID()) => {
    const { rows } = await db.query<{ id: string }>(
      'select public.reserve_application_purchase_once($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) as id',
      [requestId, actor, app, terms, reserveInput()],
    );
    return rows[0]!.id;
  };

  const transition = async (
    action: string,
    who: string,
    target: string,
    extra: Record<string, unknown> = {},
  ) =>
    db.query(
      'select public.transition_purchase_reservation_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb)',
      [randomUUID(), who, target, action, JSON.stringify(extra)],
    );

  const termsOf = async (reservationId: string) =>
    (
      await db.query<{ total: string; fee: string }>(
        'select total_price_snapshot as total, reservation_fee_snapshot as fee from public.reservation_agreements where id=$1',
        [reservationId],
      )
    ).rows[0]!;

  /** Approved application -> exact terms -> a DRAFT reservation, no sale. */
  const reserved = async () => {
    const app = await mkApproved('approved');
    const id = await reserve(app.id, app.termsId);
    const { total, fee } = await termsOf(id);
    return {
      applicationId: app.id,
      customerId: app.customerId,
      termsId: app.termsId!,
      reservationId: id,
      total,
      fee,
    };
  };

  /** Approved application -> exact terms -> EXECUTED reservation, no sale. */
  const executed = async () => {
    const app = await mkApproved('approved');
    const id = await reserve(app.id, app.termsId);
    await transition('submit', actor, id);
    await transition('execute', actor, id);
    const { total, fee } = await termsOf(id);
    return {
      applicationId: app.id,
      customerId: app.customerId,
      termsId: app.termsId!,
      reservationId: id,
      total,
      fee,
    };
  };

  return { plan, mkCustomer, mkApproved, reserve, reserveInput, transition, reserved, executed };
}

/**
 * The proposal hash for an application.
 *
 * A scalar `returns jsonb` RPC comes back from the raw driver under the
 * function-name column, so it is unwrapped here once rather than at each call
 * site. PostgREST hands the API handler the object itself.
 */
async function fetchProposalHash(db: Client, applicationId: string, actor: string) {
  const { rows } = await db.query<Record<string, { expectedProposalHash: string }>>(
    'select public.purchase_terms_proposal($1::uuid,$2::uuid,$3::uuid)',
    [applicationId, actor, null],
  );
  const value = rows[0]!.purchase_terms_proposal ?? (rows[0] as never);
  return value.expectedProposalHash;
}

export async function runReservationPurchaseChecks({
  db,
  run,
  check,
  staff,
  createdCustomers,
  createdApplications,
}: {
  db: Client;
  run: string;
  check: Check;
  staff: Record<string, string>;
  createdCustomers: string[];
  createdApplications: string[];
}) {
  const actor = staff['sm']!;
  const superAdmin = staff['super-admin']!;
  const finance = staff['finance']!;
  const { plan, mkCustomer, mkApproved, reserve, reserveInput, transition } =
    await makePurchaseFixtures(db, { actor, createdCustomers, createdApplications });

  const fails = async (label: string, expected: RegExp, work: () => Promise<unknown>) => {
    try {
      await work();
      check(label, false, 'expected an error, but the call succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      check(label, expected.test(message), message.split('\n')[0]?.slice(0, 120));
    }
  };

  /* ---------------------------------------------------------------- */
  /* The headline case: approved application, no card sale            */
  /* ---------------------------------------------------------------- */
  const approved = await mkApproved('approved');
  const reservationsBefore = (
    await db.query<{ n: number }>('select count(*)::int as n from public.reservation_agreements')
  ).rows[0]!.n;
  const request = randomUUID();
  const reservationId = await reserve(approved.id, approved.termsId, request);

  const row = (
    await db.query<Record<string, string | number | null>>(
      'select * from public.reservation_agreements where id=$1',
      [reservationId],
    )
  ).rows[0]!;
  check('an approved application creates an AF-RES', Boolean(reservationId));
  check(
    'the reservation allocates an AF-RES business number',
    /^AF-RES-[A-HJ-NP-Z2-9]{5}$/.test(String(row.reservation_number)),
    String(row.reservation_number),
  );
  check('no card sale is created and none is required', row.sale_id === null);
  check(
    'no card sale row exists for the customer at all',
    (
      await db.query<{ n: number }>(
        'select count(*)::int as n from public.card_sales where customer_id=$1',
        [approved.customerId],
      )
    ).rows[0]!.n === 0,
  );
  check('the reservation is application-origin', row.origin === 'application');
  check(
    'the EXACT frozen terms UUID and version are stored, never a lookup',
    row.purchase_terms_id === approved.termsId && row.customer_application_id === approved.id,
  );
  const termsRow = (
    await db.query<Record<string, string | number | null>>(
      'select * from public.customer_application_purchase_terms where id=$1',
      [approved.termsId],
    )
  ).rows[0]!;
  check(
    'every commercial field is copied from the immutable terms row',
    row.customer_id === approved.customerId &&
      row.seller_staff_id === termsRow.seller_staff_id &&
      row.tier_snapshot === termsRow.tier &&
      row.payment_scheme_snapshot === termsRow.payment_scheme &&
      row.total_price_snapshot === termsRow.total_price &&
      row.reservation_fee_snapshot === termsRow.reservation_fee &&
      row.required_initial_snapshot === termsRow.required_initial &&
      row.minimum_down_payment_snapshot === termsRow.minimum_down_payment &&
      row.spot_cash_days_snapshot === termsRow.spot_cash_days &&
      row.validity_months_snapshot === termsRow.validity_months &&
      row.commission_rate_snapshot === termsRow.commission_rate &&
      row.commission_base_snapshot === termsRow.commission_base &&
      row.expected_commission_snapshot === termsRow.expected_commission &&
      row.yearly_points_snapshot === termsRow.yearly_points &&
      row.holder_limit_snapshot === termsRow.holder_limit,
    JSON.stringify(row),
  );
  check(
    'the PHP 10,000 reservation amount is INCLUDED in the frozen total, not added',
    row.reservation_fee_snapshot === '10000.00' &&
      row.total_price_snapshot === termsRow.total_price &&
      row.balance_snapshot === termsRow.total_price &&
      row.total_payment_received_snapshot === '0.00',
  );
  check('the reservation starts as a draft', row.status === 'draft');
  check(
    'the frozen economics survive a live plan price change',
    await (async () => {
      const before = JSON.stringify(row);
      await db.query(`update public.card_plans set cash_price='99999.00' where code='BRONZE'`);
      const after = (
        await db.query<Record<string, string | number | null>>(
          'select * from public.reservation_agreements where id=$1',
          [reservationId],
        )
      ).rows[0]!;
      await db.query(`update public.card_plans set cash_price=$1 where code='BRONZE'`, [
        plan.cash_price,
      ]);
      return JSON.stringify(after) === before;
    })(),
  );
  check(
    'the application sale link is still empty: the sale arrives at finalization',
    (
      await db.query<{ sale_id: string | null }>(
        'select sale_id from public.customer_applications where id=$1',
        [approved.id],
      )
    ).rows[0]!.sale_id === null,
  );
  check(
    'creation wrote reservation revision 1 evidence',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from private.purchase_document_evidence
          where kind='reservation' and source_id=$1 and revision=1`,
        [reservationId],
      )
    ).rows[0]!.n === 1,
  );

  /* Duplicate and idempotency */
  check(
    'exactly one reservation exists for the application',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.reservation_agreements where customer_application_id=$1`,
        [approved.id],
      )
    ).rows[0]!.n === 1,
  );
  const replay = await reserve(approved.id, approved.termsId, request);
  check('the same request id replays the original AF-RES', replay === reservationId);
  check(
    'a replay created no second row',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.reservation_agreements where customer_application_id=$1`,
        [approved.id],
      )
    ).rows[0]!.n === 1,
  );
  await fails(
    'a different request against the same application conflicts',
    /RESERVATION_ALREADY_EXISTS/,
    () => reserve(approved.id, approved.termsId),
  );
  check(
    'the reservation count only grew by the one intended row',
    (
      await db.query<{ n: number }>('select count(*)::int as n from public.reservation_agreements')
    ).rows[0]!.n ===
      reservationsBefore + 1,
  );

  /* Eligibility */
  for (const status of ['draft', 'submitted'] as const) {
    const ineligible = await mkApproved(status);
    await fails(
      `an application in ${status} cannot create a reservation`,
      /APPLICATION_NOT_APPROVED/,
      () => reserve(ineligible.id, ineligible.termsId),
    );
  }
  // An OLD approved application: submitted through the legacy path and then
  // approved while the system already required terms. It has no terms pointer at
  // all, which is exactly the state the explicit review flow exists for.
  const noTerms = await mkApproved('submitted');
  await db.query(
    `update public.customer_applications set status='approved', approved_at=now() where id=$1`,
    [noTerms.id],
  );
  check(
    'the old approved application really has no frozen terms',
    noTerms.termsId === null,
    String(noTerms.termsId),
  );
  await fails(
    'an application without frozen terms cannot create a reservation',
    /PURCHASE_TERMS_REVIEW_REQUIRED/,
    () => reserve(noTerms.id, null),
  );
  const otherTerms = await mkApproved('approved');
  await fails(
    'a reservation cannot reach for a different terms version',
    /PURCHASE_TERMS_VERSION_CONFLICT/,
    () => reserve(otherTerms.id, approved.termsId),
  );
  await fails(
    'an unauthorized actor cannot create a reservation',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query(
        'select public.reserve_application_purchase_once($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)',
        [randomUUID(), finance, approved.id, approved.termsId, reserveInput()],
      ),
  );
  await fails(
    'an inactive actor cannot create a reservation',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query(
        'select public.reserve_application_purchase_once($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)',
        [randomUUID(), staff['inactive']!, approved.id, approved.termsId, reserveInput()],
      ),
  );
  check(
    'no refused attempt created a reservation',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.reservation_agreements
          where customer_application_id = any($1::uuid[])`,
        [[approved.id, noTerms.id, otherTerms.id, ...createdApplications]],
      )
    ).rows[0]!.n === 1,
  );

  /* Source immutability */
  await fails(
    'the reservation economics cannot be rewritten',
    /RESERVATION_TERMS_CONFLICT/,
    () =>
      db.query(`update public.reservation_agreements set total_price_snapshot='1.00' where id=$1`, [
        reservationId,
      ]),
  );
  // The identity trigger refuses a nulled pointer too (a null terms id cannot
  // satisfy the purchase-identity constraint), and refuses a swapped one.
  await fails(
    'the reservation terms pointer cannot be nulled out',
    /PURCHASE_TERMS_REVIEW_REQUIRED|reservation_purchase_identity_fk|RESERVATION_TERMS/,
    () =>
      db.query(`update public.reservation_agreements set purchase_terms_id=null where id=$1`, [
        reservationId,
      ]),
  );
  await fails(
    'the reservation terms pointer cannot be swapped',
    /RESERVATION_TERMS_CONFLICT/,
    () =>
      db.query(`update public.reservation_agreements set purchase_terms_id=$1 where id=$2`, [
        otherTerms.termsId,
        reservationId,
      ]),
  );
  await fails(
    'the reservation origin cannot be flipped to sale',
    /RESERVATION_SOURCE_IMMUTABLE/,
    () =>
      db.query(`update public.reservation_agreements set origin='sale' where id=$1`, [reservationId]),
  );
  await fails(
    'the frozen terms row still cannot be edited after the reservation exists',
    /PURCHASE_TERMS_IMMUTABLE/,
    () =>
      db.query(`update public.customer_application_purchase_terms set total_price='1.00' where id=$1`, [
        approved.termsId,
      ]),
  );

  /* Lifecycle */
  const move = (action: string, extra: Record<string, unknown> = {}, who = actor) =>
    transition(action, who, reservationId, extra);
  const statusNow = async () =>
    (
      await db.query<{ status: string }>(
        'select status from public.reservation_agreements where id=$1',
        [reservationId],
      )
    ).rows[0]!.status;

  await fails('execute is refused from draft', /INVALID_AGREEMENT_TRANSITION/, () =>
    move('execute'),
  );
  await move('submit');
  check('draft -> submitted', (await statusNow()) === 'submitted');
  // The signature guard is proven inside a rolled-back transaction: a submitted
  // agreement whose primary signature is pending must not execute, and the
  // rollback restores the received signature for the real execution below.
  check(
    'execution is refused without the primary signature',
    await (async () => {
      await db.query('begin');
      await db.query(
        `update public.reservation_agreements set primary_signature_status='pending' where id=$1`,
        [reservationId],
      );
      let refused = false;
      try {
        await move('execute');
      } catch (error) {
        refused = /PRIMARY_SIGNATURE_REQUIRED/.test(
          error instanceof Error ? error.message : String(error),
        );
      }
      await db.query('rollback');
      return refused;
    })(),
  );
  await fails('a non-draft save is refused', /AGREEMENT_NOT_EDITABLE/, () =>
    move('save', { revisionNumber: 'R9' }),
  );
  await move('execute');
  check('submitted -> executed', (await statusNow()) === 'executed');
  for (const action of ['reopen', 'cancel', 'execute', 'submit']) {
    await fails(
      `executed is terminal: ${action} is refused`,
      /INVALID_AGREEMENT_TRANSITION/,
      () => move(action),
    );
  }
  check(
    'executed stays executed through every refused transition',
    (await statusNow()) === 'executed',
  );
  check(
    'each recorded revision is immutable evidence',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from private.purchase_document_evidence
          where kind='reservation' and source_id=$1`,
        [reservationId],
      )
    ).rows[0]!.n >= 3,
  );

  await fails('an executed reservation cannot be cancelled', /INVALID_AGREEMENT_TRANSITION/, () =>
    move('cancel'),
  );

  /* A cancelled (never executed) agreement frees the application for a new one. */
  const cancelApp = await mkApproved('approved');
  const cancelReservation = await reserve(cancelApp.id, cancelApp.termsId);
  await transition('submit', actor, cancelReservation);
  await fails('a submitted agreement cannot be saved', /AGREEMENT_NOT_EDITABLE/, () =>
    transition('save', actor, cancelReservation, { revisionNumber: 'R1' }),
  );
  await transition('cancel', actor, cancelReservation);
  check(
    'a cancelled agreement is recorded as cancelled, never executed',
    (
      await db.query<{ status: string }>(
        'select status from public.reservation_agreements where id=$1',
        [cancelReservation],
      )
    ).rows[0]!.status === 'cancelled',
  );
  const replacement = await reserve(cancelApp.id, cancelApp.termsId);
  check(
    'a cancelled agreement frees the application for exactly one replacement',
    Boolean(replacement) && replacement !== cancelReservation,
  );
  check(
    'the replacement is the only live agreement for that application',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.reservation_agreements
          where customer_application_id=$1 and status<>'cancelled'`,
        [cancelApp.id],
      )
    ).rows[0]!.n === 1,
  );

  /* Legacy sale-origin reservations are untouched by this path. */
  const legacyCustomer = await mkCustomer();
  const legacySale = randomUUID();
  await db.query(
    `insert into public.card_sales (id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,
       cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
       commission_rate_snapshot,expected_commission_snapshot,status,submitted_at,balance_due_at)
     select $1, sale_number, $2, $3, 'staff', $4, $5, $5, '10000.00', 10000,
            '0', '0.00', 'submitted', now(), now()
     from public.next_sale_number()`,
    [legacySale, legacyCustomer, plan.id, actor, plan.cash_price],
  );
  const legacyReservation = (
    await db.query<{ id: string }>(
      'select public.save_reservation_agreement(null::uuid,$1::uuid,$2::jsonb,$3::jsonb,null::jsonb,$4::jsonb) as id',
      [
        actor,
        {
          saleId: legacySale,
          reservationDate: '2026-10-07',
          agreementDate: '2026-10-07',
          primarySignatureStatus: 'received',
        },
        {
          name: 'Legacy Reserve',
          address: '1 Legacy Street',
          contactNumber: '09170000004',
          email: `${run}-legacy-res@example.invalid`,
        },
        '[]',
      ],
    )
  ).rows[0]!.id;
  check(
    'a legacy sale-origin reservation still exists with its sale',
    (
      await db.query<{ origin: string; sale_id: string; purchase_terms_id: string | null }>(
        'select origin, sale_id, purchase_terms_id from public.reservation_agreements where id=$1',
        [legacyReservation],
      )
    ).rows[0]!.origin === 'sale',
  );
  await fails(
    'the purchase lifecycle refuses a sale-origin reservation',
    /RESERVATION_ORIGIN_INVALID/,
    () => transition('submit', actor, legacyReservation),
  );
  check(
    'the legacy reservation kept its legacy submit path',
    await db
      .query('select public.submit_reservation_agreement($1::uuid,$2::uuid)', [legacyReservation, actor])
      .then(() => true),
  );

  /* A super admin may reserve on behalf of another seller; the creator is recorded. */
  const reviewerApp = await mkApproved('approved');
  const reviewerReservation = (
    await db.query<{ id: string }>(
      'select public.reserve_application_purchase_once($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb) as id',
      [randomUUID(), superAdmin, reviewerApp.id, reviewerApp.termsId, reserveInput()],
    )
  ).rows[0]!.id;
  check(
    'a reviewer with the update grant reserves for an application they do not own',
    (
      await db.query<{ created_by: string }>(
        'select created_by from public.reservation_agreements where id=$1',
        [reviewerReservation],
      )
    ).rows[0]!.created_by === superAdmin,
  );
  check(
    'the reviewer did not become the seller: the frozen terms seller stands',
    (
      await db.query<{ seller_staff_id: string }>(
        'select seller_staff_id from public.reservation_agreements where id=$1',
        [reviewerReservation],
      )
    ).rows[0]!.seller_staff_id === termsRow.seller_staff_id,
  );
}