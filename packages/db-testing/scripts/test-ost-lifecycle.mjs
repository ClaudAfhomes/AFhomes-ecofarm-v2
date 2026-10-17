import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { startDisposablePostgres } from './lib/local-postgres.mjs';

// No env-file loading or remote target: this helper always creates loopback PostgreSQL.
const postgres = await startDisposablePostgres();
const raceClients = [];
let checks = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
try {
  const db = postgres.client;
  check(
    ['127.0.0.1', '::1'].includes(
      (await db.query('select host(inet_server_addr()) host')).rows[0].host,
    ),
    true,
  );
  const ids = {};
  for (const role of ['super_admin', 'vice_director', 'senior_sales_manager', 'sales_manager']) {
    const id = (ids[role] = randomUUID());
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC OST TEST','active')",
      [id, `${id}@example.invalid`],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
  }
  for (const [child, parent] of [
    ['senior_sales_manager', 'vice_director'],
    ['sales_manager', 'senior_sales_manager'],
  ]) {
    await db.query(
      'insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,assigned_by) values($1,$2,$3,$4)',
      [ids[child], ids[parent], child, ids.super_admin],
    );
  }
  for (const role of ['vice_director', 'senior_sales_manager', 'sales_manager']) {
    check(
      (await db.query('select private.ost_active_sponsor($1) result', [ids[role]])).rows[0].result
        .staffId,
      ids[role],
    );
  }
  check(
    (await db.query('select private.ost_manual_sponsor($1) result', [ids.sales_manager])).rows[0]
      .result.staffId,
    ids.sales_manager,
  );
  await assert.rejects(
    db.query('select private.ost_manual_sponsor($1)', [ids.senior_sales_manager]),
    /OST_ACTIVE_SM_REQUIRED/,
  );
  checks++;
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.submit_ost_accreditation(uuid,uuid,uuid,uuid,jsonb,jsonb,text)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const form = {
    dateApplied: '2020-01-01',
    programCategory: 'non_vip',
    sex: 'male',
    civilStatus: 'single',
    governmentIdType: 'passport',
    governmentIdNumber: 'SYNTHETIC',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
    applicantSignedOn: '2020-01-01',
    referrerSignedOn: '2020-01-01',
  };
  const ost = randomUUID();
  const identity = {
    firstName: 'SYNTHETIC',
    lastName: 'OST',
    email: `${ost}@example.invalid`,
    phone: '+639171234567',
    birthDate: '1990-01-01',
    address: { line1: 'SYNTHETIC', city: 'QA', province: 'QA', countryCode: 'PH' },
  };
  const app = (
    await db.query("select public.submit_ost_accreditation($1,$2,$3,null,$4,$5,'manual') id", [
      randomUUID(),
      ids.super_admin,
      ids.sales_manager,
      identity,
      form,
    ])
  ).rows[0].id;
  await db.query('select public.endorse_ost_accreditation($1,$2)', [app, ids.sales_manager]);
  await db.query('insert into auth.users(id,email) values($1,$2)', [ost, identity.email]);
  await db.query(
    "select public.install_ost_accreditation_identity($1,$2,$3,current_date-1,(current_date-1+interval '1 year')::date)",
    [app, ids.super_admin, ost],
  );
  await assert.rejects(
    db.query('update public.ost_members set sponsor_staff_id=$1 where id=$2', [
      ids.vice_director,
      ost,
    ]),
    /OST_ACCREDITATION_EXPIRED_REQUIRED/,
  );
  checks++;
  await assert.rejects(
    db.query(
      'update public.referral_relationships set upline_staff_id=$1 where subject_staff_id=$2 and is_active',
      [ids.vice_director, ost],
    ),
    /OST_ACCREDITATION_EXPIRED_REQUIRED/,
  );
  checks++;
  check(
    (await db.query('select sponsor_staff_id from public.ost_members where id=$1', [ost])).rows[0]
      .sponsor_staff_id,
    ids.sales_manager,
  );
  await assert.rejects(
    db.query(
      "update public.staff_role_assignments set role_id=(select id from public.roles where slug='sales_manager') where staff_id=$1",
      [ost],
    ),
    /OST_ROLE_WORKFLOW_REQUIRED/,
  );
  checks++;
  await assert.rejects(
    db.query('delete from public.staff_role_assignments where staff_id=$1', [ost]),
    /OST_ROLE_WORKFLOW_REQUIRED/,
  );
  checks++;
  await assert.rejects(
    db.query(
      "update public.staff_role_assignments set role_id=(select id from public.roles where slug='ost') where staff_id=$1",
      [ids.sales_manager],
    ),
    /OST_ROLE_WORKFLOW_REQUIRED/,
  );
  checks++;
  await assert.rejects(
    db.query(
      'update public.referral_relationships set is_authoritative=false where subject_staff_id=$1 and is_active',
      [ost],
    ),
    /OST_GENEALOGY_HISTORY_IMMUTABLE/,
  );
  checks++;
  const eligible = (
    await db.query('select public.list_ost_manual_sponsors($1) result', [ids.super_admin])
  ).rows[0].result;
  check(
    eligible.map((s) => s.id),
    [ids.sales_manager],
  );
  const otherSm = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    otherSm,
    `${otherSm}@example.invalid`,
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC NEW SM','active')",
    [otherSm, `${otherSm}@example.invalid`],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='sales_manager'",
    [otherSm],
  );
  await db.query(
    "insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,assigned_by) values($1,$2,'sales_manager',$3)",
    [otherSm, ids.senior_sales_manager, ids.super_admin],
  );
  const expired = randomUUID();
  const expiredIdentity = {
    ...identity,
    email: `${expired}@example.invalid`,
    phone: '+639171234568',
  };
  const expiredApp = (
    await db.query("select public.submit_ost_accreditation($1,$2,$3,null,$4,$5,'manual') id", [
      randomUUID(),
      ids.super_admin,
      ids.sales_manager,
      expiredIdentity,
      form,
    ])
  ).rows[0].id;
  await db.query('select public.endorse_ost_accreditation($1,$2)', [expiredApp, ids.sales_manager]);
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    expired,
    expiredIdentity.email,
  ]);
  await db.query(
    "select public.install_ost_accreditation_identity($1,$2,$3,'2024-01-01','2025-01-01')",
    [expiredApp, ids.super_admin, expired],
  );
  await assert.rejects(
    db.query('update public.ost_members set sponsor_staff_id=$1 where id=$2', [otherSm, expired]),
    /OST_TRANSFER_APPROVAL_REQUIRED/,
  );
  checks++;
  const input = {
    requestId: randomUUID(),
    dateOfRenewal: '2026-10-17',
    requestedStart: '2026-10-17',
    requestedEnd: '2027-10-17',
    proposedNewSponsorStaffId: otherSm,
    reasonForReferrerChange: 'SYNTHETIC TRANSFER REQUEST',
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
  };
  await assert.rejects(
    db.query('select public.submit_ost_renewal($1,$2,$3,$4)', [
      randomUUID(),
      ids.super_admin,
      expired,
      { ...input, requestedEnd: '2028-10-17' },
    ]),
    /OST_ANNUAL_VALIDITY_REQUIRED/,
  );
  checks++;
  const renewal = (
    await db.query('select public.submit_ost_renewal($1,$2,$3,$4) id', [
      input.requestId,
      ids.super_admin,
      expired,
      input,
    ])
  ).rows[0].id;
  await db.query("select public.decide_ost_renewal($1,$2,'endorse','')", [
    renewal,
    ids.sales_manager,
  ]);
  const term = (
    await db.query("select public.decide_ost_renewal($1,$2,'approve','') id", [
      renewal,
      ids.super_admin,
    ])
  ).rows[0].id;
  check(
    (await db.query('select sponsor_staff_id from public.ost_members where id=$1', [expired]))
      .rows[0].sponsor_staff_id,
    otherSm,
  );
  check(
    (
      await db.query("select public.decide_ost_renewal($1,$2,'approve','') id", [
        renewal,
        ids.super_admin,
      ])
    ).rows[0].id,
    term,
  );
  await assert.rejects(
    db.query(
      "update private.ost_accreditation_renewals set last_expiry_date='2000-01-01' where id=$1",
      [renewal],
    ),
    /OST_RENEWAL_HISTORY_IMMUTABLE/,
  );
  checks++;
  await assert.rejects(
    db.query("update private.ost_accreditation_terms set expires_on='2099-01-01' where id=$1", [
      term,
    ]),
    /OST_TERM_HISTORY_IMMUTABLE/,
  );
  checks++;

  // --- IST -> OST conversion (user request Phase 3) ---
  const profileSql = `insert into public.network_member_profiles(staff_id,date_of_birth,sex,civil_status,street_no,city_municipality,province,zip_code,mobile_no,employer_name,employer_address,job_position,government_id_type,government_id_number)
    values($1,'1990-01-01','Male','Single','1 SYNTHETIC','QA','QA','0000',$2,'SYNTHETIC','QA','QA','passport','SYNTHETIC')`;
  const addIst = async (role, aa, upline, phone) => {
    const id = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@example.invalid`]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC IST','active')",
      [id, `${id}@example.invalid`],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    if (upline) await db.query(
      'insert into public.referral_relationships(subject_staff_id,upline_staff_id,hierarchy_role,assigned_by) values($1,$2,$3,$4)',
      [id, upline, role, ids.super_admin],
    );
    await db.query(profileSql, [id, phone]);
    if (role !== 'ost')
      await db.query(
        "select public.manage_sale_team_accreditation($1,$2,'IST','approve','2020-01-01','2021-01-01',$3)",
        [ids.super_admin, id, aa],
      );
    return id;
  };
  check(
    (
      await db.query(
        "select 1 from public.role_permissions rp join public.roles r on r.id=rp.role_id join public.modules m on m.id=rp.module_id where r.slug='senior_sales_manager' and m.key='network.ost_registrations' and rp.can_view",
      )
    ).rowCount,
    1,
  );
  // Exercise develop's existing transfer RPC, not a parallel conversion endpoint.
  const transferSql =
    'select public.transfer_sale_team_member($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) result';
  const transferArgs = async (person, request = randomUUID(), extra = {}) => {
    const profile = (await db.query('select email from public.staff_users where id=$1', [person]))
      .rows[0];
    const phone = (
      await db.query('select mobile_no from public.network_member_profiles where staff_id=$1', [
        person,
      ])
    ).rows[0].mobile_no;
    return [
      ids.super_admin,
      person,
      'IST_TO_OST',
      'Synthetic approved conversion',
      request,
      null,
      null,
      ids.sales_manager,
      { ...identity, email: profile.email, phone },
      form,
      extra.start ?? '2026-10-17',
      extra.end ?? '2027-10-17',
    ];
  };
  const integratedIst = await addIst(
    'sales_manager',
    'AAI26100071',
    ids.senior_sales_manager,
    '+639189990071',
  );
  const integratedArgs = await transferArgs(integratedIst);
  await assert.rejects(
    db.query(
      transferSql,
      integratedArgs.map((v, i) => (i === 0 ? ids.sales_manager : v)),
    ),
    /MUTATION_FORBIDDEN/,
  );
  checks++;
  await assert.rejects(
    db.query(transferSql, await transferArgs(integratedIst, randomUUID(), { end: '2028-10-17' })),
    /OST_ANNUAL_VALIDITY_REQUIRED/,
  );
  checks++;
  check((await db.query(transferSql, integratedArgs)).rows[0].result.aaNumber, 'AAO26100071');
  check(
    (await db.query('select private.staff_role_slug($1) role', [integratedIst])).rows[0].role,
    'ost',
  );
  check(
    (
      await db.query(
        'select aa_number,successor_aa_number from private.sale_team_accreditation_history where staff_id=$1',
        [integratedIst],
      )
    ).rows[0],
    { aa_number: 'AAI26100071', successor_aa_number: 'AAO26100071' },
  );
  await db.query(transferSql, integratedArgs);
  check(
    (
      await db.query('select count(*)::int n from private.ost_ist_conversions where staff_id=$1', [
        integratedIst,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    db.query(
      transferSql,
      integratedArgs.map((v, i) => (i === 3 ? 'Changed reason' : v)),
    ),
    /MUTATION_PAYLOAD_CONFLICT/,
  );
  checks++;
  await assert.rejects(
    db.query(transferSql, [
      ids.super_admin,
      integratedIst,
      'OST_TO_IST',
      'Synthetic reverse transfer',
      randomUUID(),
      'sales_manager',
      ids.senior_sales_manager,
      null,
      null,
      null,
      null,
      null,
    ]),
    /OST_ACCREDITATION_EXPIRED_REQUIRED/,
  );
  checks++;
  const blockedIst = await addIst(
    'sales_manager',
    'AAI26100072',
    ids.senior_sales_manager,
    '+639189990072',
  );
  const child = await addIst('ost', 'AAI26100073', blockedIst, '+639189990073');
  await assert.rejects(
    db.query(transferSql, await transferArgs(blockedIst)),
    /OST_CONVERSION_DOWNLINES_ACTIVE/,
  );
  checks++;
  check(
    (
      await db.query('select aa_number from private.sale_team_accreditations where staff_id=$1', [
        blockedIst,
      ])
    ).rows[0].aa_number,
    'AAI26100072',
  );
  await db.query(
    'update public.referral_relationships set is_active=false where subject_staff_id=$1',
    [child],
  );
  const rollbackArgs = await transferArgs(blockedIst);
  await db.query(`create function pg_temp.fail_transfer_audit() returns trigger language plpgsql as $$ begin
    if new.action='SALE_TEAM_ACCREDITATION_TRANSFERRED' then raise exception 'SYNTHETIC_TRANSFER_FAILURE'; end if; return new; end $$;
    create trigger synthetic_transfer_failure before insert on public.audit_events for each row execute function pg_temp.fail_transfer_audit()`);
  await assert.rejects(db.query(transferSql, rollbackArgs), /SYNTHETIC_TRANSFER_FAILURE/);
  checks++;
  check(
    (await db.query('select count(*)::int n from public.ost_members where id=$1', [blockedIst]))
      .rows[0].n,
    0,
  );
  check(
    (
      await db.query('select count(*)::int n from private.ost_ist_conversions where staff_id=$1', [
        blockedIst,
      ])
    ).rows[0].n,
    0,
  );
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_accreditation_history where staff_id=$1',
        [blockedIst],
      )
    ).rows[0].n,
    0,
  );
  check(
    (
      await db.query('select aa_number from private.sale_team_accreditations where staff_id=$1', [
        blockedIst,
      ])
    ).rows[0].aa_number,
    'AAI26100072',
  );
  await db.query('drop trigger synthetic_transfer_failure on public.audit_events');
  check((await db.query(transferSql, rollbackArgs)).rows[0].result.aaNumber, 'AAO26100072');
  const collision = await addIst('sales_manager','AAI26100074',ids.senior_sales_manager,'+639189990074');
  await db.query("insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by) values($1,'AAO26100074','SYNTHETIC COLLISION','OST','active','2026-01-01','2027-01-01',$2)",[child,ids.super_admin]);
  await assert.rejects(db.query(transferSql,await transferArgs(collision)),/ACCREDITATION_NUMBER_TAKEN/); checks++;
  check((await db.query('select aa_number from private.sale_team_accreditations where staff_id=$1',[collision])).rows[0].aa_number,'AAI26100074');
  check((await db.query('select count(*)::int n from public.ost_members where id=$1',[collision])).rows[0].n,0);

  const rootIst = await addIst('vice_director','AAI26100076',null,'+639189990076');
  check((await db.query(transferSql,await transferArgs(rootIst))).rows[0].result.aaNumber,'AAO26100076');
  check((await db.query('select from_upline_staff_id from private.ost_ist_conversions where staff_id=$1',[rootIst])).rows[0].from_upline_staff_id,null);
  // The operation CHECK must stay a forward-only union: an already-applied
  // database keeps rows for operations this batch never wrote, so the list may
  // grow but must never shrink.
  const operationCheck = (
    await db.query(
      "select pg_get_constraintdef(oid) def from pg_constraint where conrelid='private.mutation_requests'::regclass and conname='mutation_requests_operation_check'",
    )
  ).rows[0].def;
  for (const operation of [
    'payment.verify',
    'purchase_terms.review',
    'reservation.finalize',
    'membership.activate',
    'ost.convert',
    'ost.applicant.update',
    'sale_team.transfer',
  ])
    check(operationCheck.includes(`'${operation}'`), true);
  // --- Final install/AA issuance is atomic: no AA-less OST identity (Phase 8/10) ---
  await db.query(
    "update public.role_permissions set can_update=true from public.roles r, public.modules m where role_permissions.role_id=r.id and role_permissions.module_id=m.id and r.slug='senior_sales_manager' and m.key='network.ost_registrations'",
  );
  const guardIdentity = {
    ...identity,
    email: `guard-${ost}@example.invalid`,
    phone: '+639171234599',
  };
  const guardApp = (
    await db.query("select public.submit_ost_accreditation($1,$2,$3,null,$4,$5,'manual') id", [
      randomUUID(),
      ids.super_admin,
      ids.sales_manager,
      guardIdentity,
      form,
    ])
  ).rows[0].id;
  await db.query('select public.endorse_ost_accreditation($1,$2)', [guardApp, ids.sales_manager]);
  const guardOst = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [guardOst, guardIdentity.email]);
  await assert.rejects(
    db.query(
      "select public.install_ost_accreditation_identity($1,$2,$3,current_date-1,(current_date-1+interval '1 year')::date)",
      [guardApp, ids.senior_sales_manager, guardOst],
    ),
    /OST_AA_ISSUANCE_FORBIDDEN/,
  );
  checks++;
  check(
    (await db.query('select count(*)::int n from public.ost_members where id=$1', [guardOst]))
      .rows[0].n,
    0,
  );
  check(
    (await db.query('select status from public.ost_applications where id=$1', [guardApp])).rows[0]
      .status,
    'under_review',
  );
  await db.query(
    "select public.install_ost_accreditation_identity($1,$2,$3,current_date-1,(current_date-1+interval '1 year')::date)",
    [guardApp, ids.super_admin, guardOst],
  );
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_accreditations where staff_id=$1',
        [guardOst],
      )
    ).rows[0].n,
    1,
  );
  await db.query(
    "update public.role_permissions set can_update=false from public.roles r, public.modules m where role_permissions.role_id=r.id and role_permissions.module_id=m.id and r.slug='senior_sales_manager' and m.key='network.ost_registrations'",
  );
  // --- Controlled applicant edits (user request Phase 4.3) ---
  const addDays = (iso, n) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const addYear = (iso) => {
    const d = new Date(`${iso}T00:00:00Z`);
    const m = d.getUTCMonth();
    d.setUTCFullYear(d.getUTCFullYear() + 1);
    if (d.getUTCMonth() !== m) d.setUTCDate(0);
    return d.toISOString().slice(0, 10);
  };
  check(
    (await db.query('select private.ost_applicant_current($1) current', [ost])).rows[0].current
      .phone,
    '+639171234567',
  );
  const edit = (over) => ({
    requestId: randomUUID(),
    fullName: 'SYNTHETIC OST',
    birthDate: '1990-01-01',
    phone: '+639171234567',
    sex: 'male',
    civilStatus: 'single',
    messenger: '',
    employerName: '',
    jobPosition: '',
    reason: '',
    ...over,
  });
  await assert.rejects(
    db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
      randomUUID(),
      ids.senior_sales_manager,
      ost,
      edit({ phone: '+639170000009' }),
    ]),
    /MUTATION_FORBIDDEN/,
  );
  checks++;
  await assert.rejects(
    db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
      randomUUID(),
      ids.super_admin,
      randomUUID(),
      edit({ phone: '+639170000009' }),
    ]),
    /OST_IDENTITY_REQUIRED/,
  );
  checks++;
  const editInput = edit({
    phone: '+639170000009',
    civilStatus: 'married',
    reason: 'SYNTHETIC MARRIAGE RECORD',
  });
  await assert.rejects(
    db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
      randomUUID(),
      ids.super_admin,
      ost,
      { ...editInput, reason: '' },
    ]),
    /OST_APPLICANT_REASON_REQUIRED/,
  );
  checks++;
  check(
    (
      await db.query('select public.update_ost_applicant($1,$2,$3,$4) id', [
        editInput.requestId,
        ids.super_admin,
        ost,
        editInput,
      ])
    ).rows[0].id,
    ost,
  );
  check(
    (await db.query("select private.ost_applicant_current($1)->>'phone' p", [ost])).rows[0].p,
    '+639170000009',
  );
  check(
    (await db.query('select phone from public.ost_members where id=$1', [ost])).rows[0].phone,
    '+639171234567',
  );
  const change = (
    await db.query(
      'select changed_fields,prior_values,resulting_values,reason from private.ost_applicant_changes where ost_id=$1',
      [ost],
    )
  ).rows[0];
  check([...change.changed_fields].sort(), ['civilStatus', 'phone']);
  check(change.prior_values, { phone: '+639171234567', civilStatus: 'single' });
  check(change.resulting_values, { phone: '+639170000009', civilStatus: 'married' });
  check(change.reason, 'SYNTHETIC MARRIAGE RECORD');
  check(
    (
      await db.query('select public.update_ost_applicant($1,$2,$3,$4) id', [
        editInput.requestId,
        ids.super_admin,
        ost,
        editInput,
      ])
    ).rows[0].id,
    ost,
  );
  check(
    (
      await db.query('select count(*)::int n from private.ost_applicant_changes where ost_id=$1', [
        ost,
      ])
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
      editInput.requestId,
      ids.super_admin,
      ost,
      edit({ phone: '+639179999999', reason: 'SYNTHETIC' }),
    ]),
    /MUTATION_PAYLOAD_CONFLICT/,
  );
  checks++;
  await assert.rejects(
    db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
      randomUUID(),
      ids.super_admin,
      ost,
      edit({ phone: '+639170000009', civilStatus: 'married' }),
    ]),
    /OST_APPLICANT_NO_CHANGES/,
  );
  checks++;
  const records = (
    await db.query('select public.ost_accreditation_records($1,$2) result', [ids.super_admin, ost])
  ).rows[0].result;
  check(records.currentApplicant.phone, '+639170000009');
  check(records.currentApplicant.civilStatus, 'married');
  check(records.currentApplicant.programCategory, 'unknown');
  check(
    (await db.query('select phone from public.ost_applications where id=$1', [app])).rows[0].phone,
    '+639171234567',
  );
  const term7 = (
    await db.query(
      "select expires_on::text e from private.ost_accreditation_terms where ost_id=$1 and status='active'",
      [ost],
    )
  ).rows[0].e;
  const start7 = addDays(term7, 1);
  const renew7Input = {
    requestId: randomUUID(),
    dateOfRenewal: start7,
    requestedStart: start7,
    requestedEnd: addYear(start7),
    applicantSignatureStatus: 'received',
    referrerSignatureStatus: 'received',
  };
  const renew7 = (
    await db.query('select public.submit_ost_renewal($1,$2,$3,$4) id', [
      renew7Input.requestId,
      ids.super_admin,
      ost,
      renew7Input,
    ])
  ).rows[0].id;
  check(
    (
      await db.query(
        "select applicant_snapshot->>'phone' p from private.ost_accreditation_renewals where id=$1",
        [renew7],
      )
    ).rows[0].p,
    '+639170000009',
  );
  await db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
    randomUUID(),
    ids.super_admin,
    ost,
    edit({ phone: '+639170000009', civilStatus: 'married', messenger: 'SYNTHETIC FB' }),
  ]);
  check(
    (
      await db.query(
        "select applicant_snapshot->>'messenger' m from private.ost_accreditation_renewals where id=$1",
        [renew7],
      )
    ).rows[0].m,
    null,
  );
  check(
    (await db.query("select private.ost_applicant_current($1)->>'messenger' m", [ost])).rows[0].m,
    'SYNTHETIC FB',
  );
  // A supplied empty optional text clears the value (explicit null, recorded),
  // and the accumulation keeps every earlier accepted change.
  await db.query('select public.update_ost_applicant($1,$2,$3,$4)', [
    randomUUID(),
    ids.super_admin,
    ost,
    edit({ phone: '+639170000009', civilStatus: 'married' }),
  ]);
  check(
    (await db.query("select private.ost_applicant_current($1)->>'messenger' m", [ost])).rows[0].m,
    null,
  );
  check(
    (await db.query("select private.ost_applicant_current($1)->>'phone' p", [ost])).rows[0].p,
    '+639170000009',
  );
  check(
    (await db.query("select private.ost_applicant_current($1)->>'civilStatus' c", [ost])).rows[0].c,
    'married',
  );
  check(
    (
      await db.query(
        'select changed_fields from private.ost_applicant_changes where ost_id=$1 order by id desc limit 1',
        [ost],
      )
    ).rows[0].changed_fields,
    ['messenger'],
  );
  const forged =
    'insert into private.ost_applicant_changes(ost_id,changed_fields,prior_values,resulting_values,changed_by) values($1,array[\'fullName\'],\'{"fullName":"X"}\'::jsonb,$2::jsonb,$3)';
  await assert.rejects(
    db.query(forged, [
      ost,
      JSON.stringify({ fullName: 'Y', programCategory: 'vip_holder' }),
      ids.super_admin,
    ]),
    /ost_applicant_changes_fields_key/,
  );
  checks++;
  await assert.rejects(
    db.query(
      'insert into private.ost_applicant_changes(ost_id,changed_fields,prior_values,resulting_values,changed_by) values($1,array[\'fullName\'],\'{"fullName":"X"}\'::jsonb,\'{"fullName":"Y"}\'::jsonb,$2)',
      [ost, ids.super_admin],
    ),
    /ost_applicant_changes_reason_key/,
  );
  checks++;
  await assert.rejects(
    db.query("update private.ost_applicant_changes set reason='x' where ost_id=$1", [ost]),
    /OST_APPLICANT_HISTORY_IMMUTABLE/,
  );
  checks++;
  await assert.rejects(
    db.query('delete from private.ost_applicant_changes where ost_id=$1', [ost]),
    /OST_APPLICANT_HISTORY_IMMUTABLE/,
  );
  checks++;
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.update_ost_applicant(uuid,uuid,uuid,jsonb)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  // A late legacy-approval failure must roll back SQL, not delete history piecemeal.
  const legacyAuth = randomUUID();
  const legacyEmail = `${legacyAuth}@example.invalid`;
  await db.query('insert into auth.users(id,email) values($1,$2)', [legacyAuth, legacyEmail]);
  const legacyApp = (
    await db.query(
      `insert into public.ost_applications(referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address)
    select referral_code_id,sponsor_staff_id,$2,'+639189990001','SYNTHETIC','LEGACY','1990-01-01',address from public.ost_applications where id=$1 returning id`,
      [app, legacyEmail],
    )
  ).rows[0].id;
  await db.query(`create function pg_temp.fail_legacy_audit() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_LEGACY_AUDIT_FAILURE'; end $$;
    create trigger qa_fail_legacy_audit before insert on public.audit_events for each row when(new.action='OST_MEMBER_ACTIVATED') execute function pg_temp.fail_legacy_audit()`);
  await assert.rejects(
    db.query('select public.install_legacy_ost_identity($1,$2,$3)', [
      legacyApp,
      ids.super_admin,
      legacyAuth,
    ]),
    /SYNTHETIC_LEGACY_AUDIT_FAILURE/,
  );
  checks++;
  for (const [table, column] of [
    ['staff_users', 'id'],
    ['staff_role_assignments', 'staff_id'],
    ['staff_invitations', 'auth_user_id'],
    ['ost_members', 'id'],
    ['referral_relationships', 'subject_staff_id'],
  ]) {
    check(
      (
        await db.query(`select count(*)::int n from public.${table} where ${column}=$1`, [
          legacyAuth,
        ])
      ).rows[0].n,
      0,
    );
  }
  check(
    (await db.query('select status from public.ost_applications where id=$1', [legacyApp])).rows[0]
      .status,
    'submitted',
  );
  check(
    (await db.query('select count(*)::int n from auth.users where id=$1', [legacyAuth])).rows[0].n,
    1,
  );
  await db.query('drop trigger qa_fail_legacy_audit on public.audit_events');
  check(
    (
      await db.query('select public.install_legacy_ost_identity($1,$2,$3) result', [
        legacyApp,
        ids.super_admin,
        legacyAuth,
      ])
    ).rows[0].result.id,
    legacyAuth,
  );
  check(
    (
      await db.query('select public.install_legacy_ost_identity($1,$2,$3) result', [
        legacyApp,
        ids.super_admin,
        legacyAuth,
      ])
    ).rows[0].result.id,
    legacyAuth,
  );
  check(
    (
      await db.query(
        "select count(*)::int n from public.audit_events where action='OST_MEMBER_ACTIVATED' and entity_id=$1",
        [legacyAuth],
      )
    ).rows[0].n,
    1,
  );
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.install_legacy_ost_identity(uuid,uuid,uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  // Independent connections and observed lock waits prove actual overlap.
  assert.equal(new URL(postgres.url).hostname, '127.0.0.1');
  const connect = async () => {
    const client = new pg.Client({ connectionString: postgres.url });
    await client.connect();
    raceClients.push(client);
    await client.query("set statement_timeout='10s'; set lock_timeout='8s'");
    return client;
  };
  const first = await connect(),
    second = await connect();
  const firstPid = (await first.query('select pg_backend_pid() pid')).rows[0].pid;
  const secondPid = (await second.query('select pg_backend_pid() pid')).rows[0].pid;
  const waitForLock = async () => {
    for (let attempt = 0; attempt < 200; attempt++) {
      const blockers = (await db.query('select pg_blocking_pids($1) pids', [secondPid])).rows[0]
        .pids;
      if (blockers.includes(firstPid)) {
        checks++;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    throw new Error('Expected competing transaction to wait on the first connection');
  };
  const resultOf = (promise) =>
    promise.then(
      (result) => ({ result }),
      (error) => ({ error }),
    );
  const concurrentLegacyAuth = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    concurrentLegacyAuth,
    `${concurrentLegacyAuth}@example.invalid`,
  ]);
  const concurrentLegacyApp = (
    await db.query(
      `insert into public.ost_applications(referral_code_id,sponsor_staff_id,email,phone,first_name,last_name,birth_date,address)
    select referral_code_id,sponsor_staff_id,$2,'+639189990002','SYNTHETIC','CONCURRENT','1990-01-01',address from public.ost_applications where id=$1 returning id`,
      [app, `${concurrentLegacyAuth}@example.invalid`],
    )
  ).rows[0].id;
  await first.query('begin');
  try {
    await first.query('select public.install_legacy_ost_identity($1,$2,$3)', [
      concurrentLegacyApp,
      ids.super_admin,
      concurrentLegacyAuth,
    ]);
    const pending = resultOf(
      second.query('select public.install_legacy_ost_identity($1,$2,$3) result', [
        concurrentLegacyApp,
        ids.super_admin,
        concurrentLegacyAuth,
      ]),
    );
    await waitForLock();
    await first.query('commit');
    check((await pending).result?.rows[0].result.id, concurrentLegacyAuth);
    check(
      (
        await db.query('select count(*)::int n from public.ost_members where application_id=$1', [
          concurrentLegacyApp,
        ])
      ).rows[0].n,
      1,
    );
    check(
      (
        await db.query(
          'select count(*)::int n from public.referral_relationships where subject_staff_id=$1',
          [concurrentLegacyAuth],
        )
      ).rows[0].n,
      1,
    );
    check(
      (
        await db.query(
          "select count(*)::int n from public.audit_events where action='OST_MEMBER_ACTIVATED' and entity_id=$1",
          [concurrentLegacyAuth],
        )
      ).rows[0].n,
      1,
    );
  } finally {
    await first.query('rollback');
  }
  for (const [index, sameRequest] of [false, true].entries()) {
    const person = await addIst(
      'sales_manager',
      `AAI2610008${index}`,
      ids.senior_sales_manager,
      `+63918999008${index}`,
    );
    const args = await transferArgs(person);
    await first.query('begin');
    try {
      await first.query(transferSql, args);
      const pending = resultOf(
        second.query(
          transferSql,
          sameRequest ? args : args.map((v, i) => (i === 4 ? randomUUID() : v)),
        ),
      );
      await waitForLock();
      await first.query('commit');
      const result = await pending;
      if (sameRequest) check(result.result?.rows[0].result.staffId, person);
      else check(result.error?.message, 'ACCREDITATION_KIND_CONFLICT');
      check(
        (
          await db.query(
            'select count(*)::int n from private.ost_ist_conversions where staff_id=$1',
            [person],
          )
        ).rows[0].n,
        1,
      );
      check(
        (
          await db.query(
            'select count(*)::int n from private.sale_team_accreditation_history where staff_id=$1',
            [person],
          )
        ).rows[0].n,
        1,
      );
    } finally {
      await first.query('rollback');
    }
  }
  const makeExpired = async (phone) => {
    const person = randomUUID();
    const details = { ...identity, phone, email: `${person}@example.invalid` };
    const application = (
      await db.query("select public.submit_ost_accreditation($1,$2,$3,null,$4,$5,'manual') id", [
        randomUUID(),
        ids.super_admin,
        ids.sales_manager,
        details,
        form,
      ])
    ).rows[0].id;
    await db.query('select public.endorse_ost_accreditation($1,$2)', [
      application,
      ids.sales_manager,
    ]);
    await db.query('insert into auth.users(id,email) values($1,$2)', [person, details.email]);
    await db.query(
      "select public.install_ost_accreditation_identity($1,$2,$3,'2024-01-01','2025-01-01')",
      [application, ids.super_admin, person],
    );
    const request = { ...input, requestId: randomUUID(), proposedNewSponsorStaffId: otherSm };
    const renewal = (
      await db.query('select public.submit_ost_renewal($1,$2,$3,$4) id', [
        request.requestId,
        ids.super_admin,
        person,
        request,
      ])
    ).rows[0].id;
    await db.query("select public.decide_ost_renewal($1,$2,'endorse','')", [
      renewal,
      ids.sales_manager,
    ]);
    return { person, renewal };
  };
  const raceRenewal = await makeExpired('+639189990020');
  await first.query('begin');
  try {
    const a = (
      await first.query("select public.decide_ost_renewal($1,$2,'approve','') id", [
        raceRenewal.renewal,
        ids.super_admin,
      ])
    ).rows[0].id;
    const pending = resultOf(
      second.query("select public.decide_ost_renewal($1,$2,'approve','') id", [
        raceRenewal.renewal,
        ids.super_admin,
      ]),
    );
    await waitForLock();
    await first.query('commit');
    check((await pending).result?.rows[0].id, a);
    check(
      (
        await db.query(
          'select count(*)::int n from private.ost_accreditation_terms where renewal_id=$1',
          [raceRenewal.renewal],
        )
      ).rows[0].n,
      1,
    );
    check(
      (
        await db.query(
          'select count(*)::int n from public.referral_relationships where subject_staff_id=$1 and is_active',
          [raceRenewal.person],
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(
      db.query('update public.ost_members set sponsor_staff_id=$1 where id=$2', [
        ids.sales_manager,
        raceRenewal.person,
      ]),
      /OST_ACCREDITATION_EXPIRED_REQUIRED/,
    );
    checks++;
  } finally {
    await first.query('rollback');
  }
  const rollbackRenewal = await makeExpired('+639189990021');
  const renewalState = async () =>
    (
      await db.query(
        `select jsonb_build_object(
    'member',(select to_jsonb(m) from public.ost_members m where id=$1),
    'renewal',(select to_jsonb(r) from private.ost_accreditation_renewals r where id=$2),
    'terms',(select jsonb_agg(to_jsonb(t) order by id) from private.ost_accreditation_terms t where ost_id=$1),
    'edges',(select jsonb_agg(to_jsonb(e) order by id) from public.referral_relationships e where subject_staff_id=$1),
    'audits',(select count(*) from public.audit_events where entity_id in ($1::text,$2::text))) result`,
        [rollbackRenewal.person, rollbackRenewal.renewal],
      )
    ).rows[0].result;
  const beforeFailure = await renewalState();
  await db.query(`create function pg_temp.fail_renewal_term() returns trigger language plpgsql as $$ begin raise exception 'SYNTHETIC_RENEWAL_TERM_FAILURE'; end $$;
    create trigger qa_fail_renewal_term before insert on private.ost_accreditation_terms for each row when(new.ost_id='${rollbackRenewal.person}'::uuid) execute function pg_temp.fail_renewal_term()`);
  await assert.rejects(
    db.query("select public.decide_ost_renewal($1,$2,'approve','')", [
      rollbackRenewal.renewal,
      ids.super_admin,
    ]),
    /SYNTHETIC_RENEWAL_TERM_FAILURE/,
  );
  checks++;
  check(await renewalState(), beforeFailure);
  await db.query('drop trigger qa_fail_renewal_term on private.ost_accreditation_terms');
  await db.query("select public.decide_ost_renewal($1,$2,'approve','')", [
    rollbackRenewal.renewal,
    ids.super_admin,
  ]);
  check(
    (
      await db.query('select sponsor_staff_id from public.ost_members where id=$1', [
        rollbackRenewal.person,
      ])
    ).rows[0].sponsor_staff_id,
    otherSm,
  );
  check(
    (
      await db.query(
        'select expires_on::text expiry from private.sale_team_accreditations where staff_id=$1',
        [rollbackRenewal.person],
      )
    ).rows[0].expiry,
    '2027-10-17',
  );
  const reverse = await makeExpired('+639189990090');
  // Synthetic completion of invitation enrollment; live Auth is not exercised.
  await db.query("update public.staff_users set status='active' where id=$1", [reverse.person]);
  // Withdraw the synthetic renewal before using develop's separate reverse-kind workflow.
  await db.query("update private.ost_accreditation_renewals set status='withdrawn' where id=$1", [
    reverse.renewal,
  ]);
  const reverseArgs = [
    ids.super_admin,
    reverse.person,
    'OST_TO_IST',
    'Synthetic approved reverse transfer',
    randomUUID(),
    'sales_manager',
    ids.senior_sales_manager,
    null,
    null,
    null,
    null,
    null,
  ];
  check((await db.query(transferSql, reverseArgs)).rows[0].result.kind, 'IST');
  check(
    (await db.query('select private.staff_role_slug($1) role', [reverse.person])).rows[0].role,
    'sales_manager',
  );
  check(
    (await db.query('select status from public.ost_members where id=$1', [reverse.person])).rows[0]
      .status,
    'inactive',
  );
  check(
    (
      await db.query(
        "select count(*)::int n from private.ost_accreditation_terms where ost_id=$1 and status='active'",
        [reverse.person],
      )
    ).rows[0].n,
    0,
  );
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_accreditation_history where staff_id=$1',
        [reverse.person],
      )
    ).rows[0].n,
    1,
  );
  await db.query(transferSql, reverseArgs);
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_accreditation_history where staff_id=$1',
        [reverse.person],
      )
    ).rows[0].n,
    1,
  );
  const directPerson = randomUUID();
  const directIdentity = {
    ...identity,
    email: `${directPerson}@example.invalid`,
    phone: '+639189990091',
  };
  const directApp = (
    await db.query("select public.submit_ost_accreditation($1,$2,$3,null,$4,$5,'manual') id", [
      randomUUID(),
      ids.super_admin,
      ids.sales_manager,
      directIdentity,
      form,
    ])
  ).rows[0].id;
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    directPerson,
    directIdentity.email,
  ]);
  await db.query(
    "update public.role_permissions set can_update=true from public.roles r,public.modules m where role_permissions.role_id=r.id and role_permissions.module_id=m.id and r.slug='senior_sales_manager' and m.key='network.ost_registrations'",
  );
  await assert.rejects(
    db.query("select public.install_direct_ost_accreditation($1,$2,$3,'2026-10-17','2027-10-17')", [
      directApp,
      ids.senior_sales_manager,
      directPerson,
    ]),
    /OST_AA_ISSUANCE_FORBIDDEN/,
  );
  checks++;
  await db.query(
    "select public.install_direct_ost_accreditation($1,$2,$3,'2026-10-17','2027-10-17')",
    [directApp, ids.super_admin, directPerson],
  );
  check(
    (
      await db.query(
        'select endorsed_at from private.ost_registration_details where application_id=$1',
        [directApp],
      )
    ).rows[0].endorsed_at,
    null,
  );
  check(
    (
      await db.query(
        "select count(*)::int n from private.sale_team_accreditations where staff_id=$1 and kind='OST'",
        [directPerson],
      )
    ).rows[0].n,
    1,
  );
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.transfer_sale_team_member(uuid,uuid,text,text,uuid,text,uuid,uuid,jsonb,jsonb,date,date)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.transfer_sale_team_member(uuid,uuid,text,text,text,uuid,uuid,jsonb,jsonb,date,date)','execute') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  const acl = await db.query(fs.readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
  for (const result of Array.isArray(acl) ? acl : [acl]) check(result.rowCount, 0);
  console.log(
    `[ost-lifecycle] ${checks} checks passed on disposable PostgreSQL; no remote database used.`,
  );
} finally {
  await Promise.allSettled(raceClients.map((client) => client.end()));
  await postgres.stop();
}
