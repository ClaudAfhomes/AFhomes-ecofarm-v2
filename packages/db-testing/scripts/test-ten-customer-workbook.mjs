import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
import { startVipHttpHarness } from './lib/vip-http-harness.mjs';
import { parseCustomerWorkbookV2 } from '../../../api/_lib/customer-workbook-v2.ts';
import { validateImportRow } from '../../../api/_lib/customer-import.ts';
import {
  validateWorkbookFields,
  resolveWorkbookStaff,
  resolveWorkbookGeography,
  workbookApplicationPrefill,
} from '../../../api/_lib/customer-workbook.ts';
import { buildImportedCustomerFacts } from '../../../api/_lib/customer-import-continuation.ts';
import { externalImportSummary } from '../../../api/_lib/external-customer-import.ts';
import { customerImportContinuationSchema } from '../../../packages/contracts/src/schemas/customer-import-continuation.ts';

// Loopback-only PostgreSQL; no repository environment files or shared services.
const root = new URL('../../../', import.meta.url);
const file = new URL('outputs/customer-import-2026-10-23/AFHomes_10_Customers.xlsx', root);
const source = JSON.parse(
  readFileSync(new URL('docs/import/samples/ten-customer-workbook.json', root), 'utf8'),
);
const workbook = parseCustomerWorkbookV2(readFileSync(file));
assert.equal(workbook.rows.length, 10);
const geography = {
  name: 'Captured application PSGC provider response',
  async provinces() {
    return source.geography.provinces;
  },
  async localities(code) {
    return new Map(source.geography.localities).get(code);
  },
  async barangays(code) {
    return new Map(source.geography.barangays).get(code);
  },
};
const postgres = await startDisposablePostgres();
const db = postgres.client;
const results = [];
try {
  const staff = {};
  const matches = [];
  for (const [key, role, name] of [
    ['actor', 'super_admin', 'Alejandro Espinosa'],
    ['vd', 'vice_director', 'Eduardo Manalo'],
    ['ssm', 'senior_sales_manager', 'Cristina Vergara'],
    ['sm', 'sales_manager', 'Roberto Alcantara'],
    ['referrer', 'ost', 'Mariel Soriano'],
    ['recommender', 'ost', 'Daniel Pineda'],
  ]) {
    const id = (staff[key] = randomUUID());
    const email = name.toLowerCase().replaceAll(' ', '.') + '@afhomes-local.test';
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,$3,'active')",
      [id, email, name],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    if (key !== 'actor')
      matches.push({
        staff_id: id,
        full_name: name,
        role_slug: role,
        ancestor_ids: [],
        match_count: 1,
      });
  }
  for (const [child, parent, role] of [
    ['ssm', 'vd', 'senior_sales_manager'],
    ['sm', 'ssm', 'sales_manager'],
    ['referrer', 'sm', 'ost'],
    ['recommender', 'ssm', 'ost'],
  ]) {
    await db.query(
      'insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,is_authoritative,is_active,assigned_by) values($1,$2,$3,true,true,$4)',
      [staff[child], staff[parent], role, staff.actor],
    );
  }
  for (const m of matches) {
    const lineage =
      m.staff_id === staff.vd
        ? []
        : m.staff_id === staff.ssm
          ? [staff.vd]
          : m.staff_id === staff.sm
            ? [staff.ssm, staff.vd]
            : m.staff_id === staff.referrer
              ? [staff.sm, staff.ssm, staff.vd]
              : [staff.ssm, staff.vd];
    m.ancestor_ids = lineage;
  }
  for (const [key, parent] of [
    ['referrer', 'sm'],
    ['recommender', 'ssm'],
  ]) {
    const member = matches.find((m) => m.staff_id === staff[key]);
    const [first, last] = member.full_name.split(' ');
    const email = member.full_name.toLowerCase().replaceAll(' ', '.') + '@afhomes-local.test';
    const code = (
      await db.query(
        "insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,expires_at,created_by) values(encode(sha256($1::bytea),'hex'),'LOCAL',$2,now()+interval '1 day',$3) returning id",
        [randomUUID(), staff[parent], staff.actor],
      )
    ).rows[0].id;
    const app = (
      await db.query(
        "insert into public.ost_applications(referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address,status) values($1,$2,$3,'+639178462991',$4,$5,'1990-01-01','{}','approved') returning id",
        [code, staff[parent], email, first, last],
      )
    ).rows[0].id;
    await db.query(
      "insert into public.ost_members(id,application_id,sponsor_staff_id,ost_number,full_name,email,phone,status,approved_by) select $1,$2,$3,ost_number,$4,$5,'+639178462991','active',$6 from public.next_ost_number()",
      [staff[key], app, staff[parent], member.full_name, email, staff.actor],
    );
  }
  const plans = (await db.query('select id,code from public.card_plans where is_active')).rows;
  await db.query(
    "insert into public.commission_rules(target_type,target_id,rate,effective_from,is_active,created_by) values('staff',$1,'0.04','2026-01-01',true,$2)",
    [staff.referrer, staff.actor],
  );
  const ctx = {
    plansByTier: new Map(plans.map((p) => [p.code, p])),
    customerByNumber: new Map(),
    customerByEmail: new Map(),
    membershipByNumber: new Map(),
    referralStaffByCode: new Map(),
    seenMembershipNumbers: new Map(),
  };
  const normalized = [];
  for (const [i, row] of workbook.rows.entries()) {
    const fields = row.fields;
    const validated = validateImportRow(i + 2, fields, ctx, '2026-10-23');
    validateWorkbookFields(fields, validated);
    resolveWorkbookStaff(fields, matches, validated);
    await resolveWorkbookGeography(fields, geography, validated);
    workbookApplicationPrefill(fields);
    assert.deepEqual(validated.errors, [], `${fields.first_name}: validation errors`);
    assert(validated.normalized);
    Object.assign(validated.normalized, {
      customerFacts: buildImportedCustomerFacts(fields),
      paymentClaims: row.payments,
      externalVerified: true,
      externalReason:
        'Historical customer balances and payment records reconciled before migration.',
      externalSummary: externalImportSummary(fields, row.payments),
    });
    assert.equal(validated.normalized.externalSummary.stage, source.data[i].expected.stage);
    normalized.push(validated.normalized);
  }
  console.log(
    'PASS: All 10 workbook rows passed production row, application, staff and geography validators.',
  );
  const job = randomUUID(),
    rowIds = [];
  await db.query(
    "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'excel','AFHomes_10_Customers.xlsx','ready',10,10,$2,now())",
    [job, staff.actor],
  );
  for (const [i, row] of workbook.rows.entries()) {
    const id = randomUUID();
    rowIds.push(id);
    await db.query(
      "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,$3,$4,$5,'valid','CREATE')",
      [id, job, i + 2, row.fields, normalized[i]],
    );
  }
  const previews = (
    await db.query('select public.prepare_customer_import_batch($1::uuid[],$2) result', [
      rowIds,
      staff.actor,
    ])
  ).rows[0].result;
  assert.equal(previews.length, 10);
  for (const [i, preview] of previews.entries()) customerImportContinuationSchema.parse(preview);
  for (const [i, id] of rowIds.entries()) {
    const expected = source.data[i].expected,
      fields = workbook.rows[i].fields;
    const commit = async (rowId) =>
      (
        await db.query('select public.commit_external_customer_import_row($1,$2,$3) result', [
          rowId,
          staff.actor,
          normalized[i].externalReason,
        ])
      ).rows[0].result;
    const first = await commit(id);
    const record = (
      await db.query('select record from public.customer_directory($1)', [{ id: first.customerId }])
    ).rows[0].record;
    assert.equal(first.importContinuation.stage, expected.stage);
    assert.equal(record.tier, fields.vip_tier);
    assert.equal(Number(record.verified_paid), Number(expected.paid));
    assert.equal(
      Number(record.frozen_total),
      expected.stage === 'application' ? 0 : Number(expected.total),
    );
    const customer = (
      await db.query('select * from public.customers where id=$1', [first.customerId])
    ).rows[0];
    const purchase = (
      await db.query(
        'select purchase_reference from private.customer_import_purchase_sources where customer_id=$1',
        [first.customerId],
      )
    ).rows[0];
    assert.equal(purchase.purchase_reference, customer.vip_card_number);
    const application = (
      await db.query(
        'select payment_scheme_snapshot from public.customer_applications where id=$1',
        [first.importContinuation.applicationId],
      )
    ).rows[0];
    assert.equal(application.payment_scheme_snapshot, fields.stated_payment_scheme_code);
    assert.match(customer.ra_number, /^\d{4}-\d{4}$/);
    assert.match(customer.vip_card_number, /^\d{11}[BGS]1[CT]\d{2}[SN]$/);
    if (fields.ra_number) assert.equal(customer.ra_number, fields.ra_number);
    if (fields.existing_vip_control_number)
      assert.equal(customer.vip_card_number, fields.existing_vip_control_number);
    else
      assert.equal(
        customer.vip_card_number.slice(11),
        `${fields.vip_tier[0]}1${['Spot cash', 'Move a'].includes(fields.stated_payment_scheme) ? 'C' : 'T'}${fields.payment_term_months.padStart(2, '0')}S`,
      );
    const holder = (
      await db.query(
        "select * from public.customer_application_holders where application_id=$1 and holder_type='PRIMARY'",
        [first.importContinuation.applicationId],
      )
    ).rows[0];
    assert(holder, 'Primary holder persisted');
    assert.equal(holder.province, fields.province);
    assert.equal(holder.city_municipality, fields.city);
    assert.equal(holder.barangay, fields.barangay);
    assert.equal(holder.province_code, fields.province_code);
    assert.equal(holder.city_municipality_code, fields.city_code);
    assert.equal(holder.barangay_code, fields.barangay_code);
    const member = (
      await db.query(
        'select m.*,a.balance,a.weekday_balance,a.weekend_balance from public.memberships m join public.points_accounts a on a.membership_id=m.id where m.customer_id=$1',
        [first.customerId],
      )
    ).rows[0];
    if (['active', 'inactive'].includes(expected.stage)) {
      assert(member);
      assert.equal(Number(member.balance), expected.points);
      assert.equal(Number(member.weekday_balance), expected.points * 0.7);
      assert.equal(Number(member.weekend_balance), expected.points * 0.3);
      if (expected.stage === 'active') {
        const position = (
          await db.query('select public.customer_points_position_with_allowances($1) result', [
            member.id,
          ])
        ).rows[0].result;
        assert.equal(Number(position.spendable), expected.points);
        assert.equal(Number(position.weekday_spendable), expected.points * 0.7);
        assert.equal(Number(position.weekend_spendable), expected.points * 0.3);
      }
      assert.equal(
        member.status,
        expected.stage === 'active'
          ? 'active'
          : fields.stated_status === 'Expired'
            ? 'expired'
            : fields.stated_status === 'Cancelled'
              ? 'cancelled'
              : 'suspended',
      );
    } else assert.equal(member, undefined, 'Unactivated customer must not have a membership');
    const counts = async () =>
      (
        await db.query(
          'select (select count(*) from public.customers) customers,(select count(*) from public.customer_applications) applications,(select count(*) from public.reservation_agreements) reservations,(select count(*) from public.payments) payments,(select count(*) from public.memberships) memberships,(select count(*) from public.points_ledger) ledger',
        )
      ).rows[0];
    const before = await counts();
    const repeat = await commit(id);
    assert.equal(repeat.customerId, first.customerId);
    assert.deepEqual(await counts(), before);
    // A separate upload of the identical row must also converge without more credit.
    const nextJob = randomUUID(),
      nextRow = randomUUID();
    await db.query(
      "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'excel','AFHomes_10_Customers.xlsx','ready',1,1,$2,now())",
      [nextJob, staff.actor],
    );
    await db.query(
      "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,2,$3,$4,'valid','UPDATE')",
      [nextRow, nextJob, fields, normalized[i]],
    );
    await db.query('select public.prepare_customer_import_batch(array[$1::uuid],$2)', [
      nextRow,
      staff.actor,
    ]);
    const reimport = await commit(nextRow);
    assert.equal(reimport.customerId, first.customerId);
    assert.deepEqual(await counts(), before);
    results.push({
      name: `${fields.first_name} ${fields.last_name}`,
      tier: fields.vip_tier,
      scheme: fields.stated_payment_scheme,
      status: fields.stated_status,
      stage: expected.stage,
      customerId: customer.ra_number,
      vipId: customer.vip_card_number,
      location: `${fields.barangay}, ${fields.city}, ${fields.province}`,
      paid: expected.paid,
      total: expected.total,
      points: expected.points,
      weekday: expected.points * 0.7,
      weekend: expected.points * 0.3,
    });
    console.log(
      `PASS: ${results.at(-1).name}: ${expected.stage}; ID ${customer.vip_card_number}; points ${expected.points}; repeat/re-upload unchanged.`,
    );
  }
  assert.equal((await db.query('select count(*)::int n from public.customers')).rows[0].n, 10);
  assert.equal(new Set(results.map((r) => r.vipId)).size, 10);
  assert.equal(new Set(results.map((r) => r.customerId)).size, 10);
  assert.equal(
    (await db.query('select count(*)::int n from public.commissions')).rows[0].n,
    0,
    'Settled imports must not create zero-value or payable commissions',
  );
  const portal = async (actor, team = false, page = 1) =>
    (
      await db.query('select public.imported_sales_for_account($1,$2,null,null,$3) result', [
        actor,
        team,
        page,
      ])
    ).rows[0].result;
  for (const actor of [staff.referrer, staff.recommender]) {
    const list = await portal(actor);
    assert.equal(list.meta.total, 10);
    assert.equal(list.data.filter((r) => r.commissionPolicy === 'settled_before_system').length, 6);
    assert.equal(list.data.filter((r) => r.commissionPolicy === 'normal_qualification').length, 4);
    assert.equal((await portal(actor, false, 2)).data.length, 0);
  }
  for (const actor of [staff.vd, staff.ssm, staff.sm])
    assert.equal((await portal(actor, true)).meta.total, 10);
  assert.equal(
    (await portal(staff.sm, false)).meta.total,
    0,
    'Upline involvement is team monitoring, not a personal sale',
  );
  await assert.rejects(portal(staff.referrer, true), /FORBIDDEN/);
  // A new leader cannot acquire the old import just by moving its seller today.
  const unrelated = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    unrelated,
    'emilio.cabrera@afhomes-local.test',
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'EMILIO CABRERA','active')",
    [unrelated, 'emilio.cabrera@afhomes-local.test'],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='vice_director'",
    [unrelated],
  );
  assert.equal((await portal(unrelated, true)).meta.total, 0);
  await db.query('begin');
  await db.query(
    'update public.referral_relationships set upline_staff_id=$1 where subject_staff_id=$2',
    [unrelated, staff.ssm],
  );
  assert.equal(
    (await portal(unrelated, true)).meta.total,
    0,
    'Current genealogy must not invent historical attribution',
  );
  await db.query('rollback');
  // Finish an imported unpaid purchase through the existing payment/finalization workflow.
  const unpaid = (
    await db.query(
      'select src.application_id,ra.id reservation_id,t.expected_commission,t.commission_rate from private.customer_import_purchase_sources src join public.customer_import_rows ir on ir.id=src.original_row_id join public.reservation_agreements ra on ra.customer_application_id=src.application_id join public.customer_applications a on a.id=src.application_id join public.customer_application_purchase_terms t on t.id=a.purchase_terms_id where ir.row_number=4 and ir.import_job_id=$1',
      [job],
    )
  ).rows[0];
  assert.equal(Number(unpaid.expected_commission), 2880);
  assert.equal(unpaid.commission_rate, '0.04');
  const payment = (
    await db.query('select public.record_reservation_payment_once($1,$2,$3,$4) id', [
      randomUUID(),
      unpaid.reservation_id,
      { amount: '42000.00', paymentType: 'full', method: 'cash', reference: 'RC-261023-1884' },
      staff.actor,
    ])
  ).rows[0].id;
  await db.query("select public.verify_purchase_payment_once($1,$2,'verified',null,$3)", [
    randomUUID(),
    payment,
    staff.actor,
  ]);
  const finalized = (
    await db.query('select public.finalize_reservation_purchase_once($1,$2,$3) id', [
      randomUUID(),
      unpaid.reservation_id,
      staff.actor,
    ])
  ).rows[0].id;
  const commission = (
    await db.query('select * from public.commissions where sale_id=$1', [finalized])
  ).rows[0];
  assert.equal(Number(commission.amount), 2880);
  assert.equal(
    commission.status,
    'payment_verified',
    'Import must never auto-earn or auto-pay commissions',
  );
  const settledSale = (
    await db.query(
      "select a.sale_id from private.customer_import_purchase_sources src join public.customer_import_rows ir on ir.id=src.original_row_id join public.customer_applications a on a.id=src.application_id where ir.raw_data->>'stated_status'='Fully Paid' limit 1",
    )
  ).rows[0].sale_id;
  await assert.rejects(
    db.query(
      "insert into public.commissions(sale_id,beneficiary_type,beneficiary_staff_id,amount,rate_snapshot,basis_amount_snapshot,status) values($1,'staff',$2,100,'0.04','2500.00','pending')",
      [settledSale, staff.referrer],
    ),
    /IMPORT_COMMISSION_ALREADY_SETTLED/,
  );
  assert.equal(
    (await portal(staff.referrer)).data.filter((r) => r.commissionPolicy === 'normal_qualification')
      .length,
    4,
    'Later payment cannot rewrite the cutover policy',
  );
  for (const actor of [staff.vd, staff.ssm, staff.sm]) {
    const saleIds = (
      await db.query('select public.imported_commission_sale_ids_for_account($1) ids', [actor])
    ).rows[0].ids;
    assert.deepEqual(saleIds, [finalized]);
  }
  await db.query('begin');
  const http = await startVipHttpHarness(db, new Map(Object.values(staff).map((id) => [id, id])));
  try {
    for (const actor of [staff.referrer, staff.recommender]) {
      const list = await http.request('/ist-portal/imported-sales', actor);
      assert.equal(list.meta.total, 10);
    }
    for (const actor of [staff.vd, staff.ssm, staff.sm]) {
      const list = await http.request('/ist-portal/imported-sales?view=team-sales', actor);
      assert.equal(list.meta.total, 10);
    }
    const monitor = await http.request(
      '/ist-portal?view=team-commissions&from=2026-01-01&to=2026-12-31',
      staff.sm,
    );
    assert.equal(monitor.commissions.length, 1);
    assert.equal(Number(monitor.commissions[0].amount), 2880);
    const ownOstCommissions = await http.request('/ost/me/commissions', staff.referrer);
    assert.equal(ownOstCommissions.data.length, 1);
    assert.equal(Number(ownOstCommissions.data[0].amount), 2880);
    await http.request(
      '/ist-portal/imported-sales?view=team-sales',
      staff.referrer,
      undefined,
      403,
    );
  } finally {
    await http.stop();
    await db.query('rollback');
  }
  // Reproduce a pre-migration zero-value history entry, then verify a repeated
  // migration hides it without changing its amount or lifecycle status.
  await db.query('begin');
  await db.query('drop trigger import_commission_already_settled on public.commissions');
  const oldCommission = (
    await db.query(
      "insert into public.commissions(sale_id,beneficiary_type,beneficiary_staff_id,amount,rate_snapshot,basis_amount_snapshot,status) values($1,'staff',$2,0,'0','312000.00','payment_verified') returning id",
      [settledSale, staff.referrer],
    )
  ).rows[0].id;
  await db.query(
    readFileSync(
      new URL(
        'supabase/migrations/20261223000004_afhomes_import_sales_commission_cutover.sql',
        root,
      ),
      'utf8',
    ),
  );
  const old = (
    await db.query(
      'select amount,status,settled_before_system from public.commissions where id=$1',
      [oldCommission],
    )
  ).rows[0];
  assert.equal(Number(old.amount), 0);
  assert.equal(old.status, 'payment_verified');
  assert.equal(old.settled_before_system, true);
  await assert.rejects(
    db.query('update public.commissions set settled_before_system=false where id=$1', [
      oldCommission,
    ]),
    /IMPORT_COMMISSION_ALREADY_SETTLED/,
  );
  await db.query('rollback');
  console.log(
    'PASS: IST/OST recorded involvement, settled suppression, normal unpaid commission finalization, pagination and unrelated/moved-team denials.',
  );
  for (const fn of [
    'public.imported_sales_for_account(uuid,boolean,date,date,integer)',
    'public.imported_commission_sale_ids_for_account(uuid)',
  ]) {
    assert.equal(
      (await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed", [fn]))
        .rows[0].allowed,
      false,
    );
    assert.equal(
      (await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed", [fn])).rows[0]
        .allowed,
      false,
    );
  }
  const rls = await db.query(
    readFileSync(new URL('supabase/security/rls_invariants.sql', root), 'utf8'),
  );
  assert.equal(rls.flatMap((r) => r.rows ?? []).length, 0);
  writeFileSync(
    new URL('outputs/customer-import-2026-10-23/import-results.json', root),
    JSON.stringify(
      {
        passed: true,
        customers: 10,
        scope:
          'Actual workbook parser and validators -> canonical import preview/commit RPCs -> disposable PostgreSQL with Supabase shim. No browser/Auth/PostgREST E2E.',
        results,
      },
      null,
      2,
    ),
  );
  console.table(
    results.map(({ name, tier, scheme, status, stage, points }) => ({
      name,
      tier,
      scheme,
      status,
      stage,
      points,
    })),
  );
  console.log(
    'PASS: 10 customers, five payment schemes, three tiers, eight statuses, identifiers, locations, 70/30 balances, idempotency and RLS.',
  );
} finally {
  await postgres.stop();
}
