import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { listMigrations, startDisposablePostgres } from './lib/local-postgres.mjs';

const repair = '20261130000003_afhomes_reconcile_membership_sale_team.sql';
const originals = [
  '20261130000001_afhomes_membership_company_fields.sql',
  '20261130000001_afhomes_sale_team_accreditation.sql',
];
const sql = (name) =>
  readFileSync(new URL('../../../supabase/migrations/' + name, import.meta.url), 'utf8').replace(
    /^\uFEFF/,
    '',
  );
let checks = 0;
const check = (value, message) => {
  assert.ok(value, message);
  checks++;
};
for (const skipped of originals) {
  let server;
  try {
    server = await startDisposablePostgres({
      beforeMigration: repair,
      excludedMigrations: [skipped],
    });
    const db = server.client;
    const before = (
      await db.query(
        "select to_regclass('private.sale_team_accreditations') accreditation, exists(select 1 from information_schema.columns where table_schema='public' and table_name='customers' and column_name='ra_number') company",
      )
    ).rows[0];
    check(
      skipped === originals[0]
        ? !before.company && Boolean(before.accreditation)
        : before.company && !before.accreditation,
      'fixture reproduces one skipped historical migration',
    );
    const legacy = (
      await db.query(
        "select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure) definition",
      )
    ).rows[0].definition;
    await db.query(sql(repair));
    check(
      (
        await db.query(
          "select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure) definition",
        )
      ).rows[0].definition === legacy,
      'repair never overwrites the customer import RPC',
    );
    check(
      Boolean(
        (await db.query("select to_regclass('private.sale_team_accreditations') relation")).rows[0]
          .relation,
      ),
      'accreditation table restored',
    );
    check(
      (
        await db.query(
          "select count(*)::integer n from information_schema.columns where table_schema='public' and table_name='customers' and column_name in ('ra_number','stated_vip_package','supplementary_tin_number')",
        )
      ).rows[0].n === 3,
      'company column prerequisites restored',
    );
    const staff = randomUUID();
    const customer = randomUUID();
    await db.query('insert into auth.users(id,email) values($1,$2)', [
      staff,
      'reconcile-staff@example.invalid',
    ]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'SYNTHETIC STAFF','active')",
      [staff, 'reconcile-staff@example.invalid'],
    );
    await db.query(
      "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='vice_director'",
      [staff],
    );
    await db.query(
      "insert into public.customers(id,customer_number,email,phone,first_name,last_name,ra_number,stated_vip_package) values($1,'AF-CUS-RECONCILE','reconcile-customer@example.invalid','09123456789','SYNTHETIC','CUSTOMER','SYNTHETIC-RA','GOLD')",
      [customer],
    );
    await db.query(
      "insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by) values($1,'AA-SYNTHETIC','SYNTHETIC STAFF','IST','active',current_date-1,current_date+10,$1)",
      [staff],
    );
    const snapshot = async () =>
      (
        await db.query(
          'select to_jsonb(c) customer,to_jsonb(a) accreditation from public.customers c cross join private.sale_team_accreditations a where c.id=$1 and a.staff_id=$2',
          [customer, staff],
        )
      ).rows[0];
    const preserved = await snapshot();
    await db.query(sql(repair));
    assert.deepEqual(
      await snapshot(),
      preserved,
      'reapplication preserves customer facts, issued AA and approval metadata',
    );
    checks++;
    check(
      (await db.query('select public.get_sale_team_accreditation($1) result', [staff])).rows[0]
        .result.status === 'accredited',
      'existing accreditation lookup remains functional',
    );
    check(
      (
        await db.query(
          "select has_table_privilege('authenticated','private.sale_team_accreditations','SELECT') readable, has_function_privilege('authenticated','public.manage_sale_team_accreditation(uuid,uuid,text,text,date,date)','EXECUTE') callable",
        )
      ).rows.every((row) => !row.readable && !row.callable),
      'browser cannot read or mutate accreditation',
    );
    check(
      !(
        await db.query(
          "select has_column_privilege('authenticated','public.customers','tin_number','SELECT') readable",
        )
      ).rows[0].readable,
      'customer TIN remains write-only to browsers',
    );
    for (const name of listMigrations().filter((name) => name > repair)) await db.query(sql(name));
    check(
      Boolean(
        (
          await db.query(
            "select to_regprocedure('private.commit_company_customer_import(uuid,uuid)') handler",
          )
        ).rows[0].handler,
      ),
      'all later migrations and company dispatcher apply successfully',
    );
    const definition = (
      await db.query(
        "select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure) definition",
      )
    ).rows[0].definition;
    await db.query(sql(repair));
    check(
      (
        await db.query(
          "select pg_get_functiondef('public.import_legacy_member(uuid,uuid,jsonb,uuid,jsonb,jsonb,boolean)'::regprocedure) definition",
        )
      ).rows[0].definition === definition,
      'late repair preserves newer SSOT/import implementation',
    );
    const invariants = await db.query(
      readFileSync(
        new URL('../../../supabase/security/rls_invariants.sql', import.meta.url),
        'utf8',
      ),
    );
    check(
      (Array.isArray(invariants) ? invariants : [invariants]).every(
        (result) => result.rows.length === 0,
      ),
      'RLS invariant queries return zero violations',
    );
    console.log('PASS skipped-history recovery: ' + skipped);
  } finally {
    if (server) await server.stop();
  }
}
console.log(
  `Migration version reconciliation: ${checks} checks passed across both skipped-history cases.`,
);
