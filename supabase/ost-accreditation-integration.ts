import { randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { readFileSync } from 'node:fs';

export async function runOstAccreditationChecks({
  db,
  url,
  actor,
  sponsor,
  run,
  check,
}: {
  db: Client;
  url: string;
  actor: string;
  sponsor: string;
  run: string;
  check: (label: string, ok: boolean, detail?: string) => void;
}) {
  const member = randomUUID();
  const alternate = randomUUID();
  const applications: string[] = [];
  const terms: string[] = [];
  const renewals: string[] = [];
  const jobs: string[] = [];
  const codes: string[] = [];
  const scalar = async (sql: string, args: unknown[] = []) =>
    (await db.query<{ id: string }>(sql, args)).rows[0]!.id;
  const count = async (sql: string, args: unknown[] = []) =>
    (await db.query<{ n: number }>(sql, args)).rows[0]!.n;
  const refused = async (name: string, sql: string, args: unknown[], expected: RegExp) => {
    try {
      await db.query(sql, args);
      check(name, false, 'unexpected success');
    } catch (error) {
      check(
        name,
        error instanceof Error && expected.test(error.message),
        error instanceof Error ? error.message : 'unknown',
      );
    }
  };
  const form = {
    dateApplied: '2026-10-01',
    programCategory: 'non_vip',
    vipCardType: null,
    sex: 'male',
    civilStatus: 'single',
    governmentIdType: 'QA TEST',
    governmentIdNumber: 'SYNTHETIC-PRIVATE-ID',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
    applicantSignedOn: '2026-10-01',
    referrerSignedOn: '2026-10-01',
  };
  const identity = (tag: string) => ({
    firstName: 'QA',
    lastName: 'ACCREDITATION',
    email: `${run}-${tag}@example.invalid`,
    phone: `+63917${tag === 'main' ? '7777001' : '7777002'}`,
    birthDate: '1990-01-01',
    address: { line1: 'QA STREET', city: 'QA CITY', province: 'QA PROVINCE', countryCode: 'PH' },
  });
  try {
    // A transaction-scoped synthetic customer proves the new consolidation
    // path without leaving master, application, sale or reservation fixtures.
    await db.query('begin');
    try {
      const plan = (
        await db.query<{ id: string }>("select id from public.card_plans where code='BRONZE'")
      ).rows[0]!.id;
      const primary = {
        firstName: 'QA',
        lastName: 'CONSOLIDATION',
        birthDate: '1990-01-01',
        mobile: '+639177777003',
        email: `${run}-consolidation@example.invalid`,
        permanentAddressLine1: 'QA STREET',
        cityMunicipality: 'QA CITY',
        province: 'QA PROVINCE',
        printedName: 'QA CONSOLIDATION',
      };
      const header = {
        planId: plan,
        paymentScheme: 'spot_cash',
        acquisitionChannels: ['Referral'],
        consentAcknowledged: true,
        acknowledgedAt: '2026-10-01',
        primarySignatureStatus: 'received',
        validIdReceived: true,
        reservationPaymentProofReceived: false,
      };
      const request = randomUUID();
      const sql = 'select public.register_customer_application_once($1,$2,$3,$4,null) id';
      const application = await scalar(sql, [request, actor, header, primary]);
      const customer = await scalar(
        'select customer_id id from public.customer_applications where id=$1',
        [application],
      );
      check(
        'Customer Application atomically creates one prospect master',
        (await count(
          "select count(*)::int n from public.customers where id=$1 and status='prospect' and auth_user_id is null",
          [customer],
        )) === 1,
      );
      check(
        'consolidated customer registration retry returns original application',
        (await scalar(sql, [request, actor, header, primary])) === application,
      );
      await db.query('savepoint duplicate_customer');
      await refused(
        'same email is a conflict, never an automatic identity merge',
        sql,
        [randomUUID(), actor, header, primary],
        /CUSTOMER_EMAIL_CONFLICT/,
      );
      await db.query('rollback to savepoint duplicate_customer');
      const sale = randomUUID();
      await db.query(
        `insert into public.card_sales(id,sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,cash_price_snapshot,minimum_down_payment_snapshot,yearly_points_snapshot,commission_rate_snapshot,expected_commission_snapshot,status,created_by,balance_due_at)
        select $1::uuid,'QA-'||($1::uuid)::text,$2::uuid,id,'staff',$3::uuid,cash_price,cash_price,minimum_down_payment,yearly_points,commission_rate,'0.00','draft',$3,now()+interval '365 days' from public.card_plans where id=$4`,
        [sale, customer, actor, plan],
      );
      const input = {
        saleId: sale,
        customerApplicationId: application,
        reservationDate: '2026-10-01',
        agreementDate: '2026-10-01',
        primarySignatureStatus: 'received',
      };
      const reserve =
        "select public.reserve_from_customer_application_once($1,$2,$3,$4,null,'[]') id";
      await db.query('savepoint draft_source');
      await refused(
        'reservation rejects a draft application source',
        reserve,
        [randomUUID(), actor, input, {}],
        /APPLICATION_NOT_ELIGIBLE/,
      );
      await db.query('rollback to savepoint draft_source');
      await db.query(
        "update public.customer_applications set status='submitted',submitted_at=now() where id=$1",
        [application],
      );
      const reservationRequest = randomUUID();
      const reservation = await scalar(reserve, [
        reservationRequest,
        actor,
        input,
        { name: 'FORGED CLIENT HOLDER' },
      ]);
      check(
        'reservation derives the frozen application holder, not client replacement',
        (await count(
          "select count(*)::int n from public.reservation_agreement_holders where agreement_id=$1 and name='QA CONSOLIDATION'",
          [reservation],
        )) === 1,
      );
      check(
        'reservation preserves application linkage and all benefit snapshots',
        (await count(
          `select count(*)::int n from public.reservation_agreements r join public.customer_applications a on a.id=r.customer_application_id where r.id=$1 and r.discount_percent_snapshot=a.discount_percent_snapshot and r.validity_years_snapshot=a.validity_years_snapshot and r.yearly_points_snapshot=a.yearly_points_snapshot and r.annual_points_tranches_snapshot=a.annual_points_tranches_snapshot and r.holder_limit_snapshot=a.holder_limit_snapshot`,
          [reservation],
        )) === 1,
      );
      check(
        'application reservation retry returns one reservation',
        (await scalar(reserve, [reservationRequest, actor, input, {}])) === reservation,
      );
      check(
        'reservation creates no duplicate customer master',
        (await count('select count(*)::int n from public.customers where email=$1', [
          primary.email,
        ])) === 1,
      );
    } finally {
      await db.query('rollback');
    }
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
      member,
      identity('main').email,
      alternate,
      `${run}-alternate-sm@example.invalid`,
    ]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'QA ALTERNATE SM','active')",
      [alternate, `${run}-alternate-sm@example.invalid`],
    );
    await db.query(
      "insert into public.staff_role_assignments(staff_id,role_id,assigned_by) select $1,id,$2 from public.roles where slug='sales_manager'",
      [alternate, actor],
    );
    const request = randomUUID();
    const submit = "select public.submit_ost_accreditation($1,$2,$3,null,$4,$5,'manual') id";
    const app = await scalar(submit, [request, actor, sponsor, identity('main'), form]);
    applications.push(app);
    check(
      'official registration creates pending application',
      (await count(
        "select count(*)::int n from public.ost_applications where id=$1 and status='submitted'",
        [app],
      )) === 1,
    );
    check(
      'private official details retain required ID',
      (await count(
        "select count(*)::int n from private.ost_registration_details where application_id=$1 and official_details->>'governmentIdNumber'='SYNTHETIC-PRIVATE-ID'",
        [app],
      )) === 1,
    );
    check(
      'registration retry returns the original application',
      (await scalar(submit, [request, actor, sponsor, identity('main'), form])) === app,
    );
    await refused(
      'registration same-key payload change refused',
      submit,
      [request, actor, alternate, identity('main'), form],
      /PAYLOAD_CONFLICT/,
    );
    await refused(
      'non-SM sponsor refused',
      submit,
      [randomUUID(), actor, actor, identity('invalid'), form],
      /ACTIVE_SM_REQUIRED/,
    );
    const approve = 'select public.install_ost_accreditation_identity($1,$2,$3,$4,$5) id';
    await refused(
      'approval before endorsement rolls back identity',
      approve,
      [app, actor, member, '2026-10-01', '2027-10-01'],
      /ENDORSEMENT_REQUIRED/,
    );
    check(
      'failed approval leaves no staff/member identity',
      (await count('select count(*)::int n from public.staff_users where id=$1', [member])) === 0,
    );
    await db.query('select public.endorse_ost_accreditation($1,$2)', [app, sponsor]);
    const clients = [new Client({ connectionString: url }), new Client({ connectionString: url })];
    try {
      await Promise.all(clients.map((c) => c.connect()));
      const approved = await Promise.all(
        clients.map((c) =>
          c.query<{ id: string }>(approve, [app, actor, member, '2026-10-01', '2027-10-01']),
        ),
      );
      const term = approved[0]!.rows[0]!.id;
      terms.push(term);
      check('concurrent approvals return one term', approved[1]!.rows[0]!.id === term);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
    check(
      'initial term records explicitly approved dates',
      (await count(
        "select count(*)::int n from private.ost_accreditation_terms where ost_id=$1 and starts_on='2026-10-01' and expires_on='2027-10-01'",
        [member],
      )) === 1,
    );
    check(
      'approval audit is written exactly once',
      (await count(
        "select count(*)::int n from public.audit_events where entity_id=$1 and action='OST_ACCREDITATION_APPROVED'",
        [app],
      )) === 1,
    );
    await db.query("update public.staff_users set status='active' where id=$1", [member]);
    const renewalInput = {
      dateOfRenewal: '2026-10-01',
      requestedStart: '2027-10-02',
      requestedEnd: '2028-10-01',
      proposedNewSponsorStaffId: alternate,
      reasonForReferrerChange: 'QA management reviewed change',
      applicantSignatureStatus: 'received',
      referrerSignatureStatus: 'received',
    };
    const renew = await scalar('select public.submit_ost_renewal($1,$2,$3,$4) id', [
      randomUUID(),
      member,
      member,
      renewalInput,
    ]);
    renewals.push(renew);
    check('self renewal needs ownership, not staff review grants', Boolean(renew));
    check(
      'pending referrer change retains current sponsor',
      (await count(
        'select count(*)::int n from public.ost_members where id=$1 and sponsor_staff_id=$2',
        [member, sponsor],
      )) === 1,
    );
    await db.query(
      "select public.decide_ost_renewal($1,$2,'request-changes','QA signature review')",
      [renew, actor],
    );
    await db.query('select public.revise_ost_renewal($1,$2,$3)', [renew, member, renewalInput]);
    check(
      'owned renewal revision returns to review without changing sponsor',
      (await count(
        "select count(*)::int n from private.ost_accreditation_renewals r join public.ost_members m on m.id=r.ost_id where r.id=$1 and r.status='under_review' and r.endorsed_at is null and m.sponsor_staff_id=$2",
        [renew, sponsor],
      )) === 1,
    );
    await db.query("select public.decide_ost_renewal($1,$2,'endorse')", [renew, sponsor]);
    const term2 = await scalar("select public.decide_ost_renewal($1,$2,'approve') id", [
      renew,
      actor,
    ]);
    terms.push(term2);
    check('renewal creates a new term', term2 !== terms[0]);
    check(
      'prior validity dates remain unchanged',
      (await count(
        "select count(*)::int n from private.ost_accreditation_terms where id=$1 and status='superseded' and starts_on='2026-10-01' and expires_on='2027-10-01'",
        [terms[0]],
      )) === 1,
    );
    check(
      'approved referrer change updates current sponsor',
      (await count(
        'select count(*)::int n from public.ost_members where id=$1 and sponsor_staff_id=$2',
        [member, alternate],
      )) === 1,
    );
    check(
      'approved change installs one authoritative active edge',
      (await count(
        'select count(*)::int n from public.referral_relationships where subject_staff_id=$1 and upline_staff_id=$2 and is_active',
        [member, alternate],
      )) === 1,
    );
    check(
      'renewal approval retry is stable',
      (await scalar("select public.decide_ost_renewal($1,$2,'approve') id", [renew, actor])) ===
        term2,
    );
    check(
      'referrer change audit occurs once',
      (await count(
        "select count(*)::int n from public.audit_events where entity_id=$1 and action='OST_REFERRER_CHANGED'",
        [member],
      )) === 1,
    );
    const rejected = await scalar('select public.submit_ost_renewal($1,$2,$3,$4) id', [
      randomUUID(),
      member,
      member,
      { ...renewalInput, proposedNewSponsorStaffId: sponsor },
    ]);
    renewals.push(rejected);
    await db.query("select public.decide_ost_renewal($1,$2,'reject','QA rejected renewal')", [
      rejected,
      actor,
    ]);
    check(
      'rejected renewal retains current sponsor and term',
      (await count(
        "select count(*)::int n from public.ost_members m join private.ost_accreditation_terms t on t.ost_id=m.id where m.id=$1 and m.sponsor_staff_id=$2 and t.id=$3 and t.status='active'",
        [member, alternate, term2],
      )) === 1,
    );
    const publicCode = await scalar(
      "insert into public.referral_codes(code_hash,code_hint,sponsor_staff_id,expires_at,max_uses,use_count,is_active,created_by) values(encode(digest(gen_random_uuid()::text,'sha256'),'hex'),'QA-PUBLIC',$1,now()+interval '1 day',1,0,true,$2) returning id",
      [sponsor, actor],
    );
    codes.push(publicCode);
    const publicRequest = randomUUID();
    const publicIdentity = { ...identity('public'), phone: '+639177777004' };
    const publicForm = {
      ...form,
      applicantSignatureStatus: 'pending',
      referrerSignatureStatus: 'pending',
      applicantSignedOn: null,
      referrerSignedOn: null,
    };
    const publicSql = "select public.submit_ost_accreditation($1,null,$2,$3,$4,$5,'public') id";
    const publicApp = await scalar(publicSql, [
      publicRequest,
      sponsor,
      publicCode,
      publicIdentity,
      publicForm,
    ]);
    applications.push(publicApp);
    check(
      'public official registration freezes the code-resolved sponsor',
      (await count(
        'select count(*)::int n from public.ost_applications where id=$1 and sponsor_staff_id=$2 and referral_code_id=$3',
        [publicApp, sponsor, publicCode],
      )) === 1,
    );
    check(
      'public registration retry is stable after using the last code allowance',
      (await scalar(publicSql, [
        publicRequest,
        sponsor,
        publicCode,
        publicIdentity,
        publicForm,
      ])) === publicApp,
    );
    check(
      'public retry consumes the referral allowance exactly once',
      (await count(
        'select count(*)::int n from public.referral_codes where id=$1 and use_count=1',
        [publicCode],
      )) === 1,
    );
    await refused(
      'exhausted public code cannot create another application',
      publicSql,
      [randomUUID(), sponsor, publicCode, publicIdentity, publicForm],
      /INVALID_REFERRAL_CODE/,
    );
    await db.query('select public.confirm_ost_application_signatures($1,$2,$3,$4)', [
      publicApp,
      sponsor,
      '2026-10-01',
      '2026-10-01',
    ]);
    await db.query('select public.endorse_ost_accreditation($1,$2)', [publicApp, sponsor]);
    check(
      'paper signature confirmation and SM endorsement remain separate durable steps',
      (await count(
        "select count(*)::int n from private.ost_registration_details where application_id=$1 and applicant_signature_status='received' and referrer_signature_status='received' and endorsed_by=$2 and endorsed_at is not null",
        [publicApp, sponsor],
      )) === 1,
    );
    check(
      'public signature/endorsement creates no account or approved term',
      (await count('select count(*)::int n from public.ost_members where application_id=$1', [
        publicApp,
      ])) === 0,
    );
    const staged = [
      {
        rowNumber: 2,
        sponsorStaffId: sponsor,
        normalized: { identity: identity('import'), form },
        status: 'valid',
        errors: [],
      },
      {
        rowNumber: 3,
        sponsorStaffId: null,
        normalized: {},
        status: 'error',
        errors: ['Invalid sponsor'],
      },
    ];
    const job = await scalar("select public.stage_ost_import($1,'csv','qa.csv',null,$2) id", [
      actor,
      JSON.stringify(staged),
    ]);
    jobs.push(job);
    const preview = (
      await db.query<{ data: unknown }>('select public.ost_import_preview($1,$2) data', [
        actor,
        job,
      ])
    ).rows[0]!.data;
    check(
      'import preview never exposes full government ID',
      !JSON.stringify(preview).includes('SYNTHETIC-PRIVATE-ID'),
    );
    await db.query('select public.confirm_ost_import($1,$2)', [actor, job]);
    const imported = await scalar(
      "select application_id id from private.ost_import_rows where job_id=$1 and status='committed'",
      [job],
    );
    applications.push(imported);
    check(
      'import creates pending application only',
      (await count(
        "select count(*)::int n from public.ost_applications where id=$1 and status='submitted'",
        [imported],
      )) === 1,
    );
    check(
      'import does not create account or term',
      (await count('select count(*)::int n from public.ost_members where application_id=$1', [
        imported,
      ])) === 0 &&
        (await count(
          'select count(*)::int n from private.ost_accreditation_terms where application_id=$1',
          [imported],
        )) === 0,
    );
    await db.query('select public.confirm_ost_import($1,$2)', [actor, job]);
    check(
      'import confirmation retry does not duplicate applications',
      (await count(
        "select count(*)::int n from private.ost_import_rows where job_id=$1 and status='committed'",
        [job],
      )) === 1,
    );
    const records = (
      await db.query<{ data: unknown }>('select public.ost_accreditation_records($1,$2,$3) data', [
        member,
        member,
        app,
      ])
    ).rows[0]!.data;
    check(
      'self history response never exposes full ID',
      !JSON.stringify(records).includes('SYNTHETIC-PRIVATE-ID'),
    );
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.query(`set role ${role}`);
      try {
        for (const table of [
          'ost_registration_details',
          'ost_accreditation_terms',
          'ost_accreditation_renewals',
          'ost_import_jobs',
          'ost_import_rows',
        ])
          await refused(
            `${role} cannot directly read private ${table}`,
            `select * from private.${table}`,
            [],
            /permission denied/,
          );
      } finally {
        await db.query('reset role');
      }
    }
    const acl = await db.query(readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
    check(
      'post-accreditation RLS/private ACL audit has zero violations',
      (Array.isArray(acl) ? acl : [acl]).every((r) => r.rows.length === 0),
    );
  } finally {
    await db.query('reset role');
    await db.query('begin');
    try {
      await db.query("set local afhomes.allow_snapshot_maintenance='on'");
      await db.query('delete from public.audit_events where entity_id=any($1::text[])', [
        [...applications, ...terms, ...renewals, ...jobs, member],
      ]);
      await db.query('delete from private.ost_import_rows where job_id=any($1::uuid[])', [jobs]);
      await db.query('delete from private.ost_import_jobs where id=any($1::uuid[])', [jobs]);
      // Terms reference renewals and renewals reference prior terms: reverse
      // transaction history is the safe cleanup order in this disposable DB.
      await db.query(
        "delete from private.ost_accreditation_renewals where id=any($1::uuid[]) and status<>'approved'",
        [renewals],
      );
      for (const term of [...terms].reverse()) {
        await db.query('delete from private.ost_accreditation_terms where id=$1', [term]);
        await db.query(
          'delete from private.ost_accreditation_renewals where ost_id=$1 and prior_term_id<>$2',
          [member, term],
        );
      }
      await db.query('delete from private.ost_accreditation_renewals where ost_id=$1', [member]);
      await db.query('delete from private.ost_accreditation_terms where ost_id=$1', [member]);
      await db.query(
        'delete from private.ost_registration_details where application_id=any($1::uuid[])',
        [applications],
      );
      await db.query(
        'delete from public.referral_relationships where subject_staff_id=any($1::uuid[])',
        [[member, alternate]],
      );
      await db.query('delete from public.ost_members where id=$1', [member]);
      await db.query('delete from public.ost_applications where id=any($1::uuid[])', [
        applications,
      ]);
      await db.query('delete from public.referral_codes where id=any($1::uuid[])', [codes]);
      await db.query(
        "delete from public.referral_codes where code_hint='MANUAL' and id not in(select referral_code_id from public.ost_applications) and created_by=$1",
        [actor],
      );
      await db.query('delete from public.staff_invitations where auth_user_id=$1', [member]);
      await db.query('delete from public.staff_users where id=any($1::uuid[])', [
        [member, alternate],
      ]);
      await db.query('delete from auth.users where id=any($1::uuid[])', [[member, alternate]]);
      await db.query('commit');
    } catch (error) {
      await db.query('rollback');
      throw error;
    }
  }
}
