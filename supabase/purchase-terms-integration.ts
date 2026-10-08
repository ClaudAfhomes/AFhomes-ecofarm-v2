/**
 * Task C database proof: server-authoritative purchase terms, stale-hash refusal,
 * immutable append-only versions, explicit old-application review, seller
 * validation and all five payment-scheme parity - on REAL PostgreSQL.
 *
 * The scheme expectations are computed here from the plan row the server read,
 * with independent BigInt cent arithmetic. A text assertion over the migration
 * proves nothing about rounding, so parity is asserted against real output.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

type Check = (label: string, ok: boolean, detail?: string) => void;

type PlanRow = {
  id: string;
  code: string;
  cash_price: string;
  installment_price: string;
  reservation_fee: string;
  minimum_down_payment: string;
  spot_cash_days: number;
  standard_installment_months: number;
  validity_years: number;
  move_a_enabled: boolean;
  move_b1_enabled: boolean;
  move_b2_enabled: boolean;
  discount_percent: number;
  yearly_points: number;
  annual_points_tranches: number;
  cardholder_limit: number;
};

type Proposal = {
  applicationId: string;
  expectedProposalHash: string;
  asOf: string;
  offerKind: 'submission' | 'newly_confirmed_offer';
  terms: {
    tier: string;
    paymentScheme: string;
    totalPrice: string;
    reservationFee: string;
    minimumDownPayment: string;
    requiredInitial: string;
    installmentMonths: number | null;
    monthlyAmount: string | null;
    spotCashDays: number;
    validityMonths: number;
    discountPercent: number;
    yearlyPoints: number;
    annualPointsTranches: number;
    holderLimit: number;
    commissionRuleId: string | null;
    commissionRate: string;
    commissionBase: string;
    expectedCommission: string;
  };
};

const cents = (value: string): bigint => {
  const [whole = '0', fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const roundHalfUp = (value: bigint, rate: string): bigint => {
  const [whole = '0', fraction = ''] = rate.split('.');
  const scaled = BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
  return (value * scaled + 5000n) / 10000n;
};

/** Expected frozen economics for a plan + scheme, computed independently. */
export function expectedSchemeEconomics(plan: PlanRow, scheme: string) {
  const fee = cents(plan.reservation_fee);
  const total = cents(scheme === 'spot_cash' || scheme === 'move_a' ? plan.cash_price : plan.installment_price);
  const validityMonths = plan.validity_years * 12;
  if (scheme === 'spot_cash')
    return { total, initial: fee, months: null as number | null, monthly: null as bigint | null };
  const rate = scheme === 'move_b1_40_12' ? '0.40' : scheme === 'move_b2_25_12' ? '0.25' : null;
  const initial = rate ? roundHalfUp(total, rate) : fee;
  const months =
    scheme === 'move_b1_40_12' || scheme === 'move_b2_25_12'
      ? 12
      : scheme === 'move_a'
        ? 4
        : plan.standard_installment_months;
  const balance = total - initial;
  return { total, initial, months, monthly: balance / BigInt(months), validityMonths };
}

