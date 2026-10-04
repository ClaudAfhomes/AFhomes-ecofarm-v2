import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

type Check = (label: string, ok: boolean, detail?: string) => void;
type Context = {
  db: Client;
  url: string;
  actor: string;
  seller: string;
  employee: string;
  run: string;
  createdCustomers: string[];
  check: Check;
};

/** Real, independent PostgreSQL sessions; never a mock or a remote test fixture. */
export async function runIdempotencyChecks(ctx: Context) {
  const { db, actor, seller, employee, check } = ctx;
  const customer = randomUUID();
  const sale = randomUUID();
  const plans = (
    await db.query<{
      id: string;
      code: string;
      cash_price: string;
      minimum_down_payment: string;
      yearly_points: string;
      commission_rate: string;
    }>("select * from public.card_plans where code in ('GOLD','SILVER')")
  ).rows;
  const gold = plans.find((p) => p.code === 'GOLD')!;
  const silver = plans.find((p) => p.code === 'SILVER')!;
  await db.query(
    `insert into public.customers(id,customer_number,first_name,last_name,birth_date,email,phone,status,created_by)
    select $1,customer_number,'RETRY','TEST','1990-01-01',$2,'09175550001','prospect',$3 from public.next_customer_number()`,
    [customer, `${ctx.run}-idempotency@example.invalid`, actor],
  );
  ctx.createdCustomers.push(customer);
  await db.query(
    `insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,
    cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
    commission_rate_snapshot,expected_commission_snapshot,status,submitted_at,balance_due_at)
    select $1,sale_number,$2,$3,'staff',$4,$5,$5,$6,$7,$8,'0.00','submitted',now(),now()+interval '365 days'
    from public.next_sale_number()`,
    [
      sale,
      customer,
      gold.id,
      seller,
      gold.cash_price,
      gold.minimum_down_payment,
      gold.yearly_points,
      gold.commission_rate,
    ],
  );

  const count = async (sql: string, args: unknown[] = []) =>
    (await db.query<{ n: number }>(sql, args)).rows[0]!.n;
  const concurrent = async (sql: string, args: unknown[]) => {
    const clients = [
      new Client({ connectionString: ctx.url }),
      new Client({ connectionString: ctx.url }),
    ];
    try {
      await Promise.all(clients.map((c) => c.connect()));
      // Both sessions actually start the RPC before either result is awaited.
      return await Promise.all(clients.map((c) => c.query(sql, args)));
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  };
  const refused = async (label: string, sql: string, args: unknown[], expected: RegExp) => {
    try {
      await db.query(sql, args);
      check(label, false, 'unexpected success');
    } catch (error) {
      check(label, error instanceof Error && expected.test(error.message));
    }
  };
  const auditCount = (id: string) =>
    count('select count(*)::int n from public.audit_events where entity_id=$1', [id]);
  const markerCount = (request: string) =>
    count('select count(*)::int n from private.mutation_requests where request_id=$1', [request]);

  const paymentSql = 'select public.record_card_payment_once($1,$2,$3,$4,$5,$6,$7,$8,$9) id';
  const paymentKey = randomUUID();
  const paymentArgs = [
    paymentKey,
    sale,
    '100.00',
    'installment',
    'cash',
    null,
    'QA retry',
    null,
    actor,
  ];
  const payResults = await concurrent(paymentSql, paymentArgs);
  const payment = String(payResults[0]!.rows[0]!.id);
  check(
    'concurrent reference-less payment returns the original ID',
    payment === payResults[1]!.rows[0]!.id,
  );
  check(
    'concurrent payment creates exactly one row',
    (await count('select count(*)::int n from public.payments where sale_id=$1', [sale])) === 1,
  );
  check('concurrent payment creates one audit', (await auditCount(payment)) === 1);
  check('concurrent payment registers one durable result', (await markerCount(paymentKey)) === 1);
  check(
    'retry after commit returns original payment',
    (await db.query(paymentSql, paymentArgs)).rows[0]!.id === payment,
  );
  check('payment retry leaves audit unchanged', (await auditCount(payment)) === 1);
  const normalizedArgs = [...paymentArgs];
  normalizedArgs[2] = '100';
  normalizedArgs[5] = ' ';
  normalizedArgs[6] = ' QA retry ';
  check(
    'normalized money and optional blanks share payment result',
    (await db.query(paymentSql, normalizedArgs)).rows[0]!.id === payment,
  );
  const changedPayment = [...paymentArgs];
  changedPayment[2] = '200.00';
  await refused(
    'changed payment amount refuses same request',
    paymentSql,
    changedPayment,
    /MUTATION_PAYLOAD_CONFLICT/,
  );
  const newPaymentArgs = [...paymentArgs];
  newPaymentArgs[0] = randomUUID();
  check(
    'new intentional identical payment gets new ID',
    (await db.query(paymentSql, newPaymentArgs)).rows[0]!.id !== payment,
  );
  check(
    'new reference-less payment is allowed',
    (await count('select count(*)::int n from public.payments where sale_id=$1', [sale])) === 2,
  );
  const referenceArgs = [...paymentArgs];
  referenceArgs[0] = randomUUID();
  referenceArgs[5] = 'QA-REFERENCE';
  await db.query(paymentSql, referenceArgs);
  const failedRefKey = randomUUID();
  referenceArgs[0] = failedRefKey;
  await refused(
    'same-sale nonblank reference remains unique',
    paymentSql,
    referenceArgs,
    /payments_sale_reference_unique/,
  );
  check(
    'failed reference insert leaves no request marker',
    (await markerCount(failedRefKey)) === 0,
  );
  const failPayment = [...paymentArgs];
  failPayment[0] = randomUUID();
  failPayment[2] = '-1.00';
  await refused(
    'invalid payment rolls back business write',
    paymentSql,
    failPayment,
    /INVALID_AMOUNT|AMOUNT|check constraint/i,
  );
  check(
    'failed payment leaves no completed request',
    (await markerCount(String(failPayment[0]))) === 0,
  );
  failPayment[2] = '100.00';
  check(
    'retry after rollback succeeds with same key',
    !!(await db.query(paymentSql, failPayment)).rows[0]!.id,
  );
  const deniedPayment = [...paymentArgs];
  deniedPayment[0] = randomUUID();
  deniedPayment[8] = employee;
  await refused(
    'request UUID does not authorize employee payment',
    paymentSql,
    deniedPayment,
    /MUTATION_FORBIDDEN/,
  );
  check('denied actor gets no request marker', (await markerCount(String(deniedPayment[0]))) === 0);

  const header = {
    customerId: customer,
    planId: gold.id,
    paymentScheme: 'spot_cash',
    acquisitionChannels: [],
    consentAcknowledged: false,
    acknowledgedAt: '2026-10-01',
    primarySignatureStatus: 'pending',
    validIdReceived: false,
    reservationPaymentProofReceived: false,
  };
  const primary = {
    firstName: 'RETRY',
    lastName: 'TEST',
    birthDate: '1990-01-01',
    permanentAddressLine1: '1 QA Street',
    cityMunicipality: 'Calamba',
    province: 'Laguna',
    mobile: '09170000001',
    email: `${ctx.run}-holder@example.invalid`,
    printedName: 'RETRY TEST',
  };
  const appSql = 'select public.create_customer_application_once($1,$2,$3,$4,$5) id';
  const appKey = randomUUID();
  const appArgs = [appKey, actor, JSON.stringify(header), JSON.stringify(primary), null];
  const apps = await concurrent(appSql, appArgs);
  const application = String(apps[0]!.rows[0]!.id);
  check('concurrent application returns one ID', application === apps[1]!.rows[0]!.id);
  check(
    'concurrent application creates one row',
    (await count('select count(*)::int n from public.customer_applications where customer_id=$1', [
      customer,
    ])) === 1,
  );
  check(
    'application creates one audit and request',
    (await auditCount(application)) === 1 && (await markerCount(appKey)) === 1,
  );
  check(
    'application retry after commit returns original',
    (await db.query(appSql, appArgs)).rows[0]!.id === application,
  );
  await refused(
    'changed application plan refuses same key',
    appSql,
    [
      appKey,
      actor,
      JSON.stringify({ ...header, planId: silver.id }),
      JSON.stringify(primary),
      null,
    ],
    /MUTATION_PAYLOAD_CONFLICT/,
  );
  check(
    'new intentional application creates distinct row',
    (await db.query(appSql, [randomUUID(), ...appArgs.slice(1)])).rows[0]!.id !== application,
  );
  const badAppKey = randomUUID();
  await refused(
    'application failure rolls back registration',
    appSql,
    [
      badAppKey,
      actor,
      JSON.stringify({ ...header, planId: randomUUID() }),
      JSON.stringify(primary),
      null,
    ],
    /PLAN_NOT_FOUND/,
  );
  check('failed application leaves no marker', (await markerCount(badAppKey)) === 0);
  const partialAppKey = randomUUID();
  const appRowsBefore = await count(
    'select count(*)::int n from public.customer_applications where customer_id=$1',
    [customer],
  );
  await refused(
    'holder failure rolls back already-inserted application header',
    appSql,
    [
      partialAppKey,
      actor,
      JSON.stringify(header),
      JSON.stringify({ ...primary, firstName: null }),
      null,
    ],
    /not-null constraint/,
  );
  check(
    'partial application failure leaves no header or marker',
    (await markerCount(partialAppKey)) === 0 &&
      (await count(
        'select count(*)::int n from public.customer_applications where customer_id=$1',
        [customer],
      )) === appRowsBefore,
  );

  const input = {
    saleId: sale,
    reservationDate: '2026-10-01',
    agreementDate: '2026-10-01',
    primarySignatureStatus: 'pending',
    vipTier: 'GOLD',
  };
  const resPrimary = {
    name: 'RETRY TEST',
    address: '1 QA Street',
    contactNumber: '09170000001',
    email: `${ctx.run}-reservation@example.invalid`,
  };
  const resSql = 'select public.create_reservation_agreement_once($1,$2,$3,$4,$5,$6) id';
  const resKey = randomUUID();
  const resArgs = [resKey, actor, JSON.stringify(input), JSON.stringify(resPrimary), null, '[]'];
  const reservations = await concurrent(resSql, resArgs);
  const reservation = String(reservations[0]!.rows[0]!.id);
  check('concurrent reservation returns one ID', reservation === reservations[1]!.rows[0]!.id);
  check(
    'concurrent reservation creates one row',
    (await count('select count(*)::int n from public.reservation_agreements where sale_id=$1', [
      sale,
    ])) === 1,
  );
  check(
    'reservation creates one audit and request',
    (await auditCount(reservation)) === 1 && (await markerCount(resKey)) === 1,
  );
  check(
    'reservation retry returns original after commit',
    (await db.query(resSql, resArgs)).rows[0]!.id === reservation,
  );
  await refused(
    'changed reservation tier refuses same key',
    resSql,
    [resKey, actor, JSON.stringify({ ...input, vipTier: 'SILVER' }), ...resArgs.slice(3)],
    /MUTATION_PAYLOAD_CONFLICT/,
  );
  const duplicateResKey = randomUUID();
  await refused(
    'new token preserves one-reservation-per-sale rule',
    resSql,
    [duplicateResKey, ...resArgs.slice(1)],
    /reservation_agreements_sale_id_key/,
  );
  check('business uniqueness refusal leaves no marker', (await markerCount(duplicateResKey)) === 0);
  const laterCustomer = randomUUID();
  const laterSale = randomUUID();
  await db.query(
    `insert into public.customers(id,customer_number,first_name,last_name,birth_date,email,phone,status,created_by)
    select $1,customer_number,'LATER','TEST','1990-01-01',$2,'09175550001','prospect',$3 from public.next_customer_number()`,
    [laterCustomer, `${ctx.run}-idempotency-later@example.invalid`, actor],
  );
  ctx.createdCustomers.push(laterCustomer);
  await db.query(
    `insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,
    cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,
    commission_rate_snapshot,expected_commission_snapshot,status,submitted_at,balance_due_at)
    select $1,n.sale_number,$2,s.plan_id,s.seller_type,s.seller_staff_id,s.cash_price,s.cash_price_snapshot,
    s.minimum_down_payment_snapshot,s.yearly_points_snapshot,s.commission_rate_snapshot,s.expected_commission_snapshot,
    'submitted',now(),now()+interval '365 days' from public.card_sales s cross join public.next_sale_number() n where s.id=$3`,
    [laterSale, laterCustomer, sale],
  );
  const badResKey = randomUUID();
  await refused(
    'reservation failure rolls back registration',
    resSql,
    [
      badResKey,
      actor,
      JSON.stringify({ ...input, primarySignatureStatus: 'INVALID' }),
      ...resArgs.slice(3),
    ],
    /check constraint/,
  );
  check('failed reservation leaves no marker', (await markerCount(badResKey)) === 0);

  const older = randomUUID();
  const newest = randomUUID();
  for (const [id, age] of [
    [older, 2],
    [newest, 1],
  ] as const) {
    await db.query(
      `insert into public.identity_documents(id,subject_type,customer_id,storage_path,original_filename,
      mime_type,size_bytes,sha256,uploaded_by,created_at) values($1,'customer',$2,$3,'qa.png','image/png',100,$4,$5,now()-($6::int * interval '1 minute'))`,
      [id, customer, `qa/${id}.png`, 'a'.repeat(64), actor, age],
    );
  }
  const reviewSql = 'select public.review_identity_document($1,$2,$3,$4,$5,$6) result';
  const reviewArgs = [
    newest,
    actor,
    'confirmed',
    JSON.stringify({ name: ' RETRY TEST ', idType: 'Philippine ID' }),
    ' QA review ',
    null,
  ];
  const reviews = await concurrent(reviewSql, reviewArgs);
  check(
    'concurrent ID reviews agree on current document',
    reviews.every((r) => r.rows[0]!.result.isCurrent === true),
  );
  check('concurrent ID review makes one transition audit', (await auditCount(newest)) === 1);
  const before = (
    await db.query('select reviewed_at,reviewed_data from public.identity_documents where id=$1', [
      newest,
    ])
  ).rows[0]!;
  await db.query(reviewSql, reviewArgs);
  const after = (
    await db.query('select reviewed_at,reviewed_data from public.identity_documents where id=$1', [
      newest,
    ])
  ).rows[0]!;
  check(
    'identical ID retry preserves timestamps and data',
    JSON.stringify(before) === JSON.stringify(after),
  );
  check('identical ID retry preserves audit count', (await auditCount(newest)) === 1);
  const olderResult = (
    await db.query(reviewSql, [older, actor, 'confirmed', '{"name":"RETRY TEST"}', null, null])
  ).rows[0]!.result;
  check('older confirmation does not steal current ID', olderResult.isCurrent === false);
  const rejectArgs = [...reviewArgs];
  rejectArgs[2] = 'rejected';
  const rejected = (await concurrent(reviewSql, rejectArgs))[0]!.rows[0]!.result;
  check('rejected newest ID is not current', rejected.isCurrent === false);
  check('concurrent meaningful rejection adds one audit', (await auditCount(newest)) === 2);
  check(
    'rejected-current handoff selects older document',
    (await db.query(reviewSql, [older, actor, 'confirmed', '{"name":"RETRY TEST"}', null, null]))
      .rows[0]!.result.isCurrent === true,
  );
  rejectArgs[4] = 'A different later review';
  await db.query(reviewSql, rejectArgs);
  check('meaningfully changed review notes add audit', (await auditCount(newest)) === 3);
  await refused(
    'employee cannot review with request metadata',
    reviewSql,
    [newest, employee, ...reviewArgs.slice(2)],
    /MUTATION_FORBIDDEN/,
  );
  await refused(
    'unrelated seller cannot review another subject',
    reviewSql,
    [newest, seller, ...reviewArgs.slice(2)],
    /MUTATION_FORBIDDEN/,
  );
  const failedDocument = randomUUID();
  await refused(
    'nonexistent document never returns success',
    reviewSql,
    [failedDocument, actor, ...reviewArgs.slice(2)],
    /DOCUMENT_NOT_FOUND/,
  );

  // An audit failure AFTER the business write must roll back the whole RPC.
  // This temporary fault injector exists only in this disposable database.
  const stateBeforeFault = (
    await db.query(
      'select verification_status,reviewed_at,reviewed_data from public.identity_documents where id=$1',
      [older],
    )
  ).rows[0]!;
  await db.query(`create function public.__test_idempotency_audit_failure() returns trigger language plpgsql as $$
    begin if new.action in ('PAYMENT_RECORDED','CUSTOMER_APPLICATION_CREATED','RESERVATION_AGREEMENT_CREATED','IDENTITY_DOCUMENT_REJECTED') then
      raise exception 'QA_AUDIT_FAILURE'; end if; return new; end $$;
    create trigger __test_idempotency_audit_failure before insert on public.audit_events for each row execute function public.__test_idempotency_audit_failure()`);
  try {
    const failedPayKey = randomUUID();
    const failedAppKey = randomUUID();
    const failedReservationKey = randomUUID();
    const paymentRows = await count(
      'select count(*)::int n from public.payments where sale_id=$1',
      [sale],
    );
    const applicationRows = await count(
      'select count(*)::int n from public.customer_applications where customer_id=$1',
      [customer],
    );
    await refused(
      'payment audit failure rolls back transaction',
      paymentSql,
      [failedPayKey, ...paymentArgs.slice(1)],
      /QA_AUDIT_FAILURE/,
    );
    check(
      'failed payment audit leaves no payment or request',
      (await markerCount(failedPayKey)) === 0 &&
        (await count('select count(*)::int n from public.payments where sale_id=$1', [sale])) ===
          paymentRows,
    );
    await refused(
      'application audit failure rolls back transaction',
      appSql,
      [failedAppKey, ...appArgs.slice(1)],
      /QA_AUDIT_FAILURE/,
    );
    check(
      'failed application audit leaves no application or request',
      (await markerCount(failedAppKey)) === 0 &&
        (await count(
          'select count(*)::int n from public.customer_applications where customer_id=$1',
          [customer],
        )) === applicationRows,
    );
    await refused(
      'reservation audit failure rolls back transaction',
      resSql,
      [
        failedReservationKey,
        actor,
        JSON.stringify({ ...input, saleId: laterSale }),
        ...resArgs.slice(3),
      ],
      /QA_AUDIT_FAILURE/,
    );
    check(
      'failed reservation audit leaves no reservation or request',
      (await markerCount(failedReservationKey)) === 0 &&
        (await count('select count(*)::int n from public.reservation_agreements where sale_id=$1', [
          laterSale,
        ])) === 0,
    );
    await refused(
      'ID audit failure rolls back document decision',
      reviewSql,
      [older, actor, 'rejected', '{"name":"RETRY TEST"}', null, null],
      /QA_AUDIT_FAILURE/,
    );
    check(
      'ID audit failure preserves prior state and timestamp',
      JSON.stringify(
        (
          await db.query(
            'select verification_status,reviewed_at,reviewed_data from public.identity_documents where id=$1',
            [older],
          )
        ).rows[0]!,
      ) === JSON.stringify(stateBeforeFault),
    );
  } finally {
    await db.query(
      'drop trigger __test_idempotency_audit_failure on public.audit_events; drop function public.__test_idempotency_audit_failure()',
    );
  }
  check(
    'new legitimate reservation creates distinct row',
    (
      await db.query(resSql, [
        randomUUID(),
        actor,
        JSON.stringify({ ...input, saleId: laterSale }),
        ...resArgs.slice(3),
      ])
    ).rows[0]!.id !== reservation,
  );

  const replacement = randomUUID();
  const foreignDoc = randomUUID();
  for (const [id, parent] of [
    [replacement, customer],
    [foreignDoc, laterCustomer],
  ] as const)
    await db.query(
      `insert into public.identity_documents(id,subject_type,customer_id,storage_path,original_filename,mime_type,size_bytes,sha256,uploaded_by)
      values($1,'customer',$2,$3,'qa.png','image/png',100,$4,$5)`,
      [id, parent, `qa/${id}.png`, 'b'.repeat(64), actor],
    );
  check(
    'explicit persisted replacement becomes current',
    (
      await db.query(reviewSql, [
        replacement,
        actor,
        'confirmed',
        '{"name":"RETRY TEST"}',
        null,
        null,
      ])
    ).rows[0]!.result.isCurrent === true,
  );
  check(
    'current-ID selection remains isolated from other subjects',
    (
      await db.query(reviewSql, [
        foreignDoc,
        actor,
        'confirmed',
        '{"name":"LATER TEST"}',
        null,
        null,
      ])
    ).rows[0]!.result.isCurrent === true,
  );
  check(
    'older ID stays noncurrent after replacement',
    (await db.query(reviewSql, [older, actor, 'confirmed', '{"name":"RETRY TEST"}', null, null]))
      .rows[0]!.result.isCurrent === false,
  );

  for (const role of ['anon', 'authenticated', 'service_role']) {
    await db.query(`set role ${role}`);
    try {
      await refused(
        `${role} has no direct request-table access`,
        'select * from private.mutation_requests',
        [],
        /permission denied/,
      );
    } finally {
      await db.query('reset role');
    }
  }
  for (const role of ['anon', 'authenticated']) {
    await db.query(`set role ${role}`);
    try {
      for (const [name, sql, args] of [
        ['payment', paymentSql, paymentArgs],
        ['application', appSql, appArgs],
        ['reservation', resSql, resArgs],
        ['review', reviewSql, reviewArgs],
      ] as const)
        await refused(`${role} cannot execute ${name} RPC`, sql, args, /permission denied/);
    } finally {
      await db.query('reset role');
    }
  }
  await db.query('set role service_role');
  try {
    check(
      'service role executes only public payment wrapper',
      (await db.query(paymentSql, paymentArgs)).rows[0]!.id === payment,
    );
  } finally {
    await db.query('reset role');
  }
  check(
    'all stored fingerprints are SHA256 and results nonnull',
    (await count(
      "select count(*)::int n from private.mutation_requests where payload_hash !~ '^[0-9a-f]{64}$' or result_identifier is null",
    )) === 0,
  );
  const audits = await db.query(readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
  check(
    'post-idempotency RLS/private ACL audit has zero violations',
    (Array.isArray(audits) ? audits : [audits]).every((r) => r.rows.length === 0),
  );
}
