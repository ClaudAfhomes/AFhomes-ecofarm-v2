import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { listMigrations, startDisposablePostgres } from './lib/local-postgres.mjs';
import { externalImportSummary } from '../../../api/_lib/external-customer-import.ts';
import { buildImportedCustomerFacts } from '../../../api/_lib/customer-import-continuation.ts';
import { makePurchaseFixtures } from '../../../supabase/reservation-purchase-integration.ts';

// Owns only a fresh loopback database. Never loads repository environment files.
const releasedSchema = process.argv.includes('--released-schema');
const summaryMigration = '20261208000020_afhomes_customer_purchase_summary.sql';
const excludedMigrations = releasedSchema
  ? listMigrations().filter((name) => name > '20261208000020_afhomes_customer_purchase_summary.sql')
  : [];
const postgres = await startDisposablePostgres({
  excludedMigrations,
  beforeMigration: releasedSchema ? summaryMigration : undefined,
});
let summaryInstalled = !releasedSchema;
const db = postgres.client;
try {
  const staff = {};
  for (const [key, role] of Object.entries({
    actor: 'super_admin',
    vd: 'vice_director',
    ssm: 'senior_sales_manager',
    sm: 'sales_manager',
    referrer: 'ost',
    recommender: 'ost',
  })) {
    const id = randomUUID();
    staff[key] = id;
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,$3,'active')",
      [id, `${id}@example.invalid`, `External Test ${key}`],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
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
  for (const [tier, total] of [
    ['BRONZE', '60000.00'],
    ['SILVER', '240000.00'],
    ['GOLD', '312000.00'],
  ]) {
    const statuses = [
      ['Pending', '0.00', 'application'],
      ['Reservation Paid', '10000.00', 'reservation'],
      ['Down Payment', '20000.00', 'finance'],
      ['Partially Paid', '30000.00', 'finance'],
      ['Fully Paid', total, 'activation'],
    ];
    for (const [status, amount, stage] of statuses) {
      const run = randomUUID(),
        job = randomUUID(),
        row = randomUUID();
      const fields = {
        workbook_format: 'company_v2',
        purchase_reference: `EXTERNAL-${run}`,
        customer_key: run,
        first_name: 'External',
        last_name: 'Synthetic',
        birth_date: '1990-01-01',
        sex: 'Male',
        citizenship: 'Filipino',
        civil_status: 'Single',
        email: `${run}@example.invalid`,
        mobile: '09175550001',
        address_line_1: 'Synthetic address',
        province: 'Laguna',
        city: 'Calamba',
        vip_tier: tier,
        stated_status: status,
        contract_date: '2026-10-01',
        stated_payment_scheme: 'Spot cash',
        stated_payment_scheme_code: 'spot_cash',
        stated_regular_price: total,
        stated_discount: '0.00',
        stated_total: total,
        stated_rf: '10000.00',
        vd_name: 'External Test vd',
        vd_staff_id: staff.vd,
        ssm_name: 'External Test ssm',
        ssm_staff_id: staff.ssm,
        sm_name: 'External Test sm',
        sm_staff_id: staff.sm,
        referrer_name: 'External Test referrer',
        referrer_staff_id: staff.referrer,
        recommender_name: 'External Test recommender',
        recommender_staff_id: staff.recommender,
      };
      const payments =
        amount === '0.00'
          ? []
          : [
              {
                customerKey: run,
                paymentKey: run,
                purpose: amount === '10000.00' ? 'reservation' : 'full',
                amount,
                date: '2026-10-02',
                method: 'cash',
                reference: run,
                notes: 'Synthetic local test',
              },
            ];
      if (tier === 'GOLD' && status === 'Fully Paid')
        Object.assign(fields, {
          secondary_first_name: 'Supplementary',
          secondary_middle_name: 'Ann',
          secondary_last_name: 'Synthetic',
          secondary_suffix: 'Jr.',
          secondary_birth_date: '1992-01-01',
          secondary_sex: 'Female',
          secondary_citizenship: 'Filipino',
          secondary_civil_status: 'Single',
          secondary_address_line_1: 'Synthetic secondary address',
          secondary_address_line_2: 'Unit 7',
          secondary_postal_code: '4027',
          secondary_province: 'Laguna',
          secondary_city: 'Calamba',
          secondary_mobile: '09175550002',
          secondary_email: `${run}-holder@example.invalid`,
        });
      const normalized = {
        customerStatus: 'prospect',
        requireMember: false,
        payment: null,
        customerFacts: buildImportedCustomerFacts(fields),
        paymentClaims: payments,
        externalVerified: true,
        externalReason: 'Company history externally verified by local synthetic tester.',
        externalSummary: externalImportSummary(fields, payments),
      };
      await db.query(
        "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'excel','synthetic-external.xlsx','ready',1,1,$2,now())",
        [job, staff.actor],
      );
      await db.query(
        "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,2,$3,$4,'valid','CREATE')",
        [row, job, fields, normalized],
      );
      const preview = (
        await db.query('select public.prepare_customer_import_batch(array[$1::uuid],$2) result', [
          row,
          staff.actor,
        ])
      ).rows[0].result[0];
      assert.equal(preview.stage, stage, JSON.stringify(preview));
      const existingHistory = tier === 'GOLD' && status === 'Partially Paid';
      let existingReservation, existingPayment, paymentSnapshot;
      if (existingHistory) {
        const intake = (
          await db.query('select public.commit_customer_import_row($1,$2) result', [
            row,
            staff.actor,
          ])
        ).rows[0].result;
        const plan = (await db.query("select id from public.card_plans where code='GOLD'")).rows[0]
          .id;
        const header = {
          customerId: intake.customerId,
          planId: plan,
          paymentScheme: 'spot_cash',
          consentAcknowledged: true,
          acknowledgedAt: '2026-10-01',
          primarySignatureStatus: 'received',
          validIdReceived: true,
          reservationPaymentProofReceived: false,
          referrerStaffId: staff.referrer,
        };
        const appId = (
          await db.query('select public.save_customer_application(null,$1,$2,$3,null) id', [
            staff.actor,
            header,
            normalized.customerFacts.primary,
          ])
        ).rows[0].id;
        const offer = (
          await db.query('select public.purchase_terms_proposal($1,$2,$3) result', [
            appId,
            staff.actor,
            staff.referrer,
          ])
        ).rows[0].result;
        await db.query('select public.submit_purchase_application_once($1,$2,$3,$4,$5)', [
          randomUUID(),
          staff.actor,
          appId,
          offer.expectedProposalHash,
          staff.referrer,
        ]);
        await db.query("select public.decide_purchase_application_once($1,$2,$3,'approved')", [
          randomUUID(),
          staff.actor,
          appId,
        ]);
        const termsId = (
          await db.query(
            'select purchase_terms_id id from public.customer_applications where id=$1',
            [appId],
          )
        ).rows[0].id;
        existingReservation = (
          await db.query('select public.reserve_application_purchase_once($1,$2,$3,$4,$5) id', [
            randomUUID(),
            staff.actor,
            appId,
            termsId,
            {
              reservationDate: fields.contract_date,
              agreementDate: fields.contract_date,
              primarySignatureStatus: 'received',
            },
          ])
        ).rows[0].id;
        await db.query(
          "select public.transition_purchase_reservation_once($1,$2,$3,'submit','{}')",
          [randomUUID(), staff.actor, existingReservation],
        );
        await db.query(
          "select public.transition_purchase_reservation_once($1,$2,$3,'execute','{}')",
          [randomUUID(), staff.actor, existingReservation],
        );
        await db.query(
          'update private.customer_import_purchase_sources set application_id=$1 where id=$2',
          [appId, intake.importContinuation.sourceId],
        );
        existingPayment = (
          await db.query(
            "insert into public.payments(reservation_id,origin,customer_id,amount,payment_type,method,reference,status,recorded_by,recorded_at,verified_by,verified_at) values($1,'reservation',$2,$3,'full','cash',$4,'verified',$5,'2026-10-02',$5,now()) returning id",
            [existingReservation, intake.customerId, amount, run, staff.actor],
          )
        ).rows[0].id;
        paymentSnapshot = (
          await db.query('select to_jsonb(p) value from public.payments p where id=$1', [
            existingPayment,
          ])
        ).rows[0].value;
      }
      const commit = async () =>
        (
          await db.query('select public.commit_external_customer_import_row($1,$2,$3) result', [
            row,
            staff.actor,
            normalized.externalReason,
          ])
        ).rows[0].result;
      if (tier === 'GOLD' && status === 'Down Payment') {
        await db.query(
          "update public.customer_import_rows set normalized_data=jsonb_set(normalized_data,'{externalSummary,paid}','\"1.00\"'::jsonb) where id=$1",
          [row],
        );
        await assert.rejects(commit(), /IMPORT_SOURCE_CHANGED|EXTERNAL_IMPORT_TOTAL_CONFLICT/);
        assert.equal(
          (
            await db.query('select count(*)::int n from public.customers where email=$1', [
              fields.email,
            ])
          ).rows[0].n,
          0,
        );
        assert.equal(
          (
            await db.query('select committed_at from public.customer_import_rows where id=$1', [
              row,
            ])
          ).rows[0].committed_at,
          null,
        );
        await db.query(
          "update public.customer_import_rows set normalized_data=jsonb_set(normalized_data,'{externalSummary}',$2::jsonb) where id=$1",
          [row, normalized.externalSummary],
        );
      }
      const first = await commit();
      assert.equal(first.importContinuation.stage, stage);
      if (!summaryInstalled) {
        const snapshot = async () => {
          const result = [];
          for (const table of [
            'public.customers',
            'public.staff_users',
            'public.referral_relationships',
            'public.customer_applications',
            'public.customer_application_holders',
            'public.reservation_agreements',
            'public.payments',
            'public.card_sales',
            'public.memberships',
            'private.customer_import_purchase_sources',
            'private.customer_external_import_receipts',
          ]) {
            result.push({
              table,
              ...(
                await db.query(
                  `select count(*)::int n,md5(coalesce(string_agg(hash,',' order by hash),'')) hash from (select md5(to_jsonb(t)::text) hash from ${table} t) rows`,
                )
              ).rows[0],
            });
          }
          return result;
        };
        await db.query('begin');
        // Exercise the installed live variant that lacks the company-ID lookup branch.
        const installedDirectory = (
          await db.query(
            "select pg_get_functiondef('public.customer_directory(jsonb)'::regprocedure) definition",
          )
        ).rows[0].definition;
        await db.query(
          installedDirectory.replace(
            "lower(d.ra_number) like '%'||lower(p_filters->>'search')||'%' or ",
            '',
          ),
        );
        const before = await snapshot();
        await db.query(
          readFileSync(
            new URL('../../../supabase/migrations/' + summaryMigration, import.meta.url),
            'utf8',
          ),
        );
        assert.deepEqual(
          await snapshot(),
          before,
          'Summary migration must not change existing business data',
        );
        await db.query('commit');
        summaryInstalled = true;
      }
      const summaryRow = (
        await db.query('select record from public.customer_directory($1)', [
          { id: first.customerId },
        ])
      ).rows[0].record;
      assert.equal(
        summaryRow.tier,
        tier,
        'Application/reservation plan must be visible before finalization',
      );
      assert.equal(Number(summaryRow.verified_paid), Number(amount));
      assert.equal(Number(summaryRow.frozen_total), stage === 'application' ? 0 : Number(total));
      assert.equal(
        Number(summaryRow.open_reservation_total),
        ['reservation', 'finance'].includes(stage) ? Number(total) : 0,
      );
      assert.equal(
        Number(summaryRow.open_reservation_paid),
        ['reservation', 'finance'].includes(stage) ? Number(amount) : 0,
      );
      assert.equal(
        summaryRow.payment_status,
        stage === 'application'
          ? 'no_payment'
          : stage === 'activation'
            ? 'fully_paid'
            : 'partially_paid',
      );
      const filteredSummary = await db.query('select record from public.customer_directory($1)', [
        { id: first.customerId, tier, payment: summaryRow.payment_status, limit: 1 },
      ]);
      assert.equal(
        filteredSummary.rows.length,
        1,
        'Filters must use reservation facts before pagination',
      );
      const companyIdLookup = await db.query('select record from public.customer_directory($1)', [
        { search: summaryRow.ra_number },
      ]);
      assert(
        companyIdLookup.rows.some((r) => r.record.id === first.customerId),
        'Official company Customer IDs must remain searchable',
      );
      await db.query('set constraints all immediate');
      const second = await commit();
      assert.equal(second.customerId, first.customerId);
      assert.equal(second.importContinuation.applicationId, first.importContinuation.applicationId);
      const secondJob = randomUUID(),
        secondRow = randomUUID();
      await db.query(
        "insert into public.customer_import_jobs(id,source_type,source_name,status,total_rows,valid_rows,created_by,validated_at) values($1,'excel','same-external.xlsx','ready',1,1,$2,now())",
        [secondJob, staff.actor],
      );
      await db.query(
        "insert into public.customer_import_rows(id,import_job_id,row_number,raw_data,normalized_data,validation_status,action) values($1,$2,2,$3,$4,'valid','UPDATE')",
        [secondRow, secondJob, fields, normalized],
      );
      await db.query('select public.prepare_customer_import_batch(array[$1::uuid],$2)', [
        secondRow,
        staff.actor,
      ]);
      const repeatedProposal = (
        await db.query('select private.import_customer_proposal($1,null) as result', [secondRow])
      ).rows[0].result;
      assert.deepEqual(
        repeatedProposal.conflicts,
        [],
        'Application mirroring must preserve imported facts for a repeated workbook',
      );
      const reimport = (
        await db.query('select public.commit_external_customer_import_row($1,$2,$3) result', [
          secondRow,
          staff.actor,
          normalized.externalReason,
        ])
      ).rows[0].result;
      assert.equal(
        reimport.importContinuation.applicationId,
        first.importContinuation.applicationId,
      );
      assert.equal(
        reimport.importContinuation.reservationId,
        first.importContinuation.reservationId,
      );
      assert.equal(reimport.importContinuation.saleId, first.importContinuation.saleId);
      const ledger = (
        await db.query(
          "select coalesce(sum(amount::numeric),0)::text paid,count(*)::int n from public.payments where customer_id=$1 and status='verified'",
          [first.customerId],
        )
      ).rows[0];
      assert.equal(Number(ledger.paid), Number(amount));
      assert.equal(ledger.n, payments.length);
      if (first.saleId) {
        const sale = (
          await db.query(
            'select origin,import_job_id,import_row_id from public.card_sales where id=$1',
            [first.saleId],
          )
        ).rows[0];
        assert.equal(sale.origin, 'legacy_import');
        assert.equal(sale.import_job_id, job);
        assert.equal(sale.import_row_id, row);
        assert.equal(
          (
            await db.query(
              'select count(*)::int n from public.card_sale_hierarchy_snapshots where sale_id=$1',
              [first.saleId],
            )
          ).rows[0].n,
          0,
        );
      }
      const holders = (
        await db.query(
          'select count(*)::int n from public.customer_application_holders where application_id=$1',
          [first.importContinuation.applicationId],
        )
      ).rows[0].n;
      assert.equal(holders, tier === 'GOLD' && status === 'Fully Paid' ? 2 : 1);
      for (const participant of ['vd', 'ssm', 'sm', 'referrer', 'recommender']) {
        const involved = (
          await db.query('select public.staff_sales_involvement($1,$2,100,0) result', [
            staff.actor,
            staff[participant],
          ])
        ).rows[0].result.filter((item) => item.customerId === first.customerId);
        assert.equal(involved.length, 1);
        assert.equal(involved[0].tier, tier);
      }
      const app = (
        await db.query(
          'select consent_acknowledged,primary_signature_status,acknowledged_at from public.customer_applications where id=$1',
          [first.importContinuation.applicationId],
        )
      ).rows[0];
      assert.equal(app.consent_acknowledged, existingHistory);
      assert.equal(app.primary_signature_status, existingHistory ? 'received' : 'pending');
      if (existingHistory) {
        assert.equal(first.importContinuation.reservationId, existingReservation);
        assert.deepEqual(
          (
            await db.query('select to_jsonb(p) value from public.payments p where id=$1', [
              existingPayment,
            ])
          ).rows[0].value,
          paymentSnapshot,
        );
      } else assert.equal(app.acknowledged_at, null);
      assert.equal(
        (
          await db.query('select count(*)::int n from public.memberships where customer_id=$1', [
            first.customerId,
          ])
        ).rows[0].n,
        0,
      );
      await assert.rejects(
        db.query(
          "update private.customer_external_import_receipts set reason='replaced history' where application_id=$1",
          [first.importContinuation.applicationId],
        ),
        /IMMUTABLE/,
      );
      await assert.rejects(
        db.query('select public.commit_external_customer_import_row($1,$2,$3)', [
          row,
          staff.referrer,
          normalized.externalReason,
        ]),
        /PERMISSION|FORBIDDEN|IMPORT_SOURCE|NOT_ALLOWED|ACCESS|ACTOR/i,
      );
      if (tier === 'BRONZE' && status === 'Partially Paid') {
        const reservation = first.importContinuation.reservationId;
        const payment = (
          await db.query('select public.record_reservation_payment_once($1,$2,$3,$4) id', [
            randomUUID(),
            reservation,
            { amount: '30000.00', paymentType: 'full', method: 'cash', reference: randomUUID() },
            staff.actor,
          ])
        ).rows[0].id;
        const beforeVerification = (
          await db.query('select record from public.customer_directory($1)', [
            { id: first.customerId },
          ])
        ).rows[0].record;
        assert.equal(
          Number(beforeVerification.verified_paid),
          30000,
          'Recorded payments must not reduce a verified balance',
        );
        await db.query("select public.verify_purchase_payment_once($1,$2,'verified',null,$3)", [
          randomUUID(),
          payment,
          staff.actor,
        ]);
        const sale = (
          await db.query('select public.finalize_reservation_purchase_once($1,$2,$3) id', [
            randomUUID(),
            reservation,
            staff.actor,
          ])
        ).rows[0].id;
        assert.equal(
          (await db.query('select origin from public.card_sales where id=$1', [sale])).rows[0]
            .origin,
          'legacy_import',
        );
        const continued = (
          await db.query('select public.preview_customer_import_continuation($1,$2) result', [
            row,
            staff.actor,
          ])
        ).rows[0].result;
        assert.equal(continued.stage, 'activation');
        assert.equal(continued.externalSummary.balance, '0.00');
        assert.equal(continued.externalSummary.paid, total);
        const afterFinalization = (
          await db.query('select record from public.customer_directory($1)', [
            { id: first.customerId },
          ])
        ).rows[0].record;
        assert.equal(Number(afterFinalization.verified_paid), Number(total));
        assert.equal(
          Number(afterFinalization.frozen_total),
          Number(total),
          'Finalized reservations must not be counted again beside their sale',
        );
        assert.equal(Number(afterFinalization.open_reservation_total), 0);
      }
      console.log(
        JSON.stringify({
          tier,
          status,
          stage,
          paid: amount,
          retryReusedRecords: true,
          noInventedConsent: true,
        }),
      );
    }
  }
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','public.customer_directory(jsonb)','execute') or has_function_privilege('authenticated','public.customer_directory(jsonb)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_function_privilege('anon','public.commit_external_customer_import_row(uuid,uuid,text)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  assert.equal(
    (
      await db.query(
        "select has_table_privilege('authenticated','private.customer_external_import_receipts','select') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const normalFixtures = await makePurchaseFixtures(db, {
    actor: staff.actor,
    createdCustomers: [],
    createdApplications: [],
  });
  const normal = await normalFixtures.executed();
  const normalPayment = (
    await db.query('select public.record_reservation_payment_once($1,$2,$3,$4) id', [
      randomUUID(),
      normal.reservationId,
      { amount: normal.total, paymentType: 'full', method: 'cash' },
      staff.actor,
    ])
  ).rows[0].id;
  await db.query("select public.verify_purchase_payment_once($1,$2,'verified',null,$3)", [
    randomUUID(),
    normalPayment,
    staff.actor,
  ]);
  const normalSale = (
    await db.query('select public.finalize_reservation_purchase_once($1,$2,$3) id', [
      randomUUID(),
      normal.reservationId,
      staff.actor,
    ])
  ).rows[0].id;
  assert.equal(
    (await db.query('select origin from public.card_sales where id=$1', [normalSale])).rows[0]
      .origin,
    'normal',
  );
  await assert.rejects(
    db.query('select public.save_customer_application(null,$1,$2,$3,null)', [
      staff.actor,
      {
        customerId: normal.customerId,
        planId: normalFixtures.plan.id,
        paymentScheme: 'spot_cash',
        consentAcknowledged: false,
        acknowledgedAt: null,
        primarySignatureStatus: 'pending',
      },
      {
        firstName: 'Synthetic',
        lastName: 'Normal',
        birthDate: '1990-01-01',
        permanentAddressLine1: 'Synthetic address',
        province: 'Laguna',
        cityMunicipality: 'Calamba',
        mobile: '09175550001',
        email: 'normal@example.invalid',
        printedName: 'Synthetic Normal',
      },
    ]),
    /APPLICATION_ACKNOWLEDGMENT_REQUIRED/,
  );
  console.log('External customer import: PASS (local disposable PostgreSQL only).');
} finally {
  await postgres.stop();
}