export async function runPurchaseTermsChecks({
  db,
  run,
  check,
  staff,
  createdCustomers,
  createdStaffIds,
}: {
  db: Client;
  run: string;
  check: Check;
  staff: Record<string, string>;
  createdCustomers: string[];
  createdStaffIds: string[];
}) {
  const actor = staff['sm']!;
  const superAdmin = staff['super-admin']!;
  const finance = staff['finance']!;
  const inactive = staff['inactive']!;

  const plans = new Map<string, PlanRow>(
    (
      await db.query<PlanRow>(
        `select id, code, cash_price, installment_price, reservation_fee, minimum_down_payment,
                spot_cash_days, standard_installment_months, validity_years, move_a_enabled,
                move_b1_enabled, move_b2_enabled, discount_percent, yearly_points,
                annual_points_tranches, cardholder_limit
           from public.card_plans where code in ('BRONZE','SILVER','GOLD')`,
      )
    ).rows.map((r) => [r.code, r]),
  );
  check('all three official plans available for parity', plans.size === 3);

  let customerSeq = 0;
  const mkCustomer = async () => {
    customerSeq += 1;
    const id = randomUUID();
    const cn = (
      await db.query<{ customer_number: string }>('select * from public.next_customer_number()')
    ).rows[0]!.customer_number;
    await db.query(
      `insert into public.customers (id, customer_number, first_name, last_name, birth_date, email, phone, status)
       values ($1,$2,'Terms','Test','1990-01-01',$3,'09175550001','prospect')`,
      [id, cn, `${run}-terms-${customerSeq}@example.invalid`],
    );
    createdCustomers.push(id);
    return id;
  };

  const holder = (n: number) => ({
    lastName: 'Terms',
    firstName: `Test${n}`,
    middleName: '',
    suffix: '',
    birthDate: '1990-04-05',
    sex: '',
    citizenship: '',
    civilStatus: '',
    permanentAddressLine1: '1 Terms Street',
    permanentAddressLine2: '',
    cityMunicipality: 'Calamba',
    province: 'Laguna',
    postalCode: '',
    landline: '',
    mobile: '09170000002',
    email: `${run}-terms-holder-${n}@example.invalid`,
    tinNumber: '',
    occupationBusinessName: '',
    officeBusinessAddress: '',
    businessIndustry: '',
    employedPosition: '',
    printedName: `Test${n} Terms`,
  });

  const mkApplication = async (planCode: string, scheme: string, status: 'draft' | 'approved') => {
    const customerId = await mkCustomer();
    const plan = plans.get(planCode)!;
    const header = {
      customerId,
      planId: plan.id,
      paymentScheme: scheme,
      acquisitionChannels: [],
      consentAcknowledged: true,
      acknowledgedAt: '2026-10-07',
      primarySignatureStatus: 'received',
      validIdReceived: true,
      reservationPaymentProofReceived: false,
    };
    const { rows } = await db.query<{ id: string }>(
      'select public.save_customer_application(null::uuid, $1::uuid, $2::jsonb, $3::jsonb, null::jsonb) as id',
      [actor, JSON.stringify(header), JSON.stringify(holder(customerSeq))],
    );
    const id = rows[0]!.id;
    if (status === 'approved') {
      await db.query('select public.submit_customer_application($1::uuid, $2::uuid)', [id, actor]);
      await db.query(
        `update public.customer_applications set status='approved', approved_at=now() where id=$1`,
        [id],
      );
    }
    return { id, customerId, plan };
  };

  const proposal = async (
    id: string,
    who = actor,
    sellerCandidate: string | null = null,
  ): Promise<Proposal> => {
    // A scalar `returns jsonb` function comes back from `pg` as one column named
    // after the function. PostgREST hands the handler the object itself; only the
    // raw driver needs the unwrap.
    const { rows } = await db.query<Record<string, Proposal>>(
      'select public.purchase_terms_proposal($1::uuid, $2::uuid, $3::uuid)',
      [id, who, sellerCandidate],
    );
    const value = (rows[0]!.purchase_terms_proposal ?? rows[0]!) as Proposal;
    if (!value?.terms) throw new Error('purchase_terms_proposal returned no terms');
    return value;
  };

  const fails = async (label: string, expected: RegExp, work: () => Promise<unknown>) => {
    try {
      await work();
      check(label, false, 'expected an error, but the call succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      check(label, expected.test(message), message.split('\n')[0]?.slice(0, 120));
    }
  };

  const createdApplications: string[] = [];
  const termsFor = (id: string) =>
    db.query<Record<string, string | number | null>>(
      'select * from public.customer_application_purchase_terms where application_id=$1 order by version',
      [id],
    ).then((r) => r.rows);

  /* ---------------------------------------------------------------- */
  /* Proposal: server-authoritative, canonical, all five schemes      */
  /* ---------------------------------------------------------------- */
  for (const [planCode, scheme] of [
    ['BRONZE', 'spot_cash'],
    ['BRONZE', 'move_a'],
    ['BRONZE', 'installment_4_month'],
    ['SILVER', 'move_b1_40_12'],
    ['SILVER', 'move_b2_25_12'],
    ['GOLD', 'move_b1_40_12'],
    ['GOLD', 'move_b2_25_12'],
  ] as const) {
    const { id, plan } = await mkApplication(planCode, scheme, 'draft');
    createdApplications.push(id);
    const offer = await proposal(id);
    const expected = expectedSchemeEconomics(plan, scheme);
    const label = `${planCode} ${scheme}`;
    check(
      `${label}: proposal hash is canonical sha256`,
      /^[0-9a-f]{64}$/.test(offer.expectedProposalHash),
    );
    check(`${label}: offer kind is a submission`, offer.offerKind === 'submission');
    check(
      `${label}: tier, scheme and frozen plan configuration`,
      offer.terms.tier === planCode &&
        offer.terms.paymentScheme === scheme &&
        offer.terms.discountPercent === plan.discount_percent &&
        offer.terms.yearlyPoints === plan.yearly_points &&
        offer.terms.annualPointsTranches === plan.annual_points_tranches &&
        offer.terms.holderLimit === plan.cardholder_limit,
      JSON.stringify(offer.terms),
    );
    check(
      `${label}: exact total, included reservation fee and required initial`,
      cents(offer.terms.totalPrice) === expected.total &&
        cents(offer.terms.reservationFee) === cents('10000.00') &&
        cents(offer.terms.requiredInitial) === expected.initial,
      `${offer.terms.totalPrice}/${offer.terms.reservationFee}/${offer.terms.requiredInitial}`,
    );
    check(
      `${label}: exact monthly amount, month count and spot-cash window`,
      (offer.terms.monthlyAmount === null) === (expected.monthly === null) &&
        (expected.monthly === null ||
          cents(offer.terms.monthlyAmount!) === expected.monthly &&
            offer.terms.installmentMonths === expected.months) &&
        offer.terms.spotCashDays === plan.spot_cash_days,
      `${offer.terms.monthlyAmount} x ${offer.terms.installmentMonths}`,
    );
    check(
      `${label}: schedule covers the remaining total exactly`,
      expected.monthly === null ||
        cents(offer.terms.monthlyAmount!) * BigInt(expected.months!) ===
          expected.total - expected.initial,
    );
    check(
      `${label}: zero commission is a legal frozen result`,
      cents(offer.terms.expectedCommission) === 0n &&
        cents(offer.terms.commissionBase) === cents(offer.terms.totalPrice),
      `${offer.terms.commissionRate}/${offer.terms.expectedCommission}`,
    );
  }

  /* Bronze B1/B2 are never enabled; the resolver refuses them. */
  for (const scheme of ['move_b1_40_12', 'move_b2_25_12']) {
    const { id } = await mkApplication('BRONZE', scheme, 'draft');
    createdApplications.push(id);
    await fails(`BRONZE ${scheme} refused by the resolver`, /SCHEME_NOT_ALLOWED_FOR_TIER/, () =>
      proposal(id),
    );
  }

  /* The hash covers live configuration: a price change invalidates it. */
  const { id: hashApp } = await mkApplication('BRONZE', 'spot_cash', 'draft');
  createdApplications.push(hashApp);
  const before = await proposal(hashApp);
  await db.query(
    `update public.card_plans set cash_price = cash_price::numeric + 1 where code='BRONZE'`,
  );
  const after = await proposal(hashApp);
  await db.query(
    `update public.card_plans set cash_price = cash_price::numeric - 1 where code='BRONZE'`,
  );
  const restored = await proposal(hashApp);
  check(
    'a plan price change changes the proposal hash',
    before.expectedProposalHash !== after.expectedProposalHash &&
      before.terms.totalPrice !== after.terms.totalPrice,
  );
  check(
    'the proposal hash is stable when nothing authoritative changes',
    restored.expectedProposalHash === before.expectedProposalHash,
  );

  /* ---------------------------------------------------------------- */
  /* Submission: frozen terms, stale hash, versions, replay           */
  /* ---------------------------------------------------------------- */
  const { id: submitApp } = await mkApplication('SILVER', 'move_b1_40_12', 'draft');
  createdApplications.push(submitApp);
  const submitOffer = await proposal(submitApp);
  const submitRequest = randomUUID();
  const submitId = (
    await db.query<{ id: string }>(
      `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid) as id`,
      [submitRequest, actor, submitApp, submitOffer.expectedProposalHash, null],
    )
  ).rows[0]!.id;
  check('submission returns the application id', submitId === submitApp);
  const v1 = await termsFor(submitApp);
  check('submission froze exactly one terms version', v1.length === 1 && v1[0]!.version === 1);
  check(
    'frozen version is a submission capture with no review reason',
    v1[0]!.capture_kind === 'submission' && v1[0]!.reason === null,
  );
  check(
    'the application points at the exact frozen terms row',
    (
      await db.query<{ purchase_terms_id: string | null; status: string }>(
        'select purchase_terms_id, status from public.customer_applications where id=$1',
        [submitApp],
      )
    ).rows[0]!.purchase_terms_id === v1[0]!.id,
  );
  check(
    'the submission wrote its audit in the same transaction',
    Number(
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.audit_events
            where entity_type='customer_application' and entity_id=$1 and action='CUSTOMER_APPLICATION_SUBMITTED'`,
          [submitApp],
        )
      ).rows[0]!.n,
    ) === 1,
  );

  const { id: staleApp } = await mkApplication('BRONZE', 'spot_cash', 'draft');
  createdApplications.push(staleApp);
  await fails(
    'a stale proposal hash is refused, not silently accepted',
    /PURCHASE_PROPOSAL_CHANGED/,
    () =>
      db.query(
        `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)`,
        [randomUUID(), actor, staleApp, 'b'.repeat(64), null],
      ),
  );
  check(
    'the refused stale submission froze nothing and left the draft alone',
    (await termsFor(staleApp)).length === 0 &&
      (
        await db.query<{ status: string }>(
          'select status from public.customer_applications where id=$1',
          [staleApp],
        )
      ).rows[0]!.status === 'draft',
  );

  const replay = (
    await db.query<{ id: string }>(
      `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid) as id`,
      [submitRequest, actor, submitApp, submitOffer.expectedProposalHash, null],
    )
  ).rows[0]!.id;
  check('the same request id replays the original result', replay === submitApp);
  check('the replay appended no second version', (await termsFor(submitApp)).length === 1);
  await fails(
    'the same request id with a changed payload conflicts',
    /MUTATION_PAYLOAD_CONFLICT/,
    () =>
      db.query(
        `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)`,
        [submitRequest, actor, submitApp, 'c'.repeat(64), null],
      ),
  );

  /* Reopen and resubmit append version 2; version 1 is byte-identical. */
  const v1Before = JSON.stringify(v1);
  await db.query(
    `select public.decide_purchase_application_once($1::uuid,$2::uuid,$3::uuid,'draft')`,
    [randomUUID(), actor, submitApp],
  );
  check(
    'reopen moves a submitted application back to draft',
    (
      await db.query<{ status: string }>(
        'select status from public.customer_applications where id=$1',
        [submitApp],
      )
    ).rows[0]!.status === 'draft',
  );
  const resubmitOffer = await proposal(submitApp);
  await db.query(
    `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)`,
    [randomUUID(), actor, submitApp, resubmitOffer.expectedProposalHash, null],
  );
  const both = await termsFor(submitApp);
  check('resubmission appends a second immutable version', both.length === 2 && both[1]!.version === 2);
  check('the first version is unchanged', JSON.stringify(both[0]) === JSON.stringify(JSON.parse(v1Before)[0]));
  check(
    'the application now points at the newest exact version',
    (
      await db.query<{ purchase_terms_id: string }>(
        'select purchase_terms_id from public.customer_applications where id=$1',
        [submitApp],
      )
    ).rows[0]!.purchase_terms_id === both[1]!.id,
  );

  /* Approval preserves the frozen terms; it never recalculates. */
  await db.query(
    `select public.decide_purchase_application_once($1::uuid,$2::uuid,$3::uuid,'approved')`,
    [randomUUID(), actor, submitApp],
  );
  check(
    'approval keeps the exact terms pointer',
    (
      await db.query<{ purchase_terms_id: string; status: string }>(
        'select purchase_terms_id, status from public.customer_applications where id=$1',
        [submitApp],
      )
    ).rows[0]!.purchase_terms_id === both[1]!.id,
  );
  check(
    'approval appended no third version',
    (await termsFor(submitApp)).length === 2,
  );

  /* ---------------------------------------------------------------- */
  /* Seller validation                                                */
  /* ---------------------------------------------------------------- */
  // Seller scope is asserted against relationships THIS section creates, so the
  // result cannot depend on whatever an earlier section did to the shared
  // synthetic hierarchy. The canonical ladder is VD -> SSM -> SM -> OST, so for
  // an SM actor the in-scope candidate is a DIRECT child and an OST under the
  // shared SSM is a sibling branch that is out of scope.
  const scopedSeller = randomUUID();
  const scopedPeer = randomUUID();
  const roleId = async (slug: string) =>
    (await db.query<{ id: string }>('select id from public.roles where slug=$1', [slug])).rows[0]!.id;
  // The ladder is enforced, so the in-scope candidate is an OST under the actor
  // (SM) and the out-of-scope peer is an SM under the actor's own upline.
  for (const [id, slug] of [
    [scopedSeller, 'ost'],
    [scopedPeer, 'sales_manager'],
  ] as const) {
    const email = `${id}@example.invalid`;
    await db.query('insert into auth.users (id,email) values ($1,$2)', [id, email]);
    await db.query(
      `insert into public.staff_users (id,email,full_name,status) values ($1,$2,'Scoped seller','active')`,
      [id, email],
    );
    await db.query('insert into public.staff_role_assignments (staff_id,role_id) values ($1,$2)', [
      id,
      await roleId(slug),
    ]);
    createdStaffIds.push(id);
  }
  for (const [subject, upline, level] of [
    [scopedSeller, actor, 'ost'],
    [scopedPeer, staff['ssm']!, 'sales_manager'],
  ] as const) {
    await db.query(
      `insert into public.referral_relationships
         (subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
       values ($1,$2,$3,true,true,$4)`,
      [subject, upline, level, superAdmin],
    );
  }
  await fails(
    'a selling role outside the actor downline is refused',
    /SELLER_NOT_IN_YOUR_DOWNLINE/,
    () => proposal(submitApp, actor, scopedPeer),
  );
  await fails(
    'a non-selling role is never a seller',
    /SELLER_ROLE_NOT_A_SELLER/,
    () => proposal(submitApp, superAdmin, finance),
  );
  await fails(
    'an inactive account cannot be the seller',
    /SELLER_INACTIVE|SELLER_ROLE_NOT_A_SELLER/,
    () => proposal(submitApp, superAdmin, inactive),
  );
  // A fresh draft captured BY A REVIEWER with an explicit seller candidate: the
  // frozen row must name the chosen seller, not the reviewer who submitted it.
  const { id: sellerApp } = await mkApplication('SILVER', 'spot_cash', 'draft');
  createdApplications.push(sellerApp);
  const chosen = await proposal(sellerApp, superAdmin, scopedSeller);
  const chosenHash = chosen.expectedProposalHash;
  await db.query(
    `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)`,
    [randomUUID(), superAdmin, sellerApp, chosenHash, scopedSeller],
  );
  const sellerTerms = await termsFor(sellerApp);
  check(
    'the chosen seller is frozen, never substituted by the submitting reviewer',
    sellerTerms.length === 1 &&
      sellerTerms[0]!.seller_staff_id === scopedSeller &&
      sellerTerms[0]!.captured_by === superAdmin,
    JSON.stringify(sellerTerms[0]?.seller_staff_id),
  );
  check(
    'a different seller produces a different offer hash',
    chosenHash !== (await proposal(sellerApp, superAdmin)).expectedProposalHash,
  );
  // A super admin is not scope-limited, but the target's own validity still is.
  await fails(
    'a non-selling role is refused even for an unscoped super admin',
    /SELLER_ROLE_NOT_A_SELLER/,
    () => proposal(sellerApp, superAdmin, finance),
  );

  /* ---------------------------------------------------------------- */
  /* Old approved applications: explicit review only                  */
  /* ---------------------------------------------------------------- */
  const { id: oldApp } = await mkApplication('BRONZE', 'spot_cash', 'approved');
  createdApplications.push(oldApp);
  const oldOffer = await proposal(oldApp);
  check(
    'an old approved application is presented as a newly confirmed offer',
    oldOffer.offerKind === 'newly_confirmed_offer',
  );
  await fails(
    'an old application cannot be approved again as submitted work',
    /INVALID_APPLICATION_TRANSITION/,
    () =>
      db.query(
        `select public.decide_purchase_application_once($1::uuid,$2::uuid,$3::uuid,'approved')`,
        [randomUUID(), actor, oldApp],
      ),
  );
  check(
    'an old approved application still has no terms pointer',
    (
      await db.query<{ purchase_terms_id: string | null }>(
        'select purchase_terms_id from public.customer_applications where id=$1',
        [oldApp],
      )
    ).rows[0]!.purchase_terms_id === null,
  );

  await fails(
    'a review without a reason is refused',
    /REVIEW_REASON_REQUIRED/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [randomUUID(), actor, oldApp, oldOffer.expectedProposalHash, null, null],
      ),
  );
  await fails(
    'a review with a too-short reason is refused',
    /REVIEW_REASON_REQUIRED/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [randomUUID(), actor, oldApp, oldOffer.expectedProposalHash, 'ok', null],
      ),
  );
  await fails(
    'a reviewer without the grant cannot review',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [
          randomUUID(),
          finance,
          oldApp,
          oldOffer.expectedProposalHash,
          'Historical evidence missing.',
          null,
        ],
      ),
  );
  await fails(
    'an inactive actor cannot review',
    /MUTATION_FORBIDDEN/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [
          randomUUID(),
          inactive,
          oldApp,
          oldOffer.expectedProposalHash,
          'Historical evidence missing.',
          null,
        ],
      ),
  );
  await fails(
    'a stale review hash is refused',
    /PURCHASE_PROPOSAL_CHANGED/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [
          randomUUID(),
          actor,
          oldApp,
          'd'.repeat(64),
          'Historical evidence missing.',
          null,
        ],
      ),
  );
  check(
    'no terms survived any refused review',
    (await termsFor(oldApp)).length === 0,
  );

  const reviewRequest = randomUUID();
  const reviewCall = db.query<{ id: string }>(
    `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid) as id`,
    [
      reviewRequest,
      actor,
      oldApp,
      oldOffer.expectedProposalHash,
      'Historical commercial evidence missing; new offer confirmed today.',
      null,
    ],
  );
  // Assert the captured row id up front so the replay below proves the request id
  // is what makes the capture idempotent.
  const capturedTermsId = (await reviewCall).rows[0]!.id;
  const reviewed = await termsFor(oldApp);
  check(
    'the captured record is the one the review call returned',
    reviewed.length === 1 && reviewed[0]!.id === capturedTermsId,
    `${reviewed.length}/${capturedTermsId}`,
  );
  check('the review captured exactly one terms record', reviewed.length === 1);
  check('the review captured version 1', reviewed[0]!.version === 1);
  check('the capture kind is an explicit review', reviewed[0]!.capture_kind === 'review');
  check(
    'the review reason, actor and time are recorded',
    reviewed[0]!.reason === 'Historical commercial evidence missing; new offer confirmed today.' &&
      reviewed[0]!.captured_by === actor &&
      new Date(String(reviewed[0]!.captured_at)).getTime() > 0,
  );
  check(
    'the application links to the exact reviewed terms record',
    (
      await db.query<{ purchase_terms_id: string }>(
        'select purchase_terms_id from public.customer_applications where id=$1',
        [oldApp],
      )
    ).rows[0]!.purchase_terms_id === reviewed[0]!.id,
  );
  check(
    'the review audit carries the reason and the terms version',
    (
      await db.query<{ n: number }>(
        `select count(*)::int as n from public.audit_events
          where entity_type='customer_application' and entity_id=$1
            and action='PURCHASE_TERMS_REVIEWED' and reason is not null`,
        [oldApp],
      )
    ).rows[0]!.n === 1,
  );
  const reviewReplay = (
    await db.query<{ id: string }>(
      `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid) as id`,
      [
        reviewRequest,
        actor,
        oldApp,
        oldOffer.expectedProposalHash,
        'Historical commercial evidence missing; new offer confirmed today.',
        null,
      ],
    )
  ).rows[0]!.id;
  check('a review replay returns the original terms row', reviewReplay === reviewed[0]!.id);
  check('a review replay appends no second version', (await termsFor(oldApp)).length === 1);
  await fails(
    'a second review with a different reason conflicts on the same request id',
    /MUTATION_PAYLOAD_CONFLICT/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [reviewRequest, actor, oldApp, oldOffer.expectedProposalHash, 'A different reason.', null],
      ),
  );

  /* A live reservation owns the commercial record: no review afterwards. */
  const { id: liveApp, customerId: liveCustomer } = await mkApplication(
    'BRONZE',
    'spot_cash',
    'approved',
  );
  createdApplications.push(liveApp);
  const saleId = randomUUID();
  await db.query(
    `insert into public.card_sales (id, sale_number, customer_id, plan_id, seller_type, seller_staff_id,
       cash_price, cash_price_snapshot, minimum_down_payment_snapshot, yearly_points_snapshot,
       commission_rate_snapshot, expected_commission_snapshot, status, submitted_at, balance_due_at)
     select $1, sale_number, $2, $3, 'staff', $4, $5, $5, $6, $7, '0', '0.00', 'submitted', now(), now()
     from public.next_sale_number()`,
    [
      saleId,
      liveCustomer,
      plans.get('BRONZE')!.id,
      actor,
      plans.get('BRONZE')!.cash_price,
      plans.get('BRONZE')!.minimum_down_payment,
      plans.get('BRONZE')!.yearly_points,
    ],
  );
  await db.query(
    `select public.save_reservation_agreement(null::uuid,$1::uuid,$2::jsonb,$3::jsonb,null::jsonb,'[]'::jsonb)`,
    [
      actor,
      {
        saleId,
        customerApplicationId: liveApp,
        reservationDate: '2026-10-07',
        agreementDate: '2026-10-07',
        primarySignatureStatus: 'received',
      },
      {
        name: 'Terms Test',
        address: '1 Terms Street',
        contactNumber: '09170000002',
        email: `${run}-live@example.invalid`,
      },
    ],
  );
  const liveOffer = await proposal(liveApp);
  await fails(
    'a live reservation blocks a review',
    /RESERVATION_ALREADY_EXISTS/,
    () =>
      db.query(
        `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
        [randomUUID(), actor, liveApp, liveOffer.expectedProposalHash, 'Trying late.', null],
      ),
  );
  await db.query(
    `delete from public.reservation_agreement_holders where agreement_id in
       (select id from public.reservation_agreements where sale_id=$1)`,
    [saleId],
  );
  await db.query('delete from public.reservation_agreements where sale_id=$1', [saleId]);
  // The suite's own sale-history guard: the hierarchy snapshot is RESTRICTed by
  // the sale, so it goes first under the maintenance flag.
  await db.query('begin');
  await db.query(`set local afhomes.allow_snapshot_maintenance = 'on'`);
  await db.query('delete from public.card_sale_hierarchy_snapshots where sale_id=$1', [saleId]);
  await db.query('delete from public.card_sales where id=$1', [saleId]);
  await db.query('commit');

  /* ---------------------------------------------------------------- */
  /* Immutability and atomicity                                        */
  /* ---------------------------------------------------------------- */
  await fails(
    'frozen terms cannot be updated',
    /PURCHASE_TERMS_IMMUTABLE/,
    () =>
      db.query(`update public.customer_application_purchase_terms set total_price='1.00' where id=$1`, [
        reviewed[0]!.id,
      ]),
  );
  await fails(
    'frozen terms cannot be deleted',
    /PURCHASE_TERMS_IMMUTABLE/,
    () =>
      db.query('delete from public.customer_application_purchase_terms where id=$1', [
        reviewed[0]!.id,
      ]),
  );

  // Atomicity: the mutation, the pointer, the audit and the idempotency row are
  // one transaction. Rolling the wrapper back must leave nothing at all.
  const { id: rollbackApp } = await mkApplication('BRONZE', 'spot_cash', 'draft');
  createdApplications.push(rollbackApp);
  const rollbackOffer = await proposal(rollbackApp);
  const rollbackRequest = randomUUID();
  await db.query('begin');
  await db.query(
    `select public.submit_purchase_application_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::uuid)`,
    [rollbackRequest, actor, rollbackApp, rollbackOffer.expectedProposalHash, null],
  );
  await db.query('rollback');
  check('a rolled-back submission froze no terms', (await termsFor(rollbackApp)).length === 0);
  check(
    'a rolled-back submission left the application in draft',
    (
      await db.query<{ status: string; purchase_terms_id: string | null }>(
        'select status, purchase_terms_id from public.customer_applications where id=$1',
        [rollbackApp],
      )
    ).rows[0]!.status === 'draft',
  );
  check(
    'a rolled-back submission wrote no audit and no idempotency row',
    Number(
      (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.audit_events
            where entity_type='customer_application' and entity_id=$1`,
          [rollbackApp],
        )
      ).rows[0]!.n,
    ) === 0 &&
      Number(
        (
          await db.query<{ n: number }>(
            'select count(*)::int as n from private.mutation_requests where request_id=$1',
            [rollbackRequest],
          )
        ).rows[0]!.n,
      ) === 0,
  );

  /* Browser roles reach neither the helper nor the frozen rows. */
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const probe = await db
      .query<{ a: boolean }>(
        `select has_function_privilege($1,'private.purchase_terms_for_application(uuid,uuid,text)','EXECUTE')
            or has_function_privilege($1,'private.purchase_seller_for(uuid,uuid)','EXECUTE') as a`,
        [role],
      )
      .then((r) => r.rows[0]!.a);
    check(`${role} cannot call the purchase-terms helpers`, probe === false);
  }
  const exposed = await db
    .query<{ n: number }>(
      `select count(*)::int as n from information_schema.role_table_grants
        where table_schema='public' and table_name='customer_application_purchase_terms'
          and grantee in ('anon','authenticated') and privilege_type<>'SELECT'`,
    )
    .then((r) => r.rows[0]!.n);
  check('browser roles hold no write privilege on frozen terms', exposed === 0);

  /* ---------------------------------------------------------------- */
  /* Cleanup: restore every fixture this section created               */
  /* ---------------------------------------------------------------- */
  await db.query('begin');
  try {
    await db.query(`set local afhomes.allow_purchase_test_cleanup='on'`);
    await db.query(
      `delete from private.purchase_document_evidence where actor_id = any($1::uuid[])`,
      [[actor, superAdmin]],
    );
    // The application pointer references the terms row with ON DELETE RESTRICT, so
    // the pointer is cleared first. Reverse order aborts the whole cleanup.
    await db.query(
      `update public.customer_applications set purchase_terms_id=null where id = any($1::uuid[])`,
      [createdApplications],
    );
    await db.query(
      `delete from public.customer_application_purchase_terms where application_id = any($1::uuid[])`,
      [createdApplications],
    );
    await db.query(
      `delete from private.mutation_requests where actor_id = any($1::uuid[])`,
      [[actor, superAdmin, finance, inactive]],
    );
    await db.query(`delete from public.audit_events where actor_id = any($1::uuid[])`, [
      [actor, superAdmin, finance, inactive],
    ]);
    await db.query(
      `delete from public.customer_application_holders where application_id = any($1::uuid[])`,
      [createdApplications],
    );
    await db.query('delete from public.customer_applications where id = any($1::uuid[])', [
      createdApplications,
    ]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}
