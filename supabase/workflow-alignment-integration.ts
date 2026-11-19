/** Owner-confirmed workflow proof on real PostgreSQL. Synthetic, rollback-only. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { Client as PgClient } from 'pg';
import { acceptedSignedDocument, paymentReceipt } from './purchase-evidence-fixtures.js';

export async function runWorkflowAlignmentChecks(db: Client): Promise<number> {
  let checks = 0;
  const equal = (actual: unknown, expected: unknown, message: string) => {
    assert.deepEqual(actual, expected, message);
    checks += 1;
  };
  const row = async <T = Record<string, unknown>>(sql: string, args: unknown[] = []) =>
    (await db.query(sql, args)).rows[0] as T;
  const denied = async (message: RegExp, action: () => Promise<unknown>) => {
    await db.query('savepoint workflow_denied');
    try {
      await assert.rejects(action, message);
      checks += 1;
    } finally {
      await db.query('rollback to savepoint workflow_denied');
    }
  };
  await db.query('savepoint workflow_alignment');
  try {
    const people: Record<string, string> = {};
    for (const role of [
      'super_admin',
      'admin',
      'sales_manager',
      'senior_sales_manager',
      'vice_director',
      'ost',
      'finance',
    ]) {
      const id = randomUUID();
      const email = `${id}@example.invalid`;
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
      await db.query(
        "insert into public.staff_users(id,email,full_name,status) values($1,$2,'WORKFLOW TEST','active')",
        [id, email],
      );
      await db.query(
        'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
        [id, role],
      );
      people[role] = id;
    }
    const sm = people.sales_manager!;
    const admin = people.admin!;
    const finance = people.finance!;
    for (const [subject, upline, level] of [
      [people.senior_sales_manager!, people.vice_director!, 'senior_sales_manager'],
      [sm, people.senior_sales_manager!, 'sales_manager'],
    ]) {
      await db.query(
        `insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by)
        values($1,$2,$3,true,true,$4)`,
        [subject, upline, level, people.super_admin],
      );
    }
    const plan = await row<{ id: string }>("select id from public.card_plans where code='BRONZE'");
    const customer = await row<{ id: string }>(
      `insert into public.customers(customer_number,first_name,last_name,birth_date,email,phone,status,created_by)
       select customer_number,'ANNA','RIVERA','1990-01-01',$1,'+639170000001','prospect',$2
       from public.next_customer_number() returning id`,
      [randomUUID() + '@example.invalid', sm],
    );
    const holder = {
      firstName: 'ANNA',
      lastName: 'RIVERA',
      birthDate: '1990-01-01',
      permanentAddressLine1: '1 Garden Street',
      cityMunicipality: 'Calamba',
      province: 'Laguna',
      mobile: '+639170000001',
      email: randomUUID() + '@example.invalid',
      printedName: 'ANNA RIVERA',
    };
    const header = {
      customerId: customer.id,
      planId: plan.id,
      paymentScheme: 'spot_cash',
      acquisitionChannels: [],
      consentAcknowledged: true,
      acknowledgedAt: '2026-11-16',
      primarySignatureStatus: 'received',
      validIdReceived: true,
    };
    const create = async (
      actor = sm,
      overrides: Record<string, unknown> = {},
      request = randomUUID(),
    ) =>
      row<{ id: string }>('select public.create_customer_application_once($1,$2,$3,$4,null) id', [
        request,
        actor,
        { ...header, ...overrides },
        holder,
      ]);

    const request = randomUUID();
    const app = await create(sm, {}, request);
    const initial = await row<{
      id: string;
      status: string;
      reservation_number: string;
      purchase_terms_id: null;
      total_price_snapshot: string;
    }>('select * from public.reservation_agreements where customer_application_id=$1', [app.id]);
    const totalCents = BigInt(initial.total_price_snapshot.replace('.', ''));
    const money = (cents: bigint) =>
      `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
    const eligibleCents = (totalCents * 40n) / 100n;
    equal(initial.status, 'draft', 'the application is created with an immediate draft RA');
    equal(initial.purchase_terms_id, null, 'creation does not freeze terms before submission');
    const importJob = randomUUID(),
      importRow = randomUUID(),
      importSource = randomUUID();
    await db.query(
      "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'csv','workflow-stage-test.csv','ready',1,1,$2,now())",
      [importJob, admin],
    );
    await db.query(
      "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action,customer_id) values($1,$2,2,jsonb_build_object('email',(select email from public.customers where id=$3)),'{}','valid','CREATE',$3)",
      [importRow, importJob, customer.id],
    );
    await db.query(
      'insert into private.customer_import_purchase_sources(id,purchase_reference,normalized_reference,customer_id,application_id,original_row_id,intent_hash,created_by) values($1,$2,$2,$3,$4,$5,$6,$7)',
      [importSource, randomUUID(), customer.id, app.id, importRow, 'a'.repeat(64), admin],
    );
    await db.query(
      'insert into private.customer_import_source_rows(row_id,source_id,source_hash,linked_by) values($1,$2,$3,$4)',
      [importRow, importSource, 'a'.repeat(64), admin],
    );
    const continuation = await row<{
      result: { stage: string; reservationId: string; nextAction: { path: string } };
    }>('select private.import_continuation_result($1) result', [importRow]);
    equal(
      continuation.result.stage,
      'application',
      'a linked draft RA does not skip imported application approval',
    );
    equal(
      continuation.result.reservationId,
      initial.id,
      'import continuation retains the same provisional agreement',
    );
    equal(
      continuation.result.nextAction.path,
      '/admin/customers/applications/' + app.id,
      'import review returns to the coordinated approval screen',
    );

    equal(
      (await create(sm, {}, request)).id,
      app.id,
      'creation replay returns the same application',
    );
    equal(
      (
        await row<{ n: number }>(
          'select count(*)::int n from public.reservation_agreements where customer_application_id=$1',
          [app.id],
        )
      ).n,
      1,
      'creation retry does not duplicate RA',
    );
    const applicationCount = (
      await row<{ n: number }>('select count(*)::int n from public.customer_applications')
    ).n;
    await denied(/OFFICIAL_RA_YEAR_EXHAUSTED/, async () => {
      await db.query(
        "update private.official_ra_sequences set last_sequence=9999 where issue_year=extract(year from now() at time zone 'Asia/Manila')::int",
      );
      await create();
    });
    equal(
      (await row<{ n: number }>('select count(*)::int n from public.customer_applications')).n,
      applicationCount,
      'failed RA creation rolls back its application',
    );
    await denied(/PURCHASE_WORKFLOW_REQUIRED/, () =>
      db.query(
        `insert into public.card_sales(sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,cash_price_snapshot,balance_due_at,status)
      values($1,$2,$3,'staff',$4,'60000.00','60000.00',now()+interval '1 year','submitted')`,
        [randomUUID(), customer.id, plan.id, sm],
      ),
    );

    for (const role of ['senior_sales_manager', 'vice_director', 'ost', 'finance']) {
      await denied(/SALE_ORIGINATION_FORBIDDEN|MUTATION_FORBIDDEN/, () =>
        create(people[role]!, { smStaffId: sm }),
      );
    }
    await denied(/SELLER_OF_RECORD_REQUIRED/, () => create(admin));
    const delegated = await create(admin, { smStaffId: sm });
    equal(
      (
        await row<{ seller_staff_id: string }>(
          'select seller_staff_id from public.reservation_agreements where customer_application_id=$1',
          [delegated.id],
        )
      ).seller_staff_id,
      sm,
      'Admin originates on behalf of active SM',
    );

    const proposal = async (id = app.id, actor = sm) =>
      (
        await row<{ proposal: { expectedProposalHash: string } }>(
          'select public.purchase_terms_proposal($1,$2,null) proposal',
          [id, actor],
        )
      ).proposal;
    const submit = async (id = app.id, actor = sm) =>
      db.query('select public.submit_purchase_application_once($1,$2,$3,$4,null)', [
        randomUUID(),
        actor,
        id,
        (await proposal(id, actor)).expectedProposalHash,
      ]);
    await denied(/CURRENT_ID_DOCUMENT_REQUIRED/, () => submit());
    const idDocument = randomUUID();
    await db.query(
      `insert into public.identity_documents(id,subject_type,customer_id,storage_path,original_filename,mime_type,size_bytes,sha256,
      reviewed_by,reviewed_at,verification_status,reviewed_data,uploaded_by)
      values($1,'customer',$2,$3,'passport.pdf','application/pdf',2048,repeat('a',64),$4,now(),'confirmed','{"fields":{"idType":"passport"}}',$4)`,
      [idDocument, customer.id, `synthetic-workflow/${randomUUID()}.pdf`, sm],
    );
    await submit();
    const submitted = await row<{
      id: string;
      status: string;
      reservation_number: string;
      purchase_terms_id: string;
    }>('select * from public.reservation_agreements where customer_application_id=$1', [app.id]);
    equal(submitted.id, initial.id, 'submission reuses the initial RA');
    equal(
      submitted.reservation_number,
      initial.reservation_number,
      'submission retains the official number',
    );
    equal(submitted.status, 'submitted', 'submission moves RA into review');
    equal(typeof submitted.purchase_terms_id, 'string', 'submission freezes purchase terms');

    const approve = (actor = admin, id = app.id, req = randomUUID()) =>
      db.query("select public.decide_purchase_application_once($1,$2,$3,'approved')", [
        req,
        actor,
        id,
      ]);
    for (const role of [
      'sales_manager',
      'senior_sales_manager',
      'vice_director',
      'ost',
      'finance',
    ]) {
      await denied(/MUTATION_FORBIDDEN|APPLICATION_APPROVAL_FORBIDDEN/, () =>
        approve(people[role]!),
      );
      await denied(/APPLICATION_APPROVAL_FORBIDDEN/, async () => {
        await db.query(
          `insert into public.role_permissions(role_id,module_id,can_view,can_update)
          select r.id,m.id,true,true from public.roles r cross join public.modules m
          where r.slug=$1 and m.key in ('sales.customers','sales.application_approval')
          on conflict(role_id,module_id) do update set can_view=true,can_update=true`,
          [role],
        );
        await approve(people[role]!);
      });
    }
    await denied(/SIGNED_APPLICATION_DOCUMENT_REQUIRED/, () => approve());
    await acceptedSignedDocument(db, {
      kind: 'signed_customer_application',
      entityId: app.id,
      uploader: sm,
      reviewer: sm,
    });
    await denied(/SIGNED_RA_DOCUMENT_REQUIRED/, () => approve());
    await denied(/APPLICATION_APPROVAL_REQUIRED/, () =>
      db.query("select public.transition_purchase_reservation_once($1,$2,$3,'execute','{}')", [
        randomUUID(),
        sm,
        initial.id,
      ]),
    );
    await acceptedSignedDocument(db, {
      kind: 'signed_reservation_agreement',
      entityId: initial.id,
      uploader: admin,
      reviewer: admin,
    });
    await denied(/MUTATION_FORBIDDEN/, async () => {
      await db.query(
        `insert into public.staff_permission_restrictions(staff_id,module_id,deny_update)
        select $1,id,true from public.modules where key='sales.application_approval'`,
        [admin],
      );
      await approve();
    });
    const approvalRequest = randomUUID();
    await approve(admin, app.id, approvalRequest);
    await approve(admin, app.id, approvalRequest);
    equal(
      (
        await row<{ status: string }>(
          'select status from public.customer_applications where id=$1',
          [app.id],
        )
      ).status,
      'approved',
      'coordinated approval approves the application',
    );
    equal(
      (
        await row<{ status: string }>(
          'select status from public.reservation_agreements where id=$1',
          [initial.id],
        )
      ).status,
      'executed',
      'coordinated approval executes RA',
    );
    equal(
      (
        await row<{ n: number }>(
          "select count(*)::int n from public.audit_events where entity_id=$1 and action='RESERVATION_AGREEMENT_EXECUTED'",
          [initial.id],
        )
      ).n,
      1,
      'approval retry does not duplicate execution audit',
    );

    const record = async (purpose: string, amount: string, res = initial.id) => {
      const receiptStoragePath = await paymentReceipt(db, 'workflow');
      return row<{ id: string }>('select public.record_reservation_payment_once($1,$2,$3,$4) id', [
        randomUUID(),
        res,
        { amount, paymentPurpose: purpose, method: 'cash', receiptStoragePath },
        finance,
      ]);
    };
    const verify = (id: string, req = randomUUID()) =>
      row<{ result: Record<string, unknown> }>(
        "select public.verify_purchase_payment_once($1,$2,'verified',null,$3) result",
        [req, id, finance],
      );
    await denied(/RESERVATION_PAYMENT_REQUIRED/, () =>
      record('contractual_installment', '1000.00'),
    );
    await denied(/RESERVATION_FEE_MUST_MATCH_TERMS/, () => record('reservation_fee', '5000.00'));
    const fee = await record('reservation_fee', '10000.00');
    await denied(/PURCHASE_HAS_PAYMENTS/, () =>
      db.query("select public.decide_purchase_application_once($1,$2,$3,'cancelled')", [
        randomUUID(),
        admin,
        app.id,
      ]),
    );
    await verify(fee.id);
    equal(
      (
        await row<{ vip_card_number: string | null }>(
          'select vip_card_number from public.reservation_agreements where id=$1',
          [initial.id],
        )
      ).vip_card_number,
      null,
      'reservation fee alone issues no VIP ID',
    );
    await denied(/FULL_PAYMENT_MUST_SETTLE_BALANCE/, () => record('contractual_full', '1234.56'));
    await denied(/OVERPAYMENT_NOT_ALLOWED/, () =>
      record('contractual_installment', money(totalCents)),
    );
    const partial = await record('contractual_installment', '1234.56');
    const partialResult = await verify(partial.id);
    equal(partialResult.result.fullyPaid, false, 'a partial payment does not settle spot cash');
    equal(
      (
        await row<{ amount: string }>('select amount from public.payments where id=$1', [
          partial.id,
        ])
      ).amount,
      '1234.56',
      'the exact entered partial amount is preserved',
    );
    equal(
      (
        await row<{ payment_scheme: string }>(
          'select payment_scheme_snapshot payment_scheme from public.reservation_agreements where id=$1',
          [initial.id],
        )
      ).payment_scheme,
      'spot_cash',
      'accepting partial money never changes the agreed scheme',
    );
    const forty = await record(
      'contractual_installment',
      money(eligibleCents - 1000000n - 123456n),
    );
    const verificationRequest = randomUUID();
    const verified = await verify(forty.id, verificationRequest);
    const replay = await verify(forty.id, verificationRequest);
    equal(
      verified.result.vipCardNumber,
      replay.result.vipCardNumber,
      'payment retry retains the same purchase VIP ID',
    );
    equal(
      verified.result.commissionEligible,
      true,
      '40 percent verified settlement records eligibility',
    );
    equal(
      (
        await row<{ n: number }>(
          'select count(*)::int n from public.commissions where sale_id in (select sale_id from public.reservation_agreements where id=$1)',
          [initial.id],
        )
      ).n,
      0,
      'eligibility never creates a payable commission before finalization',
    );
    const raBefore = await row<{ vip_card_number: string; commission_eligible_at: Date }>(
      'select vip_card_number,commission_eligible_at from public.reservation_agreements where id=$1',
      [initial.id],
    );
    equal(
      /^[0-9]{11}B1C01S$/.test(raBefore.vip_card_number),
      true,
      'purchase ID uses current numbering',
    );
    const balance = await record('contractual_full', money(totalCents - eligibleCents));
    await verify(balance.id);
    equal(
      (
        await row<{ commission_eligible_at: Date }>(
          'select commission_eligible_at from public.reservation_agreements where id=$1',
          [initial.id],
        )
      ).commission_eligible_at,
      raBefore.commission_eligible_at,
      '40 percent event date is never restamped',
    );
    const finalized = await row<{ id: string }>(
      'select public.finalize_reservation_purchase_once($1,$2,$3) id',
      [randomUUID(), initial.id, finance],
    );
    equal(
      (
        await row<{ n: number }>(
          'select count(*)::int n from public.card_sale_hierarchy_snapshots where sale_id=$1',
          [finalized.id],
        )
      ).n,
      3,
      'normal purchase finalization captures frozen SM, SSM and SVD hierarchy',
    );
    const commission = await row<{ eligible_at: Date; status: string }>(
      'select eligible_at,status from public.commissions where sale_id=$1',
      [finalized.id],
    );
    equal(
      commission.eligible_at,
      raBefore.commission_eligible_at,
      'finalization retains eligibility event',
    );
    equal(commission.status, 'payment_verified', 'finalization never qualifies or pays commission');
    const activated = await row<{ membership_id: string }>(
      'select * from public.activate_card_sale($1,$2)',
      [finalized.id, finance],
    );
    equal(
      typeof activated.membership_id,
      'string',
      'full settlement and finalization allow membership activation',
    );
    await denied(/VIP_CARD_NUMBER_IMMUTABLE/, () =>
      db.query('update public.reservation_agreements set vip_card_number=null where id=$1', [
        initial.id,
      ]),
    );
    const purchaseSummary = await row<{ summary: Record<string, unknown> }>(
      'select public.purchase_financial_summary($1) summary',
      [initial.id],
    );
    equal(
      purchaseSummary.summary.vipCardNumber,
      raBefore.vip_card_number,
      'Finance summary exposes this purchase VIP ID',
    );
    equal(
      typeof purchaseSummary.summary.commissionEligibleAt,
      'string',
      'Finance summary exposes 40 percent milestone before/after finalization',
    );

    const second = await create();
    const secondRa = await row<{ id: string }>(
      'select id from public.reservation_agreements where customer_application_id=$1',
      [second.id],
    );
    await submit(second.id);
    for (const [kind, entityId] of [
      ['signed_customer_application', second.id],
      ['signed_reservation_agreement', secondRa.id],
    ] as const) {
      await acceptedSignedDocument(db, { kind, entityId, uploader: sm, reviewer: sm });
    }
    await approve(admin, second.id);
    const secondFee = await record('reservation_fee', '10000.00', secondRa.id);
    await verify(secondFee.id);
    const secondInstallment = await record('contractual_installment', '1000.00', secondRa.id);
    const secondVerify = await verify(secondInstallment.id);
    equal(
      secondVerify.result.vipCardNumber !== raBefore.vip_card_number,
      true,
      'a second purchase gets its own unique VIP ID',
    );
    equal(
      (
        await row<{ vip_card_number: string }>(
          'select vip_card_number from public.customers where id=$1',
          [customer.id],
        )
      ).vip_card_number,
      raBefore.vip_card_number,
      'a new purchase never overwrites the previous customer projection',
    );
    const secondBalance = await record(
      'contractual_full',
      money(totalCents - 1100000n),
      secondRa.id,
    );
    await verify(secondBalance.id);
    const secondSale = await row<{ id: string }>(
      'select public.finalize_reservation_purchase_once($1,$2,$3) id',
      [randomUUID(), secondRa.id, finance],
    );
    const secondMembership = await row<{ membership_id: string }>(
      'select * from public.activate_card_sale($1,$2)',
      [secondSale.id, finance],
    );
    equal(
      secondMembership.membership_id !== activated.membership_id,
      true,
      'second purchase activation creates a distinct membership',
    );
    equal(
      (
        await row<{ n: number }>(
          'select count(*)::int n from public.points_accounts where membership_id=any($1::uuid[])',
          [[activated.membership_id, secondMembership.membership_id]],
        )
      ).n,
      2,
      'each purchase retains a separate points account',
    );
    equal(
      (
        await row<{ sale_id: string }>('select sale_id from public.memberships where id=$1', [
          activated.membership_id,
        ])
      ).sale_id,
      finalized.id,
      'second activation never overwrites the first membership',
    );
    equal(
      (
        await db.query('select * from public.customer_directory($1)', [
          { id: customer.id, limit: 50 },
        ])
      ).rowCount,
      1,
      'multiple purchases never duplicate the customer directory row',
    );

    // Correct/reject/cancel retains the same linked RA and all signed history.
    await submit(delegated.id, admin);
    const delegatedRa = await row<{ id: string }>(
      'select id from public.reservation_agreements where customer_application_id=$1',
      [delegated.id],
    );
    await acceptedSignedDocument(db, {
      kind: 'signed_customer_application',
      entityId: delegated.id,
      uploader: admin,
      reviewer: admin,
    });
    await acceptedSignedDocument(db, {
      kind: 'signed_reservation_agreement',
      entityId: delegatedRa.id,
      uploader: admin,
      reviewer: admin,
    });
    await db.query("select public.decide_purchase_application_once($1,$2,$3,'draft')", [
      randomUUID(),
      admin,
      delegated.id,
    ]);
    await submit(delegated.id, admin);
    await denied(/SIGNED_APPLICATION_DOCUMENT_REQUIRED/, () => approve(admin, delegated.id));
    equal(
      (
        await row<{ n: number }>(
          'select count(*)::int n from public.purchase_signed_documents where application_id=$1',
          [delegated.id],
        )
      ).n,
      2,
      'correction preserves old signed documents',
    );
    await db.query("select public.decide_purchase_application_once($1,$2,$3,'rejected')", [
      randomUUID(),
      admin,
      delegated.id,
    ]);
    equal(
      (
        await row<{ status: string }>(
          'select status from public.reservation_agreements where id=$1',
          [delegatedRa.id],
        )
      ).status,
      'draft',
      'rejection retains an editable linked RA',
    );
    await db.query("select public.decide_purchase_application_once($1,$2,$3,'draft')", [
      randomUUID(),
      admin,
      delegated.id,
    ]);
    await submit(delegated.id, admin);
    for (const [kind, entityId] of [
      ['signed_customer_application', delegated.id],
      ['signed_reservation_agreement', delegatedRa.id],
    ] as const) {
      await acceptedSignedDocument(db, { kind, entityId, uploader: admin, reviewer: admin });
    }
    await approve(people.super_admin!, delegated.id);
    await db.query("select public.transition_purchase_reservation_once($1,$2,$3,'cancel','{}')", [
      randomUUID(),
      admin,
      delegatedRa.id,
    ]);
    equal(
      (
        await row<{ status: string }>(
          'select status from public.customer_applications where id=$1',
          [delegated.id],
        )
      ).status,
      'cancelled',
      'unfunded RA cancellation also cancels approved application',
    );
    // Historical applications may have been approved before separate RA
    // execution. Finish them with the joint decision, preserving old evidence.
    const historical = await create();
    await submit(historical.id);
    const historicalRa = await row<{ id: string }>(
      'select id from public.reservation_agreements where customer_application_id=$1',
      [historical.id],
    );
    await acceptedSignedDocument(db, {
      kind: 'signed_customer_application',
      entityId: historical.id,
      uploader: sm,
      reviewer: sm,
    });
    await db.query(
      "update public.customer_applications set status='approved',approved_at='2026-10-01T00:00:00Z' where id=$1",
      [historical.id],
    );
    await denied(/SIGNED_RA_DOCUMENT_REQUIRED/, () => approve(admin, historical.id));
    await db.query("update public.reservation_agreements set status='draft' where id=$1", [
      historicalRa.id,
    ]);
    await acceptedSignedDocument(db, {
      kind: 'signed_reservation_agreement',
      entityId: historicalRa.id,
      uploader: sm,
      reviewer: sm,
    });
    await approve(admin, historical.id);
    equal(
      (
        await row<{ status: string }>(
          'select status from public.reservation_agreements where id=$1',
          [historicalRa.id],
        )
      ).status,
      'executed',
      'legacy approval completes the existing RA through joint approval',
    );
    equal(
      (
        await row<{ original: boolean }>(
          "select approved_at='2026-10-01T00:00:00Z'::timestamptz original from public.customer_applications where id=$1",
          [historical.id],
        )
      ).original,
      true,
      'legacy administrative approval time is preserved',
    );
    return checks;
  } finally {
    await db.query('rollback to savepoint workflow_alignment');
    await db.query('release savepoint workflow_alignment');
  }
}

/** Independent sessions prove parent locks, retries and allocation under contention. */
export async function runWorkflowConcurrencyChecks(db: Client, url: string): Promise<number> {
  const other = new PgClient({ connectionString: url });
  await other.connect();
  let checks = 0;
  const equal = (actual: unknown, expected: unknown, label: string) => {
    assert.deepEqual(actual, expected, label);
    checks++;
  };
  const scalar = async (sql: string, args: unknown[] = []) =>
    (await db.query(sql, args)).rows[0]!.v;
  const race = async (sql: string, args: unknown[], secondArgs = args) => {
    const results = await Promise.allSettled([db.query(sql, args), other.query(sql, secondArgs)]);
    equal(
      results.some((result) => result.status === 'fulfilled'),
      true,
      'at least one concurrent action succeeds',
    );
    equal(
      results.some((result) => result.status === 'rejected' && result.reason.code === '40P01'),
      false,
      'no concurrent action deadlocks',
    );
    return results;
  };
  try {
    const staff: Record<string, string> = {};
    for (const slug of [
      'super_admin',
      'admin',
      'finance',
      'sales_manager',
      'senior_sales_manager',
      'vice_director',
    ]) {
      const id = randomUUID();
      const email = `${id}@example.invalid`;
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
      await db.query(
        "insert into public.staff_users(id,email,full_name,status) values($1,$2,'WORKFLOW RACE','active')",
        [id, email],
      );
      await db.query(
        'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
        [id, slug],
      );
      staff[slug] = id;
    }
    const sm = staff.sales_manager!;
    const admin = staff.admin!;
    const finance = staff.finance!;
    for (const [child, parent, role] of [
      [sm, staff.senior_sales_manager, 'sales_manager'],
      [staff.senior_sales_manager, staff.vice_director, 'senior_sales_manager'],
    ]) {
      await db.query(
        `insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active)
        values($1,$2,$3,true,true)`,
        [child, parent, role],
      );
    }
    const plan = await scalar("select id v from public.card_plans where code='BRONZE'");
    const customer = await scalar(
      `insert into public.customers(customer_number,first_name,last_name,birth_date,email,phone,status)
      select customer_number,'ELENA','SANTOS','1990-01-01',$1,'+639170000002','prospect' from public.next_customer_number() returning id v`,
      [randomUUID() + '@example.invalid'],
    );
    await db.query(
      `insert into public.identity_documents(subject_type,customer_id,storage_path,original_filename,mime_type,size_bytes,sha256,
      reviewed_by,reviewed_at,verification_status,reviewed_data,uploaded_by)
      values('customer',$1,$2,'passport.pdf','application/pdf',2048,repeat('a',64),$3,now(),'confirmed','{"fields":{"idType":"passport"}}',$3)`,
      [customer, `synthetic-race/${randomUUID()}.pdf`, sm],
    );
    const header = {
      customerId: customer,
      planId: plan,
      paymentScheme: 'spot_cash',
      acquisitionChannels: [],
      consentAcknowledged: true,
      acknowledgedAt: '2026-11-16',
      primarySignatureStatus: 'received',
      validIdReceived: true,
    };
    const holder = {
      firstName: 'ELENA',
      lastName: 'SANTOS',
      birthDate: '1990-01-01',
      permanentAddressLine1: '1 Garden Street',
      cityMunicipality: 'Calamba',
      province: 'Laguna',
      mobile: '+639170000002',
      email: randomUUID() + '@example.invalid',
      printedName: 'ELENA SANTOS',
    };
    const create = await race(
      'select public.create_customer_application_once($1,$2,$3,$4,null) v',
      [randomUUID(), sm, header, holder],
    );
    equal(
      create.every((result) => result.status === 'fulfilled'),
      true,
      'concurrent creation retries both succeed',
    );
    const app = create.find((result) => result.status === 'fulfilled')!;
    assert.equal(app.status, 'fulfilled');
    const id = app.value.rows[0]!.v;
    equal(
      await scalar(
        'select count(*)::int v from public.reservation_agreements where customer_application_id=$1',
        [id],
      ),
      1,
      'concurrent creation allocates one RA',
    );
    const ra = await scalar(
      'select id v from public.reservation_agreements where customer_application_id=$1',
      [id],
    );
    const proposal = await scalar('select public.purchase_terms_proposal($1,$2,null) v', [id, sm]);
    await race('select public.submit_purchase_application_once($1,$2,$3,$4,null)', [
      randomUUID(),
      sm,
      id,
      proposal.expectedProposalHash,
    ]);
    equal(
      await scalar(
        'select count(*)::int v from public.customer_application_purchase_terms where application_id=$1',
        [id],
      ),
      1,
      'concurrent submission freezes one version',
    );
    for (const [kind, entityId] of [
      ['signed_customer_application', id],
      ['signed_reservation_agreement', ra],
    ] as const) {
      await acceptedSignedDocument(db, { kind, entityId, uploader: sm, reviewer: sm });
    }
    await race(
      "select public.decide_purchase_application_once($1,$2,$3,'approved')",
      [randomUUID(), admin, id],
      [randomUUID(), admin, id],
    );
    equal(
      await scalar(
        "select a.status||'/'||r.status v from public.customer_applications a join public.reservation_agreements r on r.customer_application_id=a.id where a.id=$1",
        [id],
      ),
      'approved/executed',
      'concurrent decisions leave coordinated statuses',
    );
    equal(
      await scalar(
        "select count(*)::int v from public.audit_events where entity_id=$1 and action='RESERVATION_AGREEMENT_EXECUTED'",
        [ra],
      ),
      1,
      'one execution event under concurrent approval',
    );
    const terms = (
      await db.query(
        'select reservation_fee_snapshot fee,total_price_snapshot total from public.reservation_agreements where id=$1',
        [ra],
      )
    ).rows[0]!;
    const feePayload = {
      amount: terms.fee,
      paymentPurpose: 'reservation_fee',
      method: 'cash',
      receiptStoragePath: await paymentReceipt(db, 'race-fee'),
    };
    const feeRequest = randomUUID();
    await race('select public.record_reservation_payment_once($1,$2,$3,$4)', [
      feeRequest,
      ra,
      feePayload,
      finance,
    ]);
    const fee = await scalar(
      "select id v from public.payments where reservation_id=$1 and payment_purpose='reservation_fee'",
      [ra],
    );
    await race(
      "select public.verify_purchase_payment_once($1,$2,'verified',null,$3)",
      [randomUUID(), fee, finance],
      [randomUUID(), fee, finance],
    );
    equal(
      await scalar('select vip_card_number v from public.reservation_agreements where id=$1', [ra]),
      null,
      'concurrent reservation verification issues no VIP ID',
    );
    const balance = await scalar('select private.money($1::numeric-$2::numeric) v', [
      terms.total,
      terms.fee,
    ]);
    const payment = await scalar('select public.record_reservation_payment_once($1,$2,$3,$4) v', [
      randomUUID(),
      ra,
      {
        amount: balance,
        paymentPurpose: 'contractual_full',
        method: 'cash',
        receiptStoragePath: await paymentReceipt(db, 'race-balance'),
      },
      finance,
    ]);
    await race(
      "select public.verify_purchase_payment_once($1,$2,'verified',null,$3)",
      [randomUUID(), payment, finance],
      [randomUUID(), payment, finance],
    );
    equal(
      await scalar(
        'select count(*)::int v from private.vip_card_number_issuances where customer_id=$1',
        [customer],
      ),
      1,
      'concurrent non-reservation verification allocates one VIP ID',
    );
    equal(
      await scalar(
        "select count(*)::int v from public.payments where reservation_id=$1 and status='verified'",
        [ra],
      ),
      2,
      'duplicate requests leave two actual receipts',
    );
    await race(
      'select public.finalize_reservation_purchase_once($1,$2,$3)',
      [randomUUID(), ra, finance],
      [randomUUID(), ra, finance],
    );
    const sale = await scalar('select sale_id v from public.reservation_agreements where id=$1', [
      ra,
    ]);
    equal(
      await scalar('select count(*)::int v from public.card_sales where customer_id=$1', [
        customer,
      ]),
      1,
      'concurrent finalization creates one sale',
    );
    equal(
      await scalar('select count(*)::int v from public.commissions where sale_id=$1', [sale]),
      1,
      'concurrent finalization creates one commission',
    );
    await race('select * from public.activate_card_sale($1,$2)', [sale, finance]);
    equal(
      await scalar('select count(*)::int v from public.memberships where sale_id=$1', [sale]),
      1,
      'concurrent activation creates one membership',
    );
    return checks;
  } finally {
    await other.end();
  }
}
