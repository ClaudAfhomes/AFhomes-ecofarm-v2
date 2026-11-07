import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import pg from 'pg';
import { readFileSync } from 'node:fs';
import { startDisposablePostgres } from './lib/local-postgres.mjs';

const postgres = await startDisposablePostgres({
  beforeMigration: '20261208000012_afhomes_ist_employee_identity_schema.sql',
});
const clients = [];
let checks = 0;
const check = (actual, expected) => {
  assert.deepEqual(actual, expected);
  checks++;
};
try {
  const db = postgres.client;
  const protectedTables = [
    'customers',
    'card_sales',
    'payments',
    'purchases',
    'purchase_payments',
    'memberships',
    'points_accounts',
    'points_ledger',
    'commissions',
  ];
  const totals = async () => {
    const counts = [];
    for (const table of protectedTables)
      counts.push([
        table,
        (await db.query(`select count(*)::int n from public.${table}`)).rows[0].n,
      ]);
    return Object.fromEntries(counts);
  };
  // Only count tables present in this canonical baseline.
  for (let n = protectedTables.length - 1; n >= 0; n--)
    if (
      !(await db.query('select to_regclass($1) name', ['public.' + protectedTables[n]])).rows[0]
        .name
    )
      protectedTables.splice(n, 1);
  const financeBefore = await totals();
  const actor = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    `${actor}@example.invalid`,
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'IMPORT TEST ADMIN','active')",
    [actor, `${actor}@example.invalid`],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",
    [actor],
  );
  await db.query(
    "insert into public.departments(code,name,is_active) values('SALES','Sales',true) on conflict(code) do nothing",
  );
  // Prove the forward upgrade preserves identities and history issued by the old functions.
  const legacy = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    legacy,
    `${legacy}@example.invalid`,
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'LEGACY EMPLOYEE','active')",
    [legacy, `${legacy}@example.invalid`],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='vice_director'",
    [legacy],
  );
  await db.query(
    "select public.manage_sale_team_accreditation($1,$2,'IST','approve','2019-01-01','2020-01-01','AAI19010001')",
    [actor, legacy],
  );
  await db.query(
    "insert into private.sale_team_accreditation_history(staff_id,aa_number,kind,public_name,starts_on,expires_on,event,successor_aa_number,recorded_by) values($1,'AAI18120007','IST','LEGACY EMPLOYEE','2018-12-01','2019-12-01','transferred','AAI19010001',$2)",
    [legacy, actor],
  );
  const legacySnapshot = async () =>
    (
      await db.query(
        'select to_jsonb(a) identity,(select jsonb_agg(to_jsonb(h) order by h.id) from private.sale_team_accreditation_history h where h.staff_id=a.staff_id) history from private.sale_team_accreditations a where a.staff_id=$1',
        [legacy],
      )
    ).rows;
  const beforeUpgrade = await legacySnapshot();
  for (const file of [
    '20261208000012_afhomes_ist_employee_identity_schema.sql',
    '20261208000013_afhomes_member_workbook_jobs_schema.sql',
  ])
    await db.query(
      readFileSync(
        new URL('../../../supabase/migrations/' + file, import.meta.url),
        'utf8',
      ).replace(/^\uFEFF/, ''),
    );
  check(await legacySnapshot(), beforeUpgrade);
  check(
    (await db.query('select public.get_sale_team_accreditation($1) result', [legacy])).rows[0]
      .result.expiresOn,
    '2020-01-01',
  );
  check(
    (
      await db.query(
        "select to_regprocedure('public.issue_ist_employee_identity(uuid,uuid,text)') is null absent",
      )
    ).rows[0].absent,
    true,
  );
  for (const file of [
    '20261208000014_afhomes_ist_employee_identity_functions.sql',
    '20261208000015_afhomes_member_workbook_jobs_functions.sql',
  ])
    await db.query(
      readFileSync(
        new URL('../../../supabase/migrations/' + file, import.meta.url),
        'utf8',
      ).replace(/^\uFEFF/, ''),
    );
  check(await legacySnapshot(), beforeUpgrade);
  const directInstallerPrivileges = (
    await db.query(
      "select has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('authenticated',p.oid,'execute') authenticated,has_function_privilege('service_role',p.oid,'execute') service,p.pronargs args from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='install_direct_ost_password'",
    )
  ).rows;
  check(directInstallerPrivileges.length, 1);
  check(directInstallerPrivileges[0].anon, false);
  check(directInstallerPrivileges[0].authenticated, false);
  check(directInstallerPrivileges[0].service, true);
  check(directInstallerPrivileges[0].args, 6);
  const retained = (
    await db.query('select public.issue_ist_employee_identity($1,$2,null) result', [actor, legacy])
  ).rows[0].result;
  check(retained.aaNumber, 'AAI19010001');
  check(retained.startsOn, '2019-01-01');
  check(retained.expiresOn, '2020-01-01');
  check(retained.status, 'accredited');
  check(await legacySnapshot(), beforeUpgrade);
  const baseline = (await db.query('select count(*) n from public.audit_events')).rows[0].n;
  const subjects = ['vice_director', 'senior_sales_manager', 'sales_manager'].map(
    (position, index) => ({
      id: randomUUID(),
      position,
      name: `SYNTHETIC ${['VD', 'SSM', 'SM'][index]}`,
    }),
  );
  const rows = subjects.map((s, index) => ({
    rowNumber: index + 2,
    errors: [],
    fields: {
      planned_staff_id: s.id,
      email: `${s.id}@example.invalid`,
      position: s.position,
      canonical_name: s.name,
      display_name: s.name,
      canonical_mobile: `+63917000000${index}`,
      aa_number: `AAI2001000${index + 1}`,
      head_staff_id: subjects[index - 1]?.id ?? '',
      head_member: subjects[index - 1]?.name ?? '',
      birth_date: '1990-01-01',
    },
    input: {
      dateOfBirth: '1990-01-01',
      sex: 'Male',
      civilStatus: 'Single',
      streetNo: 'TEST',
      cityMunicipality: 'Calauan',
      province: 'Laguna',
      provinceCode: '0403400000',
      cityMunicipalityCode: '0403406000',
      zipCode: '4012',
      mobileNo: `+63917000000${index}`,
      employerName: 'TEST',
      employerAddress: 'TEST',
      jobPosition: 'TEST',
      governmentIdType: 'passport',
      governmentIdNumber: 'SYNTHETIC',
    },
  }));
  const hash = createHash('sha256').update('synthetic workbook').digest('hex');
  const stage = async (source, data = rows) =>
    (
      await db.query("select public.stage_member_workbook($1,'IST',$2,$3) id", [
        actor,
        source,
        JSON.stringify(data),
      ])
    ).rows[0].id;
  const job = await stage(hash);
  check(await stage(hash), job);
  const get = async (id) =>
    (await db.query('select public.get_member_workbook_jobs($1,$2) jobs', [actor, id])).rows[0]
      .jobs[0];
  const jobRows = (await get(job)).rows;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index],
      staged = jobRows[index];
    const claim = (
      await db.query('select public.claim_member_workbook_row($1,$2,$3,false) result', [
        actor,
        job,
        staged.id,
      ])
    ).rows[0].result;
    check(claim.authId, row.fields.planned_staff_id);
    await db.query('insert into auth.users(id,email) values($1,$2)', [claim.authId, claim.email]);
    check(
      (
        await db.query('select public.install_member_workbook_row($1,$2,$3) id', [
          actor,
          job,
          staged.id,
        ])
      ).rows[0].id,
      claim.authId,
    );
    check(
      (
        await db.query('select public.install_member_workbook_row($1,$2,$3) id', [
          actor,
          job,
          staged.id,
        ])
      ).rows[0].id,
      claim.authId,
    );
  }
  check(
    (
      await db.query(
        "select count(*)::int n from private.sale_team_accreditations where staff_id=any($1) and kind='IST' and starts_on is null and expires_on is null",
        [subjects.map((s) => s.id)],
      )
    ).rows[0].n,
    3,
  );
  check(
    (
      await db.query(
        'select upline_staff_id from public.referral_relationships where subject_staff_id=$1 and is_active',
        [subjects[2].id],
      )
    ).rows[0].upline_staff_id,
    subjects[1].id,
  );
  const replay = await stage(createHash('sha256').update('same data new workbook').digest('hex'));
  check(
    (await get(replay)).rows.map((r) => r.decision),
    ['MATCH', 'MATCH', 'MATCH'],
  );
  const noPrivate = (await get(job)).rows;
  check(JSON.stringify(noPrivate).includes('governmentIdNumber'), false);
  // Existing legacy local-format phones must match canonically, without being rewritten.
  const legacyPhone = '0' + rows[0].fields.canonical_mobile.slice(3);
  await db.query('update public.network_member_profiles set mobile_no=$1 where staff_id=$2', [
    legacyPhone,
    subjects[0].id,
  ]);
  const legacyMatch = await stage(createHash('sha256').update('legacy-local-phone').digest('hex'), [
    rows[0],
  ]);
  check((await get(legacyMatch)).rows[0].decision, 'MATCH');
  const phoneCollision = structuredClone(rows[0]);
  phoneCollision.fields.planned_staff_id = randomUUID();
  phoneCollision.fields.email = 'legacy-phone-collision@example.invalid';
  phoneCollision.fields.canonical_name = 'ANOTHER SYNTHETIC PERSON';
  phoneCollision.fields.aa_number = '';
  const legacyConflict = await stage(
    createHash('sha256').update('legacy-phone-conflict').digest('hex'),
    [phoneCollision],
  );
  check((await get(legacyConflict)).rows[0].decision, 'CONFLICT');
  check(
    (
      await db.query('select mobile_no from public.network_member_profiles where staff_id=$1', [
        subjects[0].id,
      ])
    ).rows[0].mobile_no,
    legacyPhone,
  );
  // A different person may never take an issued historical AAI.
  const impostor = structuredClone(rows[0]);
  impostor.fields.email = 'different@example.invalid';
  impostor.fields.canonical_name = 'DIFFERENT PERSON';
  impostor.fields.planned_staff_id = randomUUID();
  const conflict = await stage(createHash('sha256').update('conflict').digest('hex'), [impostor]);
  check((await get(conflict)).rows[0].decision, 'CONFLICT');
  const rejected = (await get(conflict)).rows[0];
  await assert.rejects(
    db.query('select public.claim_member_workbook_row($1,$2,$3,true)', [
      actor,
      conflict,
      rejected.id,
    ]),
    /IMPORT_REVIEW_REQUIRED/,
  );
  checks++;
  // Historical OST claims require an explicit current operator approval.
  for (const [index, aa] of ['AAO20010004', 'AA-A1B2C3D4E5F6'].entries()) {
    const id = randomUUID(),
      phone = `+63918000000${index}`,
      name = `SYNTHETIC OST ${['ALPHA', 'BETA'][index]}`;
    const ostRows = [
      {
        rowNumber: 2,
        errors: [],
        fields: {
          planned_staff_id: id,
          email: `${id}@example.invalid`,
          canonical_name: name,
          display_name: name,
          canonical_mobile: phone,
          mobile: `0918000000${index}`,
          position: 'ost',
          aa_number: aa,
          head_staff_id: subjects[2].id,
          head_member: subjects[2].name,
          birth_date: '1990-01-01',
        },
        input: {
          startsOn: '2020-01-01',
          expiresOn: '2021-01-01',
          identity: {
            firstName: 'SYNTHETIC',
            lastName: `OST ${['ALPHA', 'BETA'][index]}`,
            email: `${id}@example.invalid`,
            phone,
            birthDate: '1990-01-01',
            address: { line1: 'SYNTHETIC', city: 'Calauan', province: 'Laguna', countryCode: 'PH' },
          },
          form: {
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
          },
        },
      },
    ];
    const ostJob = (
      await db.query("select public.stage_member_workbook($1,'OST',$2,$3) id", [
        actor,
        createHash('sha256').update(aa).digest('hex'),
        JSON.stringify(ostRows),
      ])
    ).rows[0].id;
    const staged = (await get(ostJob)).rows[0];
    await assert.rejects(
      db.query('select public.claim_member_workbook_row($1,$2,$3,false)', [
        actor,
        ostJob,
        staged.id,
      ]),
      /IMPORT_EVIDENCE_REQUIRED/,
    );
    checks++;
    const claimed = (
      await db.query('select public.claim_member_workbook_row($1,$2,$3,true) result', [
        actor,
        ostJob,
        staged.id,
      ])
    ).rows[0].result;
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      claimed.authId,
      claimed.email,
    ]);
    check(
      (
        await db.query('select public.install_member_workbook_row($1,$2,$3) id', [
          actor,
          ostJob,
          staged.id,
        ])
      ).rows[0].id,
      id,
    );
    check(
      (
        await db.query(
          'select sex,civil_status,mobile_no,city_municipality,government_id_number,referrer_staff_id from public.network_member_profiles where staff_id=$1',
          [id],
        )
      ).rows,
      [
        {
          sex: 'Male',
          civil_status: 'Single',
          mobile_no: phone,
          city_municipality: 'Calauan',
          government_id_number: 'SYNTHETIC',
          referrer_staff_id: subjects[2].id,
        },
      ],
    );
    const record = (await db.query('select public.get_sale_team_accreditation($1) record', [id]))
      .rows[0].record;
    check(record.aaNumber, aa);
    check(record.status, 'expired');
    check(
      (
        await db.query(
          'select count(*)::int n from private.ost_accreditation_terms where ost_id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    );
    const exported = (
      await db.query('select public.export_member_workbook_profiles($1,$2) data', [actor, [id]])
    ).rows[0].data;
    check(JSON.stringify(exported).includes('SYNTHETIC"'), true);
    check(JSON.stringify(exported).includes('governmentIdNumber'), false);
    const matchedOst = structuredClone(ostRows[0]);
    Object.assign(matchedOst.fields, {
      starts_on: '2020-01-01',
      expires_on: '2021-01-01',
      applicant_signed_on: '2020-01-01',
    });
    const stageOst = async (tag, row) =>
      (
        await db.query("select public.stage_member_workbook($1,'OST',$2,$3) id", [
          actor,
          createHash('sha256')
            .update(aa + tag)
            .digest('hex'),
          JSON.stringify([row]),
        ])
      ).rows[0].id;
    check((await get(await stageOst('identical-history', matchedOst))).rows[0].decision, 'MATCH');
    const changedTerm = structuredClone(matchedOst);
    changedTerm.fields.starts_on = '2025-01-01';
    changedTerm.fields.expires_on = '2026-01-01';
    check((await get(await stageOst('unrecorded-term', changedTerm))).rows[0].decision, 'CONFLICT');
    const changedSignature = structuredClone(matchedOst);
    changedSignature.fields.applicant_signed_on = '2020-01-02';
    check(
      (await get(await stageOst('changed-signature', changedSignature))).rows[0].decision,
      'CONFLICT',
    );
    const localOstPhone = '0' + phone.slice(3);
    await db.query('update public.ost_members set phone=$1 where id=$2', [localOstPhone, id]);
    check((await get(await stageOst('local-phone-match', matchedOst))).rows[0].decision, 'MATCH');
    const ostImpostor = structuredClone(matchedOst);
    ostImpostor.fields.planned_staff_id = randomUUID();
    ostImpostor.fields.email = 'different-' + index + '@example.invalid';
    ostImpostor.fields.aa_number = '';
    ostImpostor.fields.canonical_name = 'ANOTHER OST PERSON';
    check(
      (await get(await stageOst('local-phone-conflict', ostImpostor))).rows[0].decision,
      'CONFLICT',
    );
    check(
      (
        await db.query(
          'select count(*)::int n from private.ost_accreditation_terms where ost_id=$1',
          [id],
        )
      ).rows[0].n,
      1,
    );
  }
  // Same identity in two staged jobs: exactly one durable Auth claim may proceed.
  const pending = structuredClone(rows[0]);
  pending.fields.planned_staff_id = randomUUID();
  pending.fields.email = 'pending@example.invalid';
  pending.fields.canonical_name = 'SYNTHETIC PENDING';
  pending.fields.canonical_mobile = '+639190000000';
  pending.input.mobileNo = pending.fields.canonical_mobile;
  pending.fields.aa_number = 'AAI20120008';
  const first = await stage(createHash('sha256').update('race-one').digest('hex'), [pending]);
  const rival = structuredClone(pending);
  rival.fields.planned_staff_id = randomUUID();
  const second = await stage(createHash('sha256').update('race-two').digest('hex'), [rival]);
  const firstRow = (await get(first)).rows[0],
    secondRow = (await get(second)).rows[0];
  const reserved = (
    await db.query('select public.claim_member_workbook_row($1,$2,$3,true) result', [
      actor,
      first,
      firstRow.id,
    ])
  ).rows[0].result;
  await assert.rejects(
    db.query('select public.claim_member_workbook_row($1,$2,$3,true)', [
      actor,
      second,
      secondRow.id,
    ]),
    /duplicate key/,
  );
  checks++;
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    reserved.authId,
    reserved.email,
  ]);
  await db.query(
    "create function public.synthetic_import_failure() returns trigger language plpgsql as $$begin raise exception 'SYNTHETIC_IMPORT_FAIL';end$$; create trigger synthetic_import_failure before insert on public.network_member_profiles for each row execute function public.synthetic_import_failure()",
  );
  await assert.rejects(
    db.query('select public.install_member_workbook_row($1,$2,$3)', [actor, first, firstRow.id]),
    /SYNTHETIC_IMPORT_FAIL/,
  );
  checks++;
  await db.query('select public.record_member_workbook_failure($1,$2,$3)', [
    actor,
    first,
    firstRow.id,
  ]);
  check((await get(first)).rows[0].lastError, 'OUTCOME_UNCONFIRMED');
  check(
    (
      await db.query('select count(*)::int n from public.staff_users where id=$1', [
        reserved.authId,
      ])
    ).rows[0].n,
    0,
  );
  check((await get(first)).rows[0].state, 'creating');
  await db.query(
    'drop trigger synthetic_import_failure on public.network_member_profiles; drop function public.synthetic_import_failure()',
  );
  for (let n = 0; n < 2; n++) {
    const client = new pg.Client({ connectionString: postgres.url });
    await client.connect();
    clients.push(client);
  }
  const installed = await Promise.all(
    clients.map((client) =>
      client.query('select public.install_member_workbook_row($1,$2,$3) id', [
        actor,
        first,
        firstRow.id,
      ]),
    ),
  );
  check(
    installed.map((result) => result.rows[0].id),
    [reserved.authId, reserved.authId],
  );
  check(
    (
      await db.query(
        'select count(*)::int n from public.network_member_profiles where staff_id=$1',
        [reserved.authId],
      )
    ).rows[0].n,
    1,
  );
  // Date-free identities do not expire; old recorded dates remain untouched.
  await db.query(
    "update private.sale_team_accreditations set starts_on='2000-01-01',expires_on='2001-01-01' where staff_id=$1",
    [subjects[0].id],
  );
  await db.query('select public.issue_ist_employee_identity($1,$2,null)', [actor, subjects[0].id]);
  check(
    (
      await db.query(
        'select starts_on::text d from private.sale_team_accreditations where staff_id=$1',
        [subjects[0].id],
      )
    ).rows[0].d,
    '2000-01-01',
  );
  const identity = (
    await db.query('select public.get_sale_team_accreditation($1) data', [subjects[0].id])
  ).rows[0].data;
  check(identity.status, 'accredited');
  check(identity.startsOn, '2000-01-01');
  check(identity.expiresOn, '2001-01-01');
  await assert.rejects(
    db.query("select public.manage_sale_team_accreditation($1,$2,'IST','revoke')", [
      actor,
      subjects[0].id,
    ]),
    /IST_EMPLOYEE_LIFECYCLE_REQUIRED/,
  );
  checks++;
  await assert.rejects(
    db.query('select public.get_member_workbook_jobs($1,null)', [subjects[2].id]),
    /MUTATION_FORBIDDEN/,
  );
  checks++;
  check(await totals(), financeBefore);
  const invariants = await db.query(
    readFileSync(new URL('../../../supabase/security/rls_invariants.sql', import.meta.url), 'utf8'),
  );
  for (const result of Array.isArray(invariants) ? invariants : [invariants])
    check(result.rows, []);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    check(
      (
        await db.query(
          "select has_table_privilege($1,'private.member_workbook_rows','SELECT,INSERT,UPDATE,DELETE') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  }
  check(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.install_member_workbook_row(uuid,uuid,uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  check(
    Number((await db.query('select count(*) n from public.audit_events')).rows[0].n) >
      Number(baseline),
    true,
  );
  console.log(
    `Member workbook gate: ${checks} checks passed (disposable loopback PostgreSQL only).`,
  );
} finally {
  for (const client of clients) await client.end().catch(() => {});
  await postgres.stop();
}
