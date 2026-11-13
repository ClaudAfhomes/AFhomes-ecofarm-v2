import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import pg from 'pg';
import net from 'node:net';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
import { makePurchaseFixtures } from '../../../supabase/reservation-purchase-integration.ts';
const file = '20261230000001_afhomes_official_ra_numbering.sql';
await new Promise<void>((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(Number(process.env.AFHOMES_TEST_PG_PORT ?? 55432), '127.0.0.1', () =>
    probe.close(() => resolve()),
  );
});
const postgres = await startDisposablePostgres({ excludedMigrations: [file] });
const db = postgres.client;
let checks = 0;
const check = (ok: unknown, message: string) => {
  assert.ok(ok, message);
  checks++;
};
const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
  await assert.rejects(work, pattern);
  checks++;
};
try {
  const actor = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    `${actor}@example.invalid`,
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'NUMBER TEST','active')",
    [actor, `${actor}@example.invalid`],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",
    [actor],
  );
  const fixture = await makePurchaseFixtures(db, {
    actor,
    tier: 'GOLD',
    createdCustomers: [],
    createdApplications: [],
  });
  const legacy = await fixture.reserved();
  const legacyNumber = (
    await db.query('select reservation_number from public.reservation_agreements where id=$1', [
      legacy.reservationId,
    ])
  ).rows[0].reservation_number;
  const annualA = await fixture.executed(),
    annualB = await fixture.executed();
  await db.query(
    "update public.reservation_agreements set reservation_number='2020-0001' where id=$1",
    [annualA.reservationId],
  );
  await db.query(
    "update public.reservation_agreements set reservation_number='2021-0001' where id=$1",
    [annualB.reservationId],
  );
  const customerIdBefore = (
    await db.query('select ra_number,customer_number from public.customers where id=$1', [
      legacy.customerId,
    ])
  ).rows[0];
  const historicalVip = '25010100999G1C01S';
  await db.query('update public.customers set vip_card_number=$1 where id=$2', [
    historicalVip,
    legacy.customerId,
  ]);
  const migration = readFileSync(`supabase/migrations/${file}`, 'utf8');
  await db.query("update public.reservation_agreements set reservation_number='2026-0001 ' where id=$1",[legacy.reservationId]);
  await rejects(()=>db.query(migration),/OFFICIAL_RA_HISTORY_FORMAT_CONFLICT/);
  await db.query('rollback');
  check((await db.query("select to_regclass('private.official_ra_year_counters') n")).rows[0].n===null,'failed history validation rolls back migration DDL');
  await db.query('update public.reservation_agreements set reservation_number=$1 where id=$2',[legacyNumber,legacy.reservationId]);
  await db.query(migration);
  check(
    (
      await db.query('select reservation_number from public.reservation_agreements where id=$1', [
        legacy.reservationId,
      ])
    ).rows[0].reservation_number === legacyNumber,
    'legacy AF-RES preserved',
  );
  check(
    (
      await db.query(
        'select last_issued from private.official_ra_year_counters where issue_year=2020',
      )
    ).rows[0].last_issued === 1,
    'historical RA high-water seeded',
  );
  assert.deepEqual(
    (
      await db.query('select ra_number,customer_number from public.customers where id=$1', [
        legacy.customerId,
      ])
    ).rows[0],
    customerIdBefore,
  );
  checks++;
  await rejects(
    () =>
      db.query("update public.customers set vip_card_number='25010100001G1C01S' where id=$1", [
        legacy.customerId,
      ]),
    /VIP_CARD_NUMBER_IMMUTABLE/,
  );
  const allocate = (client: pg.Client, id: string, date: string) =>
    client
      .query('select private.allocate_official_ra($1,$2) n', [id, date])
      .then((r) => r.rows[0].n);
  const first = randomUUID();
  check((await allocate(db, first, '2040-12-31T15:59:00Z')) === '2040-0001', 'first yearly RA');
  check(
    (await allocate(db, randomUUID(), '2040-12-31T15:59:00Z')) === '2040-0002',
    'sequential RA',
  );
  check(
    (await allocate(db, randomUUID(), '2040-12-31T16:00:00Z')) === '2041-0001',
    'Manila year boundary',
  );
  check(
    (await allocate(db, first, '2042-01-01T00:00:00Z')) === '2040-0001',
    'retry retains original issue year',
  );
  const uri = new URL(postgres.url);
  assert.equal(uri.hostname, '127.0.0.1');
  const clients = await Promise.all(
    Array.from({ length: 8 }, async () => {
      const c = new pg.Client({ connectionString: postgres.url });
      await c.connect();
      return c;
    }),
  );
  try {
    const numbers = await Promise.all(
      clients.map((c) => allocate(c, randomUUID(), '2043-01-01T00:00:00Z')),
    );
    check(new Set(numbers).size === 8, 'concurrent allocations unique');
    check(
      numbers.sort().join(',') ===
        Array.from({ length: 8 }, (_, i) => `2043-${String(i + 1).padStart(4, '0')}`).join(','),
      'concurrent contiguous high water',
    );
    const retryId = randomUUID();
    const replay = await Promise.all(
      clients.map((c) => allocate(c, retryId, '2044-01-01T00:00:00Z')),
    );
    check(new Set(replay).size === 1, 'concurrent same-identity retries allocate once');
  } finally {
    await Promise.all(clients.map((c) => c.end()));
  }
  await db.query('insert into private.official_ra_year_counters values(2045,9999)');
  await rejects(
    () => allocate(db, randomUUID(), '2045-01-01T00:00:00Z'),
    /OFFICIAL_RA_YEAR_EXHAUSTED/,
  );
  await db.query('begin');
  await allocate(db, randomUUID(), '2046-01-01T00:00:00Z');
  await db.query('rollback');
  check(
    (await allocate(db, randomUUID(), '2046-01-01T00:00:00Z')) === '2046-0001',
    'unissued rollback does not consume number',
  );
  await rejects(
    () => db.query('delete from private.official_ra_issuances where reservation_id=$1', [first]),
    /ISSUANCE_IMMUTABLE/,
  );
  await rejects(
    () =>
      db.query(
        "update public.reservation_agreements set reservation_number='2026-9999' where id=$1",
        [legacy.reservationId],
      ),
    /NUMBER_IMMUTABLE/,
  );
  const pendingBefore = (
    await db.query('select count(*)::int n from private.official_ra_issuances')
  ).rows[0].n;
  await fixture.mkApproved('draft');
  check(
    (await db.query('select count(*)::int n from private.official_ra_issuances')).rows[0].n ===
      pendingBefore,
    'draft application has no RA',
  );
  const app = await fixture.mkApproved('approved');
  const request = randomUUID();
  const ra = await fixture.reserve(app.id, app.termsId, request);
  check((await fixture.reserve(app.id, app.termsId, request)) === ra, 'issuance RPC idempotent');
  await rejects(() => fixture.reserve(app.id, app.termsId), /RESERVATION_ALREADY_EXISTS/);
  const issued = (
    await db.query('select reservation_number from public.reservation_agreements where id=$1', [ra])
  ).rows[0].reservation_number;
  check(/^[0-9]{4}-[0-9]{4}$/.test(issued), 'new reservation canonical annual format');
  check(
    (
      await db.query(
        "select after_data->>'reservationNumber' n from public.audit_events where entity_id=$1 and action='RESERVATION_AGREEMENT_CREATED'",
        [ra],
      )
    ).rows[0].n === issued,
    'audit contains the same official RA',
  );
  await fixture.transition('cancel', actor, ra);
  check(
    (
      await db.query(
        'select reservation_number from private.official_ra_issuances where reservation_id=$1',
        [ra],
      )
    ).rows[0].reservation_number === issued,
    'cancellation retains tombstone',
  );
  const approval = await makePurchaseFixtures(db, {
    actor,
    tier: 'GOLD',
    automaticReservation: true,
    createdCustomers: [],
    createdApplications: [],
  });
  const approved = await approval.mkApproved('approved');
  const issuedCount = (
    await db.query(
      'select count(*)::int n from public.reservation_agreements where customer_application_id=$1',
      [approved.id],
    )
  ).rows[0].n;
  check(issuedCount === 1, 'authorized approval creates exactly one official RA');
  const approvalRequest = (
    await db.query(
      "select request_id from public.audit_events where entity_id=$1 and action='CUSTOMER_APPLICATION_APPROVED'",
      [approved.id],
    )
  ).rows[0].request_id;
  check(
    (
      await db.query("select public.decide_purchase_application_once($1,$2,$3,'approved') id", [
        approvalRequest,
        actor,
        approved.id,
      ])
    ).rows[0].id === approved.id,
    'same approval request replays without issuing again',
  );
  await rejects(
    () =>
      db.query("select public.decide_purchase_application_once($1,$2,$3,'approved')", [
        randomUUID(),
        actor,
        approved.id,
      ]),
    /APPLICATION_NOT_SUBMITTED|TRANSITION|NOT_REVIEWABLE|APPLICATION_NOT_REVIEWABLE/,
  );
  check(
    (
      await db.query(
        'select count(*)::int n from public.reservation_agreements where customer_application_id=$1',
        [approved.id],
      )
    ).rows[0].n === 1,
    'repeated approval never duplicates RA',
  );
  const formatter = (ra: string, date: string) =>
    db
      .query("select private.vip_number_from_official_ra($1,$2,'GOLD','spot_cash',null) n", [
        ra,
        date,
      ])
      .then((r) => r.rows[0].n);
  check(
    (await formatter('2026-0001', '2026-11-07T16:01:00Z')) === '26110800001G1C01S',
    'approved VIP example and Manila actual activation date',
  );
  check(
    (await formatter('2020-0001', '2026-11-07T16:01:00Z')) ===
      (await formatter('2021-0001', '2026-11-07T16:01:00Z')),
    'cross-year collision identified without alternative sequence',
  );
  await rejects(
    () => formatter(legacyNumber, '2026-11-08T00:00:00Z'),
    /VIP_OFFICIAL_RA_SEQUENCE_REQUIRED/,
  );
  await rejects(
    () => db.query("select public.generate_vip_card_number('GOLD')"),
    /VIP_ACTIVATION_CONTEXT_REQUIRED/,
  );
  const settle = async (purchase: { reservationId: string; total: string }) => {
    const payment = (
      await db.query('select public.record_reservation_payment_once($1,$2,$3,$4) id', [
        randomUUID(),
        purchase.reservationId,
        { amount: purchase.total, method: 'cash', paymentType: 'full', reference: 'NUMBER-TEST' },
        actor,
      ])
    ).rows[0].id;
    await db.query("select public.verify_purchase_payment_once($1,$2,'verified',null,$3)", [
      randomUUID(),
      payment,
      actor,
    ]);
    return (
      await db.query('select public.finalize_reservation_purchase_once($1,$2,$3) id', [
        randomUUID(),
        purchase.reservationId,
        actor,
      ])
    ).rows[0].id;
  };
  const saleA = await settle(annualA),
    saleB = await settle(annualB);
  const unsettled = await fixture.executed();
  check(
    (
      await db.query('select vip_card_number from public.customers where id=$1', [
        unsettled.customerId,
      ])
    ).rows[0].vip_card_number === null,
    'no final VIP before verified settlement and activation',
  );
  const idBeforeActivation = (
    await db.query('select ra_number from public.customers where id=$1', [annualA.customerId])
  ).rows[0].ra_number;
  await db.query('select * from public.activate_card_sale($1,$2)', [saleA, actor]);
  const activation = (
    await db.query('select activated_at from public.memberships where sale_id=$1', [saleA])
  ).rows[0].activated_at;
  const actualVip = (
    await db.query('select vip_card_number from public.customers where id=$1', [annualA.customerId])
  ).rows[0].vip_card_number;
  check(
    actualVip === (await formatter('2020-0001', activation.toISOString())),
    'activation derives VIP from its own official RA and actual timestamp',
  );
  const retried = (await db.query('select * from public.activate_card_sale($1,$2)', [saleA, actor]))
    .rows[0];
  check(retried.already_active === true, 'activation idempotent');
  check(
    (await db.query('select ra_number from public.customers where id=$1', [annualA.customerId]))
      .rows[0].ra_number === idBeforeActivation,
    'activation does not reassign Customer ID',
  );
  await rejects(
    () => db.query('select * from public.activate_card_sale($1,$2)', [saleB, actor]),
    /VIP_RA_NUMBER_COLLISION/,
  );
  check(
    (await db.query('select count(*)::int n from public.memberships where sale_id=$1', [saleB]))
      .rows[0].n === 0,
    'collision rolls back membership',
  );
  check(
    (
      await db.query('select vip_card_number from public.customers where id=$1', [
        annualB.customerId,
      ])
    ).rows[0].vip_card_number === null,
    'collision does not alter customer ID',
  );
  const legacyCustomer = await fixture.mkCustomer(),
    legacySale = randomUUID();
  const plan = (await db.query("select * from public.card_plans where code='GOLD'")).rows[0];
  const saleNumber = (await db.query('select * from public.next_sale_number()')).rows[0]
    .sale_number;
  await db.query(
    "insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,cash_price_snapshot,status,balance_due_at,payment_scheme,created_by,yearly_points_snapshot,minimum_down_payment_snapshot,commission_rate_snapshot,expected_commission_snapshot) values($1,$2,$3,$4,'staff',$5,$6,$6,'payment_verified',now()+interval '365 days','spot_cash',$5,$7,$8,$9,'0.00')",
    [
      legacySale,
      saleNumber,
      legacyCustomer,
      plan.id,
      actor,
      plan.cash_price,
      plan.yearly_points,
      plan.minimum_down_payment,
      plan.commission_rate,
    ],
  );
  await db.query(
    "insert into public.payments(sale_id,amount,method,status,payment_type,recorded_by,verified_by,verified_at) values($1,$2,'cash','verified','full',$3,$3,now())",
    [legacySale, plan.cash_price, actor],
  );
  const legacyAgreement = (
    await db.query('select public.save_reservation_agreement(null,$1,$2,$3) id', [
      actor,
      { saleId: legacySale, reservationDate: '2026-11-08', agreementDate: '2026-11-08' },
      {
        name: 'ANA SANTOS',
        address: 'Synthetic',
        contactNumber: '09175550001',
        email: 'legacy@example.invalid',
      },
    ])
  ).rows[0].id;
  await db.query(
    "update public.reservation_agreements set status='executed',submitted_at=now(),executed_at=now() where id=$1",
    [legacyAgreement],
  );
  await db.query('select * from public.activate_card_sale($1,$2)', [legacySale, actor]);
  check(
    (await db.query('select vip_card_number from public.customers where id=$1', [legacyCustomer]))
      .rows[0].vip_card_number !== null,
    'executed legacy sale-origin agreement remains compatible',
  );
  const importCustomer = await fixture.mkCustomer(),
    job = randomUUID(),
    row = randomUUID();
  await db.query(
    "insert into public.customer_import_jobs(id,source_type,source_name,created_by) values($1,'excel','numbering-proof.xlsx',$2)",
    [job, actor],
  );
  await db.query(
    "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,1,$3,$4,'valid','CREATE')",
    [row, job, { vip_tier: 'GOLD', stated_status: 'Fully Paid' }, { externalVerified: true }],
  );
  await db.query('select private.import_customer_vip_number($1,$2,$3)', [
    row,
    importCustomer,
    actor,
  ]);
  check(
    (await db.query('select vip_card_number from public.customers where id=$1', [importCustomer]))
      .rows[0].vip_card_number === null,
    'prospective import defers final VIP allocation',
  );
  await db.query(
    'update public.customer_import_rows set raw_data=raw_data||\'{"existing_card_activation_date":"2025-10-01"}\'::jsonb where id=$1',
    [row],
  );
  await rejects(
    () =>
      db.query('select private.import_customer_vip_number($1,$2,$3)', [row, importCustomer, actor]),
    /IMPORT_VIP_EXISTING_NUMBER_REQUIRED/,
  );
  const preserved = '25100100998G1C01N';
  await db.query(
    'update public.customer_import_rows set raw_data=raw_data||$2::jsonb where id=$1',
    [row, { existing_vip_control_number: preserved, contract_classification: 'Non-Standard' }],
  );
  await db.query('select private.import_customer_vip_number($1,$2,$3)', [
    row,
    importCustomer,
    actor,
  ]);
  check(
    (await db.query('select vip_card_number from public.customers where id=$1', [importCustomer]))
      .rows[0].vip_card_number === preserved,
    'certified historical import preserves its supplied VIP ID',
  );
  check(
    (
      await db.query(
        "select count(*)::int n from pg_constraint where conrelid='private.official_ra_issuances'::regclass and contype='f'",
      )
    ).rows[0].n === 0,
    'issuance tombstone survives deleted reservation',
  );
  await db.query('set enable_seqscan=off');
  const explain = (
    await db.query(
      'explain select id from public.reservation_agreements where reservation_number=$1',
      [issued],
    )
  ).rows
    .map((r) => r['QUERY PLAN'])
    .join('\n');
  check(
    /reservation_agreements_reservation_number_key/.test(explain),
    'exact RA search uses existing unique index',
  );
  await db.query('reset enable_seqscan');
  await db.query('set role authenticated');
  await rejects(
    () => db.query('select private.allocate_official_ra($1,now())', [randomUUID()]),
    /permission denied/,
  );
  await rejects(() => db.query('select * from private.official_ra_issuances'), /permission denied/);
  await db.query('reset role');
  await rejects(
    () => db.query('select * from public.activate_card_sale($1,$2)', [saleB, randomUUID()]),
    /ACTOR|FORBIDDEN|PERMISSION/,
  );
  await db.query(migration);
  check(
    (
      await db.query('select vip_card_number from public.customers where id=$1', [
        legacy.customerId,
      ])
    ).rows[0].vip_card_number === historicalVip,
    'replay preserves historical VIP',
  );
  const audit = await db.query(readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
  for (const r of Array.isArray(audit) ? audit : [audit])
    check(r.rows.length === 0, 'RLS invariants');
  console.log(
    `PASS ${checks} official numbering checks: historical/annual/year rollover/concurrency/idempotency/approval/cancellation/customer independence/activation/collision rollback/permissions/indexes/replay. Disposable loopback only.`,
  );
} finally {
  await postgres.stop();
}
