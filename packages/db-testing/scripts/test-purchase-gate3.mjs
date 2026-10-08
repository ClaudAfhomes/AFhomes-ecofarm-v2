/** Gate 3 only: disposable baseline, legacy fixtures, draft migration and SQL probes. */
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDisposablePostgres, listMigrations } from './lib/local-postgres.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const migration = '20261101000001_afhomes_application_purchase_flow.sql';
const output = path.join(root, '.tmp-bin', 'purchase-gate3-evidence.json');
const evidence = {
  checks: [],
  failures: [],
  target: {},
  baseline: {},
  post: {},
  legacy: {},
  cleanup: {},
};
let postgres;
let db;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const check = (name, condition) => {
  evidence.checks.push({ name, ok: Boolean(condition) });
  console.log(`${condition ? 'PASS' : 'FAIL'} ${name}`);
  assert.ok(condition, name);
};
const denied = async (name, work, expected) => {
  await db.query('begin');
  let error;
  let phase = 'statement';
  try {
    await work();
    phase = 'COMMIT';
    await db.query('commit');
  } catch (cause) {
    error = cause;
  } finally {
    await db.query('rollback');
  }
  const result = { name, phase, code: error?.code, message: error?.message };
  evidence.failures.push(result);
  check(
    name,
    Boolean(error) &&
      expected.test(`${error.code} ${error.message}`) &&
      (!/at COMMIT/.test(name) || phase === 'COMMIT'),
  );
  console.log(`  ${error.code}: ${error.message}`);
};
const tables = [
  'auth.users',
  'public.staff_users',
  'public.staff_role_assignments',
  'public.roles',
  'public.customers',
  'public.card_sales',
  'public.payments',
  'public.memberships',
  'public.customer_applications',
  'public.reservation_agreements',
  'public.reservation_agreement_holders',
  'public.reservation_agreement_schedule',
  'private.mutation_requests',
  'public.audit_events',
];
const counts = async (names) => {
  const result = {};
  for (const t of names) result[t] = Number((await q('select count(*) n from ' + t))[0].n);
  return result;
};
const snapshot = async () => ({
  constraints:
    await q(`select n.nspname schema,c.relname table_name,con.conname,con.contype,con.condeferrable,con.condeferred,
    pg_get_constraintdef(con.oid) definition from pg_constraint con join pg_class c on c.oid=con.conrelid
    join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') order by 1,2,3`),
  indexes: await q(
    `select * from pg_indexes where schemaname in ('public','private') order by schemaname,tablename,indexname`,
  ),
  functions:
    await q(`select n.nspname schema,p.proname,pg_get_function_identity_arguments(p.oid) arguments,
    pg_get_function_result(p.oid) result,p.prosecdef,p.proconfig,p.proacl,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' order by 1,2,3`),
  grants: await q(
    `select * from information_schema.role_table_grants where table_schema in ('public','private') order by table_schema,table_name,grantee,privilege_type`,
  ),
  rls: await q(`select n.nspname schema,c.relname,c.relrowsecurity,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and c.relkind='r' order by 1,2`),
  policies: await q(
    `select * from pg_policies where schemaname in ('public','private') order by schemaname,tablename,policyname`,
  ),
  triggers:
    await q(`select n.nspname schema,c.relname,t.tgname,t.tgdeferrable,t.tginitdeferred,pg_get_triggerdef(t.oid) definition
    from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname in ('public','private') and not t.tgisinternal order by 1,2,3`),
});
const insert = async (table, value) => {
  const columns = Object.keys(value);
  return (
    await q(
      `insert into ${table} (${columns.join(',')}) values (${columns.map((_, i) => `$${i + 1}`).join(',')}) returning *`,
      Object.values(value),
    )
  )[0];
};
const uuid = () => randomUUID();
const hash = () => createHash('sha256').update(uuid()).digest('hex');
try {
  check(
    'migration version is uniquely occupied by the approved draft',
    listMigrations()
      .filter((f) => f.startsWith('20261101000001'))
      .join() === migration,
  );
  postgres = await startDisposablePostgres({ beforeMigration: migration });
  db = postgres.client;
  evidence.target = {
    host: '127.0.0.1',
    port: Number(new URL(postgres.url).port),
    database: postgres.database,
    pid: postgres.pid,
    dataDir: postgres.dataDir,
  };
  console.log(
    `TARGET host=127.0.0.1 port=${evidence.target.port} database=${postgres.database} pid=${postgres.pid}`,
  );
  check('target is disposable loopback', new URL(postgres.url).hostname === '127.0.0.1');
  evidence.baseline.migrations = postgres.applied;
  evidence.baseline.counts = await counts(tables);
  evidence.baseline.catalog = await snapshot();
  console.log(`BASELINE ${postgres.applied.length} migrations; latest=${postgres.applied.at(-1)}`);

  const actor = uuid();
  await insert('auth.users', { id: actor, email: `${actor}@gate3.invalid` });
  await insert('public.staff_users', {
    id: actor,
    email: `${actor}@gate3.invalid`,
    full_name: 'GATE THREE ACTOR',
    status: 'active',
  });
  const role = (
    await q(`insert into public.roles(slug,name,is_system,is_active) values('super_admin','Super Admin',true,true)
    on conflict(slug) do update set slug=excluded.slug returning id`)
  )[0].id;
  await insert('public.staff_role_assignments', { staff_id: actor, role_id: role });
  const alternateActor = uuid();
  await insert('auth.users', { id: alternateActor, email: alternateActor + '@gate3.invalid' });
  await insert('public.staff_users', {
    id: alternateActor,
    email: alternateActor + '@gate3.invalid',
    full_name: 'GATE THREE ALTERNATE',
    status: 'active',
  });
  const plan = (await q(`select * from public.card_plans where code='BRONZE'`))[0];
  check('baseline supplies Bronze plan', Boolean(plan));
  const customers = [];
  const sales = [];
  for (let i = 0; i < 4; i++) {
    const id = uuid();
    customers.push(
      await insert('public.customers', {
        id,
        customer_number: `G3-CUS-${id}`,
        first_name: 'GATE',
        last_name: 'THREE',
        email: `${id}@gate3.invalid`,
        phone: '+639171234567',
        status: i === 0 ? 'active' : 'prospect',
      }),
    );
    sales.push(
      await insert('public.card_sales', {
        id: uuid(),
        sale_number: `G3-SALE-${id}`,
        customer_id: id,
        plan_id: plan.id,
        seller_type: 'staff',
        seller_staff_id: actor,
        cash_price: '54000.00',
        cash_price_snapshot: '54000.00',
        yearly_points_snapshot: 60000,
        minimum_down_payment_snapshot: '10000.00',
        commission_rate_snapshot: '0',
        expected_commission_snapshot: '0.00',
        reservation_fee_snapshot: '10000.00',
        required_initial_snapshot: '10000.00',
        payment_scheme: 'spot_cash',
        balance_due_at: new Date('2027-01-01'),
        status: i === 0 ? 'active' : 'payment_pending',
        created_by: actor,
      }),
    );
  }
  const membership = await insert('public.memberships', {
    id: uuid(),
    customer_id: customers[0].id,
    sale_id: sales[0].id,
    membership_number: `G3-MEM-${uuid()}`,
    fallback_code_hash: hash(),
    qr_token_hash: hash(),
    status: 'active',
    activated_by: actor,
    expires_at: new Date('2033-10-07'),
    yearly_points_allocated: 60000,
  });
  const appValue = (customer, saleId = null) => ({
    id: uuid(),
    application_number: `G3-APP-${uuid()}`,
    customer_id: customer.id,
    sale_id: saleId,
    plan_id: plan.id,
    tier_snapshot: 'BRONZE',
    payment_scheme_snapshot: 'spot_cash',
    vip_amount_snapshot: '54000.00',
    discount_percent_snapshot: 5,
    validity_years_snapshot: 7,
    yearly_points_snapshot: 60000,
    annual_points_tranches_snapshot: 7,
    holder_limit_snapshot: 1,
    consent_acknowledged: true,
    acknowledged_at: '2026-10-07',
    primary_signature_status: 'received',
    status: 'approved',
    submitted_at: new Date(),
    approved_at: new Date(),
    created_by: actor,
  });
  const legacyApp = await insert(
    'public.customer_applications',
    appValue(customers[0], sales[0].id),
  );
  const app = await insert('public.customer_applications', appValue(customers[1]));
  const otherApp = await insert('public.customer_applications', appValue(customers[2]));
  const legacyReservationId = (
    await q(`select public.save_reservation_agreement(null,$1,$2,$3,null,'[]'::jsonb) id`, [
      actor,
      {
        saleId: sales[0].id,
        customerApplicationId: legacyApp.id,
        reservationDate: '2026-10-07',
        agreementDate: '2026-10-07',
        primarySignatureStatus: 'received',
      },
      {
        name: 'GATE THREE',
        address: 'SYNTHETIC ADDRESS',
        contactNumber: '+639171234567',
        email: 'gate3@gate3.invalid',
      },
    ])
  )[0].id;
  const legacyPaymentId = (
    await q(
      `select public.record_card_payment($1,'10000.00','down_payment','cash','G3-LEGACY',null,null,$2) id`,
      [sales[3].id, actor],
    )
  )[0].id;
  for (const operation of ['payment.create', 'application.create', 'reservation.create'])
    await q(`select private.complete_mutation($1,$2,$3,'{"fixture":true}'::jsonb,$4)`, [
      actor,
      operation,
      uuid(),
      legacyApp.id,
    ]);
  const legacyTables = [
    'public.card_sales',
    'public.payments',
    'public.memberships',
    'public.customer_applications',
    'public.reservation_agreements',
    'private.mutation_requests',
  ];
  const readLegacy = async () => {
    const result = {};
    for (const t of legacyTables)
      result[t] = await q('select to_jsonb(t) row from ' + t + ' t order by id');
    return result;
  };
  const before = await readLegacy();
  evidence.legacy.ids = {
    app: legacyApp.id,
    reservation: legacyReservationId,
    payment: legacyPaymentId,
    sales: sales.map((s) => s.id),
    membership: membership.id,
  };
  evidence.legacy.beforeCounts = await counts(legacyTables);
  const draft = fs.readFileSync(path.join(root, 'supabase/migrations', migration), 'utf8');
  await db.query('begin');
  try {
    await db.query(draft);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
  evidence.post.migrations = [...postgres.applied, migration];
  check('migration applies successfully on nonempty legacy baseline', true);
  const after = await readLegacy();
  for (const t of legacyTables) {
    const stripped = after[t].map(({ row }) => ({
      row: Object.fromEntries(Object.keys(before[t][0]?.row ?? {}).map((k) => [k, row[k]])),
    }));
    check(`legacy values preserved: ${t}`, JSON.stringify(stripped) === JSON.stringify(before[t]));
  }
  check(
    'legacy defaults preserve sale origins',
    (await q(`select origin from public.payments where id=$1`, [legacyPaymentId]))[0].origin ===
      'sale' &&
      (
        await q(`select origin from public.reservation_agreements where id=$1`, [
          legacyReservationId,
        ])
      )[0].origin === 'sale',
  );
  const firstCatalog = await snapshot();
  await db.query(draft);
  check(
    'reapply leaves catalogs identical',
    JSON.stringify(firstCatalog) === JSON.stringify(await snapshot()),
  );
  await denied(
    'incompatible named index drift rejected',
    async () => {
      await q('drop index public.payments_reservation_status_idx');
      await q('create index payments_reservation_status_idx on public.payments(sale_id,status)');
      await q(draft);
    },
    /55000.*PURCHASE_SCHEMA_DRIFT/,
  );
  evidence.post.catalog = await snapshot();
  const termValue = {
    id: uuid(),
    application_id: app.id,
    customer_id: app.customer_id,
    plan_id: plan.id,
    seller_staff_id: actor,
    version: 1,
    capture_kind: 'submission',
    captured_by: actor,
    tier: 'BRONZE',
    payment_scheme: 'spot_cash',
    total_price: '54000.00',
    reservation_fee: '10000.00',
    minimum_down_payment: '10000.00',
    required_initial: '10000.00',
    installment_months: null,
    monthly_amount: null,
    spot_cash_days: 7,
    validity_months: 84,
    discount_percent: 5,
    yearly_points: 60000,
    annual_points_tranches: 7,
    holder_limit: 1,
    inclusions: JSON.stringify(['VIP BENEFITS']),
    commission_rate: '0',
    commission_base: '54000.00',
    expected_commission: '0.00',
  };
  await denied(
    'captured terms customer must match actual application',
    () =>
      insert('public.customer_application_purchase_terms', {
        ...termValue,
        id: uuid(),
        application_id: otherApp.id,
        customer_id: customers[3].id,
      }),
    /23514.*APPLICATION_TERMS_IDENTITY_INVALID/,
  );
  const terms = await insert('public.customer_application_purchase_terms', termValue);
  await q('update public.customer_applications set purchase_terms_id=$1 where id=$2', [
    terms.id,
    app.id,
  ]);
  const legacyReservation = (
    await q('select * from public.reservation_agreements where id=$1', [legacyReservationId])
  )[0];
  const reservationValue = {
    ...legacyReservation,
    id: uuid(),
    reservation_number: `G3-RES-${uuid()}`,
    sale_id: null,
    origin: 'application',
    customer_application_id: app.id,
    customer_id: app.customer_id,
    seller_staff_id: actor,
    purchase_terms_id: terms.id,
    inclusions_snapshot: { items: ['VIP BENEFITS'] },
    total_price_snapshot: '54000.00',
    reservation_fee_snapshot: '10000.00',
    down_payment_snapshot: '10000.00',
    total_payment_received_snapshot: '0.00',
    balance_snapshot: '54000.00',
    required_initial_snapshot: '10000.00',
    minimum_down_payment_snapshot: '10000.00',
    monthly_amortization_snapshot: null,
    installment_months_snapshot: null,
    validity_years_snapshot: 7,
    validity_months_snapshot: 84,
    spot_cash_days_snapshot: 7,
    commission_rate_snapshot: '0',
    commission_base_snapshot: '54000.00',
    expected_commission_snapshot: '0.00',
    status: 'executed',
    submitted_at: new Date(),
    executed_at: new Date(),
    discount_percent_snapshot: 5,
    yearly_points_snapshot: 60000,
    annual_points_tranches_snapshot: 7,
    holder_limit_snapshot: 1,
  };
  const reservation = await insert('public.reservation_agreements', reservationValue);
  await insert('public.reservation_agreement_holders', {
    agreement_id: reservation.id,
    holder_type: 'PRIMARY',
    name: 'GATE THREE',
    address: 'SYNTHETIC ADDRESS',
    contact_number: '+639171234567',
    email: 'gate3@gate3.invalid',
  });
  await insert('public.reservation_agreement_schedule', {
    agreement_id: reservation.id,
    line_number: 1,
    particular: 'RESERVATION',
    amount_snapshot: '10000.00',
  });
  check(
    'application-origin reservation with no sale inserts and commits',
    reservation.sale_id === null,
  );
  const paymentValue = {
    id: uuid(),
    sale_id: null,
    origin: 'reservation',
    reservation_id: reservation.id,
    customer_id: app.customer_id,
    amount: '10000.00',
    method: 'cash',
    reference: 'G3-RES-PAY',
    payment_type: 'down_payment',
    recorded_by: actor,
    status: 'recorded',
  };
  const payment = await insert('public.payments', paymentValue);
  check('reservation payment with no sale inserts and commits', payment.sale_id === null);
  await denied(
    'neither-source payment rejected',
    () =>
      insert('public.payments', {
        ...paymentValue,
        id: uuid(),
        origin: 'sale',
        reservation_id: null,
        reference: null,
      }),
    /23514/,
  );
  await denied(
    'reservation payment requires reservation',
    () =>
      insert('public.payments', {
        ...paymentValue,
        id: uuid(),
        reservation_id: null,
        reference: null,
      }),
    /23514/,
  );
  await denied(
    'sale payment requires sale',
    () =>
      insert('public.payments', {
        ...paymentValue,
        id: uuid(),
        origin: 'sale',
        reservation_id: null,
        reference: null,
      }),
    /23514/,
  );
  await denied(
    'sale payment cannot also reference reservation',
    () =>
      insert('public.payments', {
        ...paymentValue,
        id: uuid(),
        origin: 'sale',
        sale_id: sales[2].id,
        reference: null,
      }),
    /23514/,
  );
  await denied(
    'unrelated payment sale fails at COMMIT',
    async () => {
      await insert('public.payments', {
        ...paymentValue,
        id: uuid(),
        sale_id: sales[2].id,
        reference: null,
      });
    },
    /23514|23503/,
  );
  await denied(
    'payment customer must equal reservation customer at COMMIT',
    () =>
      insert('public.payments', {
        ...paymentValue,
        id: uuid(),
        customer_id: otherApp.customer_id,
        reference: null,
      }),
    /23514/,
  );
  await denied(
    'reservation application/customer mismatch rejected',
    () =>
      insert('public.reservation_agreements', {
        ...reservationValue,
        id: uuid(),
        reservation_number: uuid(),
        customer_id: otherApp.customer_id,
      }),
    /23514/,
  );
  await denied(
    'reservation terms/application mismatch rejected',
    () =>
      insert('public.reservation_agreements', {
        ...reservationValue,
        id: uuid(),
        reservation_number: uuid(),
        customer_application_id: otherApp.id,
      }),
    /23514/,
  );
  await denied(
    'duplicate live application reservation rejected',
    () =>
      insert('public.reservation_agreements', {
        ...reservationValue,
        id: uuid(),
        reservation_number: uuid(),
      }),
    /23505/,
  );
  await denied(
    'duplicate reservation payment reference rejected',
    () => insert('public.payments', { ...paymentValue, id: uuid() }),
    /23505/,
  );
  await denied(
    'terms UPDATE rejected',
    () =>
      q(
        `update public.customer_application_purchase_terms set total_price='55000.00' where id=$1`,
        [terms.id],
      ),
    /55000.*PURCHASE_TERMS_IMMUTABLE/,
  );
  await denied(
    'terms DELETE rejected',
    () => q(`delete from public.customer_application_purchase_terms where id=$1`, [terms.id]),
    /55000.*PURCHASE_TERMS_IMMUTABLE/,
  );
  await denied(
    'duplicate terms version rejected',
    () => insert('public.customer_application_purchase_terms', { ...termValue, id: uuid() }),
    /23505/,
  );
  await denied(
    'review terms require reason',
    () =>
      insert('public.customer_application_purchase_terms', {
        ...termValue,
        id: uuid(),
        version: 2,
        capture_kind: 'review',
      }),
    /23514/,
  );
  const terms2 = await insert('public.customer_application_purchase_terms', {
    ...termValue,
    id: uuid(),
    version: 2,
    capture_kind: 'review',
    reason: 'EXPLICIT NEW OFFER',
  });
  await denied(
    'current terms pointer freezes application customer identity',
    () =>
      q('update public.customer_applications set customer_id=$1 where id=$2', [
        customers[3].id,
        app.id,
      ]),
    /23514.*APPLICATION_TERMS_IDENTITY_INVALID/,
  );
  await denied(
    'existing reservation freezes application terms pointer',
    () =>
      q('update public.customer_applications set purchase_terms_id=$1 where id=$2', [
        terms2.id,
        app.id,
      ]),
    /55000.*PURCHASE_TERMS_VERSION_FROZEN/,
  );
  await denied(
    'wrong application terms pointer rejected',
    () =>
      q('update public.customer_applications set purchase_terms_id=$1 where id=$2', [
        terms.id,
        otherApp.id,
      ]),
    /23503|23514/,
  );
  await denied(
    'reservation terms identity cannot change',
    () =>
      q('update public.reservation_agreements set purchase_terms_id=$1 where id=$2', [
        terms2.id,
        reservation.id,
      ]),
    /55000.*RESERVATION_TERMS_IMMUTABLE/,
  );
  const receiptRequest = uuid();
  await q(
    `select private.complete_purchase_mutation($1,'payment.verify',$2,'{"decision":"verified"}'::jsonb,$3,$4)`,
    [actor, receiptRequest, payment.id, { resultId: payment.id, status: 'verified' }],
  );
  check(
    'purchase result receipt stored',
    (
      await q('select result_receipt from private.mutation_requests where request_id=$1', [
        receiptRequest,
      ])
    )[0].result_receipt.status === 'verified',
  );
  await denied(
    'stored receipt immutable',
    () =>
      q(`update private.mutation_requests set result_receipt='{}' where request_id=$1`, [
        receiptRequest,
      ]),
    /55000.*MUTATION_RECEIPT_IMMUTABLE/,
  );
  await denied(
    'receipt unknown key injection rejected',
    () =>
      q(
        `select private.complete_purchase_mutation($1,'payment.verify',$2,'{}',$3,'{"governmentIdNumber":"FORBIDDEN"}')`,
        [actor, uuid(), payment.id],
      ),
    /22023.*MUTATION_RECEIPT_INVALID/,
  );
  await denied(
    'receipt cannot hide sensitive object under allowed status key',
    () =>
      q(`select private.complete_purchase_mutation($1,'payment.verify',$2,'{}',$3,$4)`, [
        actor,
        uuid(),
        payment.id,
        { resultId: payment.id, status: { governmentIdNumber: 'FORBIDDEN' } },
      ]),
    /22023.*MUTATION_RECEIPT_INVALID/,
  );
  const replay = (
    await q(`select private.mutation_result($1,'payment.verify',$2,'{"decision":"verified"}') id`, [
      actor,
      receiptRequest,
    ])
  )[0].id;
  check('existing mutation_result returns new operation result', replay === payment.id);
  await denied(
    'changed fingerprint still conflicts',
    () =>
      q(`select private.mutation_result($1,'payment.verify',$2,'{"decision":"rejected"}')`, [
        actor,
        receiptRequest,
      ]),
    /IDEMPOTENCY.*CONFLICT|REQUEST.*CONFLICT|CONFLICT/,
  );

  const recordedDoc = (
    await q(`select private.append_purchase_document('payment_recorded',$1,1,$2) id`, [
      payment.id,
      actor,
    ])
  )[0].id;
  const reservationDoc = (
    await q(`select private.append_purchase_document('reservation',$1,1,$2) id`, [
      reservation.id,
      actor,
    ])
  )[0].id;
  check(
    'field-by-field reservation and recorded evidence generated',
    Boolean(recordedDoc && reservationDoc),
  );
  for (const secret of [
    'governmentIdNumber',
    'qrToken',
    'onboardingToken',
    'tokenHash',
    'privateStorageUrl',
    'extra',
  ]) {
    await denied(
      `document key ${secret} rejected`,
      () =>
        q(
          `insert into private.purchase_document_evidence(kind,payment_id,revision,actor_id,fields)
      select kind,payment_id,99,actor_id,fields||jsonb_build_object($2::text,'FORBIDDEN') from private.purchase_document_evidence where id=$1`,
          [recordedDoc, secret],
        ),
      /23514/,
    );
  }
  await denied(
    'nested schedule injection rejected',
    () =>
      q(
        `insert into private.purchase_document_evidence(kind,reservation_id,revision,actor_id,fields)
    select kind,reservation_id,99,actor_id,jsonb_set(fields,'{schedule,0,privateStorageUrl}','"FORBIDDEN"') from private.purchase_document_evidence where id=$1`,
        [reservationDoc],
      ),
    /23514/,
  );
  await denied(
    'evidence UPDATE rejected',
    () => q('update private.purchase_document_evidence set revision=8 where id=$1', [recordedDoc]),
    /55000.*PURCHASE_DOCUMENT_IMMUTABLE/,
  );
  await denied(
    'evidence DELETE rejected',
    () => q('delete from private.purchase_document_evidence where id=$1', [recordedDoc]),
    /55000.*PURCHASE_DOCUMENT_IMMUTABLE/,
  );
  await denied(
    'evidence duplicate revision rejected',
    () =>
      q(
        `insert into private.purchase_document_evidence(kind,payment_id,revision,actor_id,fields)
    select kind,payment_id,revision,actor_id,fields from private.purchase_document_evidence where id=$1`,
        [recordedDoc],
      ),
    /23505/,
  );
  await denied(
    'document wrong source kind rejected',
    () =>
      q(
        `insert into private.purchase_document_evidence(kind,reservation_id,revision,actor_id,fields)
    select kind,$2,99,actor_id,fields from private.purchase_document_evidence where id=$1`,
        [recordedDoc, reservation.id],
      ),
    /23514/,
  );
  await denied(
    'document missing source FK rejected',
    () =>
      q(
        `insert into private.purchase_document_evidence(kind,payment_id,revision,actor_id,fields)
    select kind,$2,99,actor_id,fields from private.purchase_document_evidence where id=$1`,
        [recordedDoc, uuid()],
      ),
    /23503/,
  );

  await q(
    "update public.payments set status='verified',verified_by=$1,verified_at=now() where id=$2",
    [actor, payment.id],
  );
  const verifiedDoc = (
    await q("select private.append_purchase_document('payment_verified',$1,1,$2) id", [
      payment.id,
      actor,
    ])
  )[0].id;
  const verifiedFields = (
    await q('select fields from private.purchase_document_evidence where id=$1', [verifiedDoc])
  )[0].fields;
  check(
    'verified receipt freezes 10000 paid and 44000 remaining',
    verifiedFields.verifiedAfter === '10000.00' && verifiedFields.balanceAfter === '44000.00',
  );
  const balancePayment = await insert('public.payments', {
    ...paymentValue,
    id: uuid(),
    amount: '44000.00',
    reference: 'G3-BALANCE',
  });
  await q(
    "update public.payments set status='verified',verified_by=$1,verified_at=now() where id=$2",
    [actor, balancePayment.id],
  );
  const paymentCount = Number((await q('select count(*) n from public.payments'))[0].n);
  await denied(
    'invalid final linked sale fails at COMMIT',
    async () => {
      await q(
        'update public.reservation_agreements set sale_id=$1,finalized_by=$2,finalized_at=now() where id=$3',
        [sales[2].id, actor, reservation.id],
      );
      await q('update public.payments set sale_id=$1 where reservation_id=$2', [
        sales[2].id,
        reservation.id,
      ]);
    },
    /23514.*RESERVATION_SALE_SOURCE_INVALID/,
  );
  await db.query('begin');
  await q('update public.payments set sale_id=$1 where reservation_id=$2', [
    sales[1].id,
    reservation.id,
  ]);
  check(
    'temporary mismatched payment accepted before COMMIT',
    (await q('select sale_id from public.payments where id=$1', [payment.id]))[0].sale_id ===
      sales[1].id,
  );
  await q('update public.customer_applications set sale_id=$1 where id=$2', [sales[1].id, app.id]);
  await q(
    'update public.reservation_agreements set sale_id=$1,finalized_by=$2,finalized_at=now() where id=$3',
    [sales[1].id, actor, reservation.id],
  );
  await db.query('commit');
  check(
    'valid intermediate state reconciles at real COMMIT',
    (await q('select sale_id from public.payments where id=$1', [payment.id]))[0].sale_id ===
      sales[1].id,
  );
  check(
    'same payment UUID linked without duplication',
    Number((await q('select count(*) n from public.payments'))[0].n) === paymentCount,
  );
  await denied(
    'final purchase builder refuses unpaid/nonverified sale state',
    () =>
      q(`select private.append_purchase_document('purchase_finalized',$1,1,$2)`, [
        sales[1].id,
        actor,
      ]),
    /55000.*PURCHASE_DOCUMENT_STATE_CONFLICT/,
  );
  await denied(
    'finalized reservation sale cannot be reassigned',
    () =>
      q('update public.reservation_agreements set sale_id=$1 where id=$2', [
        sales[2].id,
        reservation.id,
      ]),
    /55000.*RESERVATION_SALE_IMMUTABLE/,
  );
  await denied(
    'linked payment sale cannot be reassigned',
    () => q('update public.payments set sale_id=$1 where id=$2', [sales[2].id, payment.id]),
    /55000.*PAYMENT_SOURCE_IMMUTABLE/,
  );
  await denied(
    'application cannot diverge from finalized sale at COMMIT',
    () => q('update public.customer_applications set sale_id=null where id=$1', [app.id]),
    /23514.*RESERVATION_SALE_SOURCE_INVALID/,
  );
  await denied(
    'sale cannot diverge from frozen seller at COMMIT',
    () =>
      q('update public.card_sales set seller_staff_id=$1 where id=$2', [
        alternateActor,
        sales[1].id,
      ]),
    /23514.*RESERVATION_SALE_SOURCE_INVALID/,
  );

  await q(
    "update public.card_sales set status='payment_verified',payment_verified_at=now(),fully_paid_at=now() where id=$1",
    [sales[1].id],
  );
  const finalDoc = (
    await q("select private.append_purchase_document('purchase_finalized',$1,1,$2) id", [
      sales[1].id,
      actor,
    ])
  )[0].id;
  const finalFields = (
    await q('select fields from private.purchase_document_evidence where id=$1', [finalDoc])
  )[0].fields;
  check(
    'final purchase evidence freezes full payment and contributing numbers',
    finalFields.verifiedTotal === '54000.00' &&
      finalFields.remainingBalance === '0.00' &&
      finalFields.paymentNumbers.length === 2,
  );
  await insert('public.memberships', {
    id: uuid(),
    customer_id: customers[1].id,
    sale_id: sales[1].id,
    membership_number: 'G3-MEM-' + uuid(),
    fallback_code_hash: hash(),
    qr_token_hash: hash(),
    status: 'active',
    activated_by: actor,
    expires_at: new Date('2033-10-07'),
    yearly_points_allocated: 60000,
  });
  await q("update public.card_sales set status='active',activated_at=now() where id=$1", [
    sales[1].id,
  ]);
  const newMembership = (
    await q('select id from public.memberships where sale_id=$1', [sales[1].id])
  )[0].id;
  await q("select private.append_purchase_document('membership_activated',$1,1,$2)", [
    newMembership,
    actor,
  ]);
  check(
    'all five document kinds construct on PostgreSQL',
    Number(
      (await q('select count(distinct kind) n from private.purchase_document_evidence'))[0].n,
    ) === 5,
  );
  await denied(
    'append refuses recomputed historical receipt revision',
    () =>
      q("select private.append_purchase_document('payment_verified',$1,1,$2)", [payment.id, actor]),
    /55000.*PURCHASE_DOCUMENT_VERSION_CONFLICT/,
  );
  check(
    'historical verified receipt stays unchanged after sale/activation progression',
    JSON.stringify(
      (
        await q('select fields from private.purchase_document_evidence where id=$1', [verifiedDoc])
      )[0].fields,
    ) === JSON.stringify(verifiedFields),
  );
  const { runPurchaseFlowCatalogChecks } =
    await import('../../../supabase/purchase-flow-integration.ts');
  await runPurchaseFlowCatalogChecks(db);
  check('typed purchase-flow catalog checks executed', true);
  for (const b of evidence.baseline.catalog.constraints.filter(
    (c) =>
      ![
        'mutation_requests_operation_check',
        'payments_sale_id_not_null',
        'reservation_agreements_sale_id_not_null',
      ].includes(c.conname),
  ))
    check(
      'preserved baseline constraint: ' + b.table_name + '.' + b.conname,
      evidence.post.catalog.constraints.some((c) => JSON.stringify(c) === JSON.stringify(b)),
    );
  for (const b of evidence.baseline.catalog.indexes)
    check(
      'preserved baseline index: ' + b.indexname,
      evidence.post.catalog.indexes.some((c) => JSON.stringify(c) === JSON.stringify(b)),
    );
  for (const roleName of ['anon', 'authenticated', 'service_role']) {
    await denied(
      `${roleName} cannot append evidence`,
      async () => {
        await q(`set local role ${roleName}`);
        await q(`select private.append_purchase_document('reservation',$1,2,$2)`, [
          reservation.id,
          actor,
        ]);
      },
      /42501/,
    );
    await denied(
      `${roleName} cannot write evidence table`,
      async () => {
        await q(`set local role ${roleName}`);
        await q(`delete from private.purchase_document_evidence where id=$1`, [recordedDoc]);
      },
      /42501/,
    );
    await denied(
      `${roleName} cannot change terms`,
      async () => {
        await q(`set local role ${roleName}`);
        await q(
          `update public.customer_application_purchase_terms set reason='CHANGED' where id=$1`,
          [terms.id],
        );
      },
      /42501/,
    );
  }
  const rlsResults = await db.query(
    fs.readFileSync(path.join(root, 'supabase/security/rls_invariants.sql'), 'utf8'),
  );
  const statements = Array.isArray(rlsResults) ? rlsResults : [rlsResults];
  check(
    'RLS invariants return zero violations',
    statements.every((r) => r.rows.length === 0),
  );
  const newFunctions = evidence.post.catalog.functions.filter(
    (f) =>
      !evidence.baseline.catalog.functions.some(
        (b) => b.schema === f.schema && b.proname === f.proname && b.arguments === f.arguments,
      ),
  );
  evidence.post.newFunctions = newFunctions;
  for (const f of newFunctions) {
    check(
      `search_path hardened: ${f.proname}`,
      f.proconfig?.some((c) => c.startsWith('search_path=pg_catalog,') && c.endsWith('pg_temp')),
    );
    const grants = (
      await q(
        `select has_function_privilege('anon',$1,'EXECUTE') anon,has_function_privilege('authenticated',$1,'EXECUTE') authenticated,
      has_function_privilege('service_role',$1,'EXECUTE') service from pg_proc where oid=$1::regprocedure`,
        [
          `${f.schema}.${f.proname}(${f.arguments.replace(/\b\w+ (?=(?:uuid|text|integer|jsonb|regclass)\b)/g, '')})`,
        ],
      )
    )[0];
    check(
      `new helper grants closed: ${f.proname}`,
      !grants.anon && !grants.authenticated && !grants.service,
    );
  }
  check(
    'document append has no JSON argument and exactly four parameters',
    newFunctions.find((f) => f.proname === 'append_purchase_document').arguments.split(',')
      .length === 4 &&
      !newFunctions
        .find((f) => f.proname === 'append_purchase_document')
        .arguments.includes('jsonb'),
  );
  for (const name of [
    'activate_card_sale',
    'verify_card_payment',
    'complete_mutation',
    'mutation_result',
  ])
    check(
      `legacy function unchanged: ${name}`,
      JSON.stringify(evidence.baseline.catalog.functions.filter((f) => f.proname === name)) ===
        JSON.stringify(evidence.post.catalog.functions.filter((f) => f.proname === name)),
    );
  const oldOps = ['payment.create', 'application.create', 'reservation.create'];
  const newOps = [
    'purchase_terms.review',
    'application.submit',
    'application.decide',
    'reservation.transition',
    'payment.verify',
    'reservation.finalize',
  ];
  for (const op of [...oldOps, ...newOps])
    await q(`select private.complete_mutation($1,$2,$3,'{}',$4)`, [actor, op, uuid(), app.id]);
  check('all old and new idempotency operations accepted', true);
  evidence.post.finalCounts = await counts([
    ...tables,
    'public.customer_application_purchase_terms',
    'private.purchase_document_evidence',
  ]);

  // Explicit owner-only cleanup restores *all* fixture rows, including append-only tables,
  // without granting any cleanup escape to browser/service roles.
  await db.query('begin');
  await q(`set local afhomes.allow_purchase_test_cleanup='on'`);
  await q(`delete from private.purchase_document_evidence`);
  await q(`delete from public.payments where origin='reservation'`);
  await q(`delete from public.reservation_agreement_holders where agreement_id=$1`, [
    reservation.id,
  ]);
  await q(`delete from public.reservation_agreement_schedule where agreement_id=$1`, [
    reservation.id,
  ]);
  await q(`delete from public.reservation_agreements where id=$1`, [reservation.id]);
  await q(`update public.customer_applications set purchase_terms_id=null where id=$1`, [app.id]);
  await q(`delete from public.customer_application_purchase_terms`);
  await q(`delete from private.mutation_requests where actor_id=$1`, [actor]);
  await q(`delete from public.reservation_agreement_holders where agreement_id=$1`, [
    legacyReservationId,
  ]);
  await q(`delete from public.reservation_agreement_schedule where agreement_id=$1`, [
    legacyReservationId,
  ]);
  await q(`delete from public.reservation_agreements where id=$1`, [legacyReservationId]);
  await q(`delete from public.customer_applications where created_by=$1`, [actor]);
  // Existing audit history is append-only. Its established owner cleanup guard is
  // used only on this disposable server by the baseline suite; inspect it first.
  await q(`delete from public.memberships where activated_by=$1`, [actor]);
  await q(`delete from public.payments where recorded_by=$1`, [actor]);
  await q(`delete from public.card_sales where created_by=$1`, [actor]);
  for (const c of customers) await q('delete from public.customers where id=$1', [c.id]);
  await q('delete from public.staff_role_assignments where staff_id=$1', [actor]);
  await q(`delete from public.audit_events where actor_id=$1`, [actor]);
  await q('delete from public.staff_users where id=$1', [actor]);
  await q('delete from auth.users where id=$1', [actor]);
  await q('delete from public.staff_users where id=$1', [alternateActor]);
  await q('delete from auth.users where id=$1', [alternateActor]);
  await db.query('commit');
  evidence.cleanup.counts = await counts(tables);
  check(
    'every fixture table restored to pre-run count',
    JSON.stringify(evidence.cleanup.counts) === JSON.stringify(evidence.baseline.counts),
  );
  check(
    'new terms/evidence tables empty after cleanup',
    Number((await q('select count(*) n from public.customer_application_purchase_terms'))[0].n) ===
      0 &&
      Number((await q('select count(*) n from private.purchase_document_evidence'))[0].n) === 0,
  );
} catch (error) {
  evidence.error = { code: error.code, message: error.message };
  console.error(`GATE3 ERROR ${error.code ?? ''}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (postgres) {
    await db.query('rollback').catch(() => {});
    await postgres.stop();
    evidence.cleanup.dataDirectoryRemoved = !fs.existsSync(postgres.dataDir);
    console.log(
      `CLEANUP pid=${postgres.pid} dataDirectoryRemoved=${evidence.cleanup.dataDirectoryRemoved}`,
    );
  }
  fs.writeFileSync(output, JSON.stringify(evidence, null, 2));
  console.log(
    `GATE3 SUMMARY ${evidence.checks.filter((c) => c.ok).length}/${evidence.checks.length} checks; exit=${process.exitCode ?? 0}`,
  );
}

process.exit(evidence.error ? 1 : 0);
