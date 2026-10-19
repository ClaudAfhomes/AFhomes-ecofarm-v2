import assert from 'node:assert/strict';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

let postgres;
let failure;
try {
  postgres = await startDisposablePostgres();
  const db = postgres.client;
  const exists = (
    await db.query(
      "select to_regprocedure('public.continue_customer_import_once(uuid,uuid,uuid,text,text)') is not null as ok",
    )
  ).rows[0].ok;
  assert.equal(exists, true, 'new continuation wrapper must exist after local migrations');
  console.log('PASS continuation function installed on disposable PostgreSQL');
  const actor = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    'synthetic-import-admin@example.invalid',
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC ADMIN','active')",
    [actor, 'synthetic-import-admin@example.invalid'],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",
    [actor],
  );
  const raw = {
    workbook_format: 'company_v2',
    purchase_reference: 'SYNTHETIC PURCHASE ONE',
    first_name: 'Synthetic',
    last_name: 'Customer',
    email: 'synthetic-import-customer@example.invalid',
    mobile: '09123456789',
    stated_status: 'Reservation Paid',
    vip_tier: 'GOLD',
  };
  const normalized = {
    category: 'PENDING',
    customerStatus: 'prospect',
    payment: null,
    requireMember: false,
    person: {
      firstName: 'Synthetic',
      lastName: 'Customer',
      email: raw.email,
      phone: '+639123456789',
      address: { line1: 'Synthetic Street', countryCode: 'PH' },
    },
    company: {
      companyStatus: 'Reservation Paid',
      citizenship: 'Filipino',
      statedVipPackage: 'GOLD',
      statedRf: '10000.00',
      statedTotalAmount: '312000.00',
    },
    paymentClaims: [
      {
        paymentKey: 'RECEIPT ONE',
        purpose: 'reservation',
        amount: '10000.00',
        date: '2026-10-16',
        method: 'cash',
        reference: 'SYNTHETIC RECEIPT ONE',
      },
    ],
  };
  const newRow = async (fields = raw, data = normalized) => {
    const job = randomUUID(),
      row = randomUUID();
    await db.query(
      "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'excel','synthetic.xlsx','ready',1,1,$2,now())",
      [job, actor],
    );
    await db.query(
      "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,2,$3,$4,'valid','CREATE')",
      [row, job, fields, data],
    );
    return row;
  };
  const preview = async (row) =>
    (
      await db.query('select public.preview_customer_import_continuation($1,$2) as result', [
        row,
        actor,
      ])
    ).rows[0].result;
  const confirm = async (row, p) =>
    (
      await db.query('select public.continue_customer_import_once($1,$2,$3,$4,$5) as result', [
        row,
        actor,
        randomUUID(),
        p.expectedSourceHash,
        p.expectedTargetVersion,
      ])
    ).rows[0].result;
  const row = await newRow(),
    p = await preview(row);
  assert.equal(p.customerId, null);
  assert.equal(p.stage, 'application');
  const first = await confirm(row, p),
    again = await confirm(row, p);
  assert.equal(first.customerId, again.customerId);
  assert.equal(first.sourceId, again.sourceId);
  const stored = (
    await db.query(
      'select citizenship,company_status,stated_vip_package,stated_rf,address from public.customers where id=$1',
      [first.customerId],
    )
  ).rows[0];
  assert.equal(stored.citizenship, 'Filipino');
  assert.equal(stored.company_status, 'Reservation Paid');
  assert.equal(stored.stated_vip_package, 'GOLD');
  assert.equal(stored.address.line1, 'Synthetic Street');
  assert.equal(
    first.applicationId,
    null,
    'missing mandatory acknowledgment must remain intake, not a fabricated draft',
  );
  assert.equal(first.claimCount, 1);
  assert.equal(
    (
      await db.query('select count(*)::int as n from public.payments where customer_id=$1', [
        first.customerId,
      ])
    ).rows[0].n,
    0,
    'a claim must not record accounting',
  );
  console.log(
    'PASS complete details, canonical retry, safe incomplete intake and claim-only import',
  );
  const reimport = await newRow();
  const repeated = await confirm(reimport, await preview(reimport));
  assert.equal(repeated.sourceId, first.sourceId);
  assert.equal(
    (
      await db.query(
        'select count(*)::int as n from private.customer_import_payment_claims where source_id=$1',
        [first.sourceId],
      )
    ).rows[0].n,
    1,
  );
  const other = await newRow({ ...raw, purchase_reference: 'SYNTHETIC PURCHASE TWO' });
  const second = await confirm(other, await preview(other));
  assert.equal(second.customerId, first.customerId);
  assert.notEqual(second.sourceId, first.sourceId);
  console.log(
    'PASS cross-job source/claim uniqueness and two legitimate purchases for one customer',
  );
  const stale = await newRow({ ...raw, purchase_reference: 'SYNTHETIC PURCHASE THREE' }),
    stalePreview = await preview(stale);
  await db.query(
    "update public.customers set occupation_business_name='NEWER SYNTHETIC EDIT' where id=$1",
    [first.customerId],
  );
  await assert.rejects(confirm(stale, stalePreview), /IMPORT_TARGET_CHANGED/);
  assert.equal(
    (
      await db.query('select occupation_business_name from public.customers where id=$1', [
        first.customerId,
      ])
    ).rows[0].occupation_business_name,
    'NEWER SYNTHETIC EDIT',
  );
  const acl = (
    await db.query(
      "select has_function_privilege('authenticated','public.continue_customer_import_once(uuid,uuid,uuid,text,text)','EXECUTE') as browser,has_function_privilege('service_role','private.commit_customer_import_source(uuid,uuid,text,text,jsonb,jsonb)','EXECUTE') as helper",
    )
  ).rows[0];
  assert.equal(acl.browser, false);
  assert.equal(acl.helper, false);
  console.log('PASS stale customer edit protection and explicit RPC/helper ACLs');
  const plan = (
    await db.query("select id from public.card_plans where code='GOLD' and is_active limit 1")
  ).rows[0];
  const header = {
    customerId: first.customerId,
    planId: plan.id,
    paymentScheme: 'move_a',
    tier: 'GOLD',
    consentAcknowledged: true,
    acknowledgedAt: '2026-10-16',
    primarySignatureStatus: 'received',
    validIdReceived: true,
    reservationPaymentProofReceived: true,
    acquisitionChannels: [],
  };
  const primary = {
    firstName: 'Synthetic',
    lastName: 'Customer',
    birthDate: '1990-02-03',
    permanentAddressLine1: 'Synthetic Street',
    province: 'Laguna',
    cityMunicipality: 'Calamba',
    mobile: '+639123456789',
    email: raw.email,
    printedName: 'Synthetic Customer',
  };
  const complete = async (row, tokens) =>
    (
      await db.query(
        'select public.complete_import_application_once($1,$2,$3,$4,$5,$6,$7,null,null) as result',
        [
          row,
          actor,
          randomUUID(),
          tokens.expectedSourceHash,
          tokens.expectedTargetVersion,
          header,
          primary,
        ],
      )
    ).rows[0].result;
  const beforeDraft = await preview(row),
    draft = await complete(row, beforeDraft);
  assert.ok(draft.applicationId);
  assert.equal(
    (await complete(row, beforeDraft)).applicationId,
    draft.applicationId,
    'same source/draft under another request ID must reuse application',
  );
  const secondDraft = await complete(other, await preview(other));
  assert.notEqual(
    secondDraft.applicationId,
    draft.applicationId,
    'two purchases for one customer must remain separate',
  );
  const offer = (
    await db.query('select public.purchase_terms_proposal($1,$2,null) as offer', [
      draft.applicationId,
      actor,
    ])
  ).rows[0].offer;
  await db.query('select public.submit_purchase_application_once($1,$2,$3,$4,null)', [
    randomUUID(),
    actor,
    draft.applicationId,
    offer.expectedProposalHash,
  ]);
  await db.query("select public.decide_purchase_application_once($1,$2,$3,'approved')", [
    randomUUID(),
    actor,
    draft.applicationId,
  ]);
  const terms = (
    await db.query(
      'select id from public.customer_application_purchase_terms where application_id=$1 order by version desc limit 1',
      [draft.applicationId],
    )
  ).rows[0];
  const reservation = (
    await db.query('select public.reserve_application_purchase_once($1,$2,$3,$4,$5) as id', [
      randomUUID(),
      actor,
      draft.applicationId,
      terms.id,
      {
        reservationDate: '2026-10-16',
        agreementDate: '2026-10-16',
        primarySignatureStatus: 'received',
        primaryAddress: 'Synthetic Street',
      },
    ])
  ).rows[0].id;
  await db.query("select public.transition_purchase_reservation_once($1,$2,$3,'submit','{}')", [
    randomUUID(),
    actor,
    reservation,
  ]);
  await db.query("select public.transition_purchase_reservation_once($1,$2,$3,'execute','{}')", [
    randomUUID(),
    actor,
    reservation,
  ]);
  assert.equal((await preview(row)).stage, 'finance');
  const claims = async () =>
    (
      await db.query('select public.customer_import_payment_claims($1,$2,null) as result', [
        actor,
        first.sourceId,
      ])
    ).rows[0].result;
  let claim = (await claims())[0];
  const accept = async (claim, decision) =>
    (
      await db.query(
        'select public.accept_import_payment_claim_once($1,$2,$3,$4,$5,$6) as result',
        [
          claim.id,
          actor,
          randomUUID(),
          claim.expectedClaimVersion,
          claim.expectedTargetVersion,
          decision,
        ],
      )
    ).rows[0].result;
  await assert.rejects(
    accept(claim, { kind: 'record', proofDocumentId: randomUUID() }),
    /IMPORT_PROOF_REQUIRED/,
  );
  assert.equal(
    (
      await db.query('select count(*)::int as n from public.payments where customer_id=$1', [
        first.customerId,
      ])
    ).rows[0].n,
    0,
  );
  const proof = (
    await db.query("select public.prepare_import_claim_proof($1,$2,'image/png') as result", [
      claim.id,
      actor,
    ])
  ).rows[0].result;
  await db.query('select public.complete_import_claim_proof($1,$2,$3,$4)', [
    claim.id,
    actor,
    proof.proofDocumentId,
    'a'.repeat(64),
  ]);
  claim = (await claims())[0];
  const beforeRecord = (
    await db.query('select public.purchase_financial_summary($1) as result', [reservation])
  ).rows[0].result;
  const recorded = await accept(claim, { kind: 'record', proofDocumentId: proof.proofDocumentId });
  assert.equal(
    (await accept(claim, { kind: 'record', proofDocumentId: proof.proofDocumentId })).paymentId,
    recorded.paymentId,
  );
  const afterRecord = (
    await db.query('select public.purchase_financial_summary($1) as result', [reservation])
  ).rows[0].result;
  assert.equal(afterRecord.verifiedTotal, beforeRecord.verifiedTotal);
  assert.equal(afterRecord.remainingBalance, beforeRecord.remainingBalance);
  assert.equal(
    (await db.query('select status from public.payments where id=$1', [recorded.paymentId])).rows[0]
      .status,
    'recorded',
  );
  await db.query("select public.verify_purchase_payment_once($1,$2,'verified',null,$3)", [
    randomUUID(),
    recorded.paymentId,
    actor,
  ]);
  const afterVerify = (
    await db.query('select public.purchase_financial_summary($1) as result', [reservation])
  ).rows[0].result;
  assert.equal(afterVerify.verifiedTotal, '10000.00');
  assert.equal(afterVerify.remainingBalance, '302000.00');
  const duplicateClaim = (
    await db.query(
      "insert into private.customer_import_payment_claims(source_id,claim_reference,normalized_reference,purpose,amount,payment_date,method,bank_reference,notes,fingerprint) select source_id,'SYNTHETIC DUPLICATE CLAIM','synthetic duplicate claim',purpose,amount,payment_date,method,bank_reference,notes,fingerprint from private.customer_import_payment_claims where id=$1 returning id",
      [claim.id],
    )
  ).rows[0].id;
  const matching = (await claims()).find((c) => c.id === duplicateClaim);
  const page1 = (
    await db.query('select public.customer_import_payment_claims($1,$2,null,1,0) result', [
      actor,
      first.sourceId,
    ])
  ).rows[0].result;
  const page2 = (
    await db.query('select public.customer_import_payment_claims($1,$2,null,1,1) result', [
      actor,
      first.sourceId,
    ])
  ).rows[0].result;
  assert.equal(page1.length, 1);
  assert.equal(page2.length, 1);
  assert.notEqual(page1[0].id, page2[0].id);
  const linked = await accept(matching, {
    kind: 'match',
    paymentId: recorded.paymentId,
    reason: 'Same original receipt, reconciled to existing payment',
  });
  assert.equal(linked.paymentId, recorded.paymentId);
  assert.equal(
    (
      await db.query('select count(*)::int n from public.payments where customer_id=$1', [
        first.customerId,
      ])
    ).rows[0].n,
    1,
  );
  console.log(
    'PASS Finance matches an existing verified receipt without recording another payment',
  );
  assert.equal(
    (
      await db.query('select count(*)::int as n from public.memberships where customer_id=$1', [
        first.customerId,
      ])
    ).rows[0].n,
    0,
  );
  console.log(
    'PASS normal application/reservation handoff, explicit Finance acceptance, separate verification and no early membership',
  );
  const legacy = await newRow(
    { ...raw, workbook_format: 'company_v1', purchase_reference: '' },
    { ...normalized, paymentClaims: [] },
  );
  const legacyIntake = await confirm(legacy, await preview(legacy));
  await assert.rejects(
    complete(legacy, await preview(legacy)),
    /IMPORT_PURCHASE_REFERENCE_REQUIRED/,
  );
  assert.equal((await preview(legacy)).applicationId, null);
  console.log(
    'PASS legacy intake requires a reviewed purchase identity before application creation',
  );
  const completeLegacy = async (row, tokens) =>
    (
      await db.query(
        'select public.complete_import_application_once($1,$2,$3,$4,$5,$6,$7,null,null) result',
        [
          row,
          actor,
          randomUUID(),
          tokens.expectedSourceHash,
          tokens.expectedTargetVersion,
          { ...header, importPurchaseReference: 'SYNTHETIC REVIEWED LEGACY PURCHASE' },
          primary,
        ],
      )
    ).rows[0].result;
  const recovered = await completeLegacy(legacy, await preview(legacy));
  assert.ok(recovered.applicationId);
  const legacyAgain = await newRow(
    { ...raw, workbook_format: 'company_v1', purchase_reference: '' },
    { ...normalized, paymentClaims: [] },
  );
  await confirm(legacyAgain, await preview(legacyAgain));
  const relinked = await completeLegacy(legacyAgain, await preview(legacyAgain));
  assert.equal(relinked.sourceId, recovered.sourceId);
  assert.equal(relinked.applicationId, recovered.applicationId);
  const continuations = (
    await db.query('select public.customer_import_continuations($1,$2,100,0) result', [
      actor,
      first.customerId,
    ])
  ).rows[0].result;
  assert.equal(continuations.filter((item) => item.sourceId === recovered.sourceId).length, 1);
  assert.equal(
    (
      await db.query(
        'select count(*)::int n from private.customer_import_purchase_sources where superseded_by=$1',
        [recovered.sourceId],
      )
    ).rows[0].n,
    2,
  );
  console.log(
    'PASS legacy recovery across duplicate imports reuses one reviewed purchase/application and retains provisional evidence',
  );
  const makeStaff = async (name, role) => {
    const id = randomUUID(),
      email = id + '@example.invalid';
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,$3,'active')",
      [id, email, name],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    return id;
  };
  const vd = await makeStaff('SYNTHETIC TREE VD', 'vice_director'),
    ssm = await makeStaff('SYNTHETIC TREE SSM', 'senior_sales_manager');
  const sm = await makeStaff('SYNTHETIC TREE SM', 'sales_manager'),
    sm2 = await makeStaff('SYNTHETIC OTHER SM', 'sales_manager');
  const ref = await makeStaff('SYNTHETIC TREE OST', 'ost'),
    vip = await makeStaff('SYNTHETIC TREE VIP', 'ost');
  const ist = await makeStaff('SYNTHETIC REGISTERED IST', 'employee');
  for (const [subject, parent, role] of [
    [ssm, vd, 'senior_sales_manager'],
    [sm, ssm, 'sales_manager'],
    [sm2, ssm, 'sales_manager'],
    [ref, sm, 'ost'],
    [vip, sm2, 'ost'],
  ])
    await db.query(
      'insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,assigned_by) values($1,$2,$3,$4)',
      [subject, parent, role, actor],
    );
  const teamRaw = {
    ...raw,
    purchase_reference: 'SYNTHETIC TEAM PURCHASE',
    email: 'synthetic-team-customer@example.invalid',
    vd_name: 'SYNTHETIC TREE VD',
    vd_staff_id: vd,
    ssm_name: 'SYNTHETIC TREE SSM',
    ssm_staff_id: ssm,
    sm_name: 'SYNTHETIC TREE SM',
    sm_staff_id: sm,
    referrer_name: 'SYNTHETIC TREE OST',
    referrer_staff_id: ref,
    recommender_name: 'SYNTHETIC TREE VIP',
    recommender_staff_id: vip,
  };
  const teamData = {
    ...normalized,
    person: { ...normalized.person, email: teamRaw.email },
    paymentClaims: [],
  };
  const teamRow = await newRow(teamRaw, teamData);
  assert.ok((await confirm(teamRow, await preview(teamRow))).customerId);
  const otherVd = await makeStaff('SYNTHETIC DIFFERENT VD', 'vice_director');
  await db.query(
    'update public.referral_relationships set is_active=false where subject_staff_id=$1',
    [vip],
  );
  await db.query(
    "insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,assigned_by) values($1,$2,'ost',$3)",
    [vip, otherVd, actor],
  );
  const wrongTree = await newRow(
    { ...teamRaw, purchase_reference: 'SYNTHETIC WRONG TEAM' },
    teamData,
  );
  await assert.rejects(confirm(wrongTree, await preview(wrongTree)), /IMPORT_GENEALOGY_CONFLICT/);
  assert.equal(
    (
      await db.query('select count(*)::int n from public.staff_users where id=any($1)', [
        [vd, ssm, sm, sm2, ref, vip, ist],
      ])
    ).rows[0].n,
    7,
  );
  console.log(
    'PASS registered IST/OST preserved; same VD with different direct uplines accepted, different VD rejected',
  );
  const multiRaw = {
    ...raw,
    email: 'synthetic-two-purchases@example.invalid',
    purchase_reference: 'SAME JOB FIRST',
  };
  const multiData = {
    ...normalized,
    person: { ...normalized.person, email: multiRaw.email },
    paymentClaims: [],
  };
  const multi1 = await newRow(multiRaw, multiData),
    multi2 = await newRow({ ...multiRaw, purchase_reference: 'SAME JOB SECOND' }, multiData);
  await db.query(
    'update public.customer_import_rows set import_job_id=(select import_job_id from public.customer_import_rows where id=$1),row_number=3 where id=$2',
    [multi1, multi2],
  );
  const multiPreviews = (
    await db.query('select public.prepare_customer_import_batch($1,$2) result', [
      [multi1, multi2],
      actor,
    ])
  ).rows[0].result;
  const purchase1 = await confirm(
    multi1,
    multiPreviews.find((p) => p.rowId === multi1),
  );
  const purchase2 = await confirm(
    multi2,
    multiPreviews.find((p) => p.rowId === multi2),
  );
  assert.equal(purchase1.customerId, purchase2.customerId);
  assert.notEqual(purchase1.sourceId, purchase2.sourceId);
  console.log('PASS two purchase rows for one new customer in the same reviewed workbook');
  const concurrentRaw = {
    ...raw,
    email: 'synthetic-concurrent@example.invalid',
    purchase_reference: 'SYNTHETIC CONCURRENT PURCHASE',
  };
  const concurrentRow = await newRow(concurrentRaw, {
    ...normalized,
    person: { ...normalized.person, email: concurrentRaw.email },
    paymentClaims: [],
  });
  const concurrentPreview = await preview(concurrentRow);
  const clients = [
    new pg.Client({ connectionString: postgres.url }),
    new pg.Client({ connectionString: postgres.url }),
  ];
  try {
    await Promise.all(clients.map((client) => client.connect()));
    const receipts = await Promise.all(
      clients.map((client) =>
        client.query('select public.continue_customer_import_once($1,$2,$3,$4,$5) result', [
          concurrentRow,
          actor,
          randomUUID(),
          concurrentPreview.expectedSourceHash,
          concurrentPreview.expectedTargetVersion,
        ]),
      ),
    );
    assert.equal(receipts[0].rows[0].result.sourceId, receipts[1].rows[0].result.sourceId);
    const receipt = receipts[0].rows[0].result,
      tokens = await preview(concurrentRow);
    const drafts = await Promise.all(
      clients.map((client) =>
        client.query(
          'select public.complete_import_application_once($1,$2,$3,$4,$5,$6,$7,null,null) result',
          [
            concurrentRow,
            actor,
            randomUUID(),
            tokens.expectedSourceHash,
            tokens.expectedTargetVersion,
            { ...header, customerId: receipt.customerId },
            { ...primary, email: concurrentRaw.email },
          ],
        ),
      ),
    );
    assert.equal(drafts[0].rows[0].result.applicationId, drafts[1].rows[0].result.applicationId);
    assert.equal(
      (
        await db.query(
          'select count(*)::int n from public.customer_applications where customer_id=$1',
          [receipt.customerId],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await Promise.all(clients.map((client) => client.end()));
  }
  console.log(
    'PASS concurrent distinct-request intake and application retries create one canonical application',
  );
  const normalApp = (
    await db.query('select public.save_customer_application(null,$1,$2,$3,null) id', [
      actor,
      header,
      primary,
    ])
  ).rows[0].id;
  const normalOffer = (
    await db.query('select public.purchase_terms_proposal($1,$2,null) offer', [normalApp, actor])
  ).rows[0].offer;
  await db.query('select public.submit_purchase_application_once($1,$2,$3,$4,null)', [
    randomUUID(),
    actor,
    normalApp,
    normalOffer.expectedProposalHash,
  ]);
  await db.query("select public.decide_purchase_application_once($1,$2,$3,'approved')", [
    randomUUID(),
    actor,
    normalApp,
  ]);
  const normalTerms = (
    await db.query('select purchase_terms_id id from public.customer_applications where id=$1', [
      normalApp,
    ])
  ).rows[0].id;
  const normalReservation = (
    await db.query('select public.reserve_application_purchase_once($1,$2,$3,$4,$5) id', [
      randomUUID(),
      actor,
      normalApp,
      normalTerms,
      {
        reservationDate: '2026-10-16',
        agreementDate: '2026-10-16',
        primarySignatureStatus: 'received',
        primaryAddress: 'Synthetic Street',
      },
    ])
  ).rows[0].id;
  const normalReference = (
    await db.query('select reservation_number from public.reservation_agreements where id=$1', [
      normalReservation,
    ])
  ).rows[0].reservation_number;
  const linkedRow = await newRow(
    {
      ...raw,
      purchase_reference: 'SYNTHETIC EXISTING RESERVATION',
      existing_reservation_reference: normalReference,
    },
    normalized,
  );
  const applicationCount = (
    await db.query('select count(*)::int n from public.customer_applications')
  ).rows[0].n;
  const existingLink = await confirm(linkedRow, await preview(linkedRow));
  assert.equal(existingLink.applicationId, normalApp);
  assert.equal(existingLink.reservationId, normalReservation);
  assert.equal(existingLink.stage, 'reservation');
  assert.equal(
    (await db.query('select count(*)::int n from public.customer_applications')).rows[0].n,
    applicationCount,
  );
  console.log(
    'PASS exact existing reservation reference reuses its normal application without creating history',
  );
  const wrongTermsRow = await newRow(
    {
      ...raw,
      purchase_reference: 'SYNTHETIC CONFLICTING RESERVATION',
      existing_reservation_reference: normalReference,
      stated_total: '999.00',
    },
    normalized,
  );
  await assert.rejects(preview(wrongTermsRow), /IMPORT_HISTORICAL_TERMS_REVIEW_REQUIRED/);
  assert.equal(
    (await db.query('select count(*)::int n from public.customer_applications')).rows[0].n,
    applicationCount,
  );
  console.log('PASS conflicting existing reservation terms are held before any history is created');
} catch (error) {
  console.error('FAIL customer import continuation:', error.message);
  failure = error;
} finally {
  if (postgres) await postgres.stop();
}
process.exit(failure ? 1 : 0);
