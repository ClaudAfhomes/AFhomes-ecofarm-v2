import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startDisposablePostgres } from './lib/local-postgres.mjs';

const workbook = '20261206000003_afhomes_company_customer_workbook.sql';
const network = '20261206000003_afhomes_network_members_link_reconcile.sql';
const repair = '20261206000006_afhomes_reconcile_workbook_network_version.sql';
const sql = (file) =>
  readFileSync(new URL('../../../supabase/migrations/' + file, import.meta.url), 'utf8');
let checks = 0;
const check = (value, label) => {
  assert.ok(value, label);
  checks++;
};
for (const recorded of [workbook, network]) {
  let server;
  try {
    server = await startDisposablePostgres({ beforeMigration: workbook });
    const db = server.client;
    // Model the version-keyed runner: only one file with version ...000003 executes.
    await db.query(sql(recorded));
    if (recorded === workbook)
      await db.query(
        'alter table public.network_member_profiles drop column referrer_staff_id, drop column ost_referrer_staff_id',
      );
    const legacyName =
      recorded === workbook
        ? 'private.commit_customer_import_legacy_row(uuid,uuid)'
        : 'public.commit_customer_import_row(uuid,uuid)';
    const legacy = (
      await db.query('select prosrc from pg_proc where oid=$1::regprocedure', [legacyName])
    ).rows[0].prosrc;
    check(
      Boolean(
        (
          await db.query(
            "select to_regprocedure('private.commit_company_customer_import(uuid,uuid)') present",
          )
        ).rows[0].present,
      ) ===
        (recorded === workbook),
      'fixture reproduces the selected migration version',
    );
    await db.query(sql('20261206000004_afhomes_sale_team_manual_aa.sql'));
    await db.query(sql('20261206000005_afhomes_network_member_address_codes.sql'));
    await db.query(sql(repair));
    check(
      (
        await db.query(
          "select prosrc from pg_proc where oid='private.commit_customer_import_legacy_row(uuid,uuid)'::regprocedure",
        )
      ).rows[0].prosrc === legacy,
      'actual legacy import implementation is preserved',
    );
    check(
      (
        await db.query(
          "select count(*)::int n from information_schema.columns where table_schema='public' and table_name='network_member_profiles' and column_name in ('referrer_staff_id','ost_referrer_staff_id')",
        )
      ).rows[0].n === 2,
      'both network links are restored',
    );
    check(
      (
        await db.query(
          "select count(*)::int n from pg_constraint where conrelid='public.network_member_profiles'::regclass and confrelid='public.staff_users'::regclass and confdeltype='n'",
        )
      ).rows[0].n === 2,
      'restored links retain staff foreign keys with ON DELETE SET NULL',
    );
    const snapshot = async () =>
      (
        await db.query(`
      select n.nspname,p.proname,p.prosrc,p.proacl::text,p.proconfig
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','private') and p.proname in
        ('commit_customer_import_row','commit_customer_import_legacy_row',
         'commit_company_customer_import','match_company_import_staff')
      order by n.nspname,p.proname
    `)
      ).rows;
    const newerDispatcher = (
      await db.query(
        "select pg_get_functiondef('public.commit_customer_import_row(uuid,uuid)'::regprocedure) definition",
      )
    ).rows[0].definition.replace(/(begin\r?\n)/, '$1  -- NEWER-WORKBOOK-PRESERVATION-MARKER\n');
    assert.ok(newerDispatcher.includes('NEWER-WORKBOOK-PRESERVATION-MARKER'));
    await db.query(newerDispatcher);
    const before = await snapshot();
    check(before.length === 4, 'all four workbook functions exist');
    await db.query(sql(repair));
    assert.deepEqual(await snapshot(), before, 'reapplication preserves definitions and ACLs');
    checks++;
    check(
      (
        await db.query(`select
        has_function_privilege('service_role','public.commit_customer_import_row(uuid,uuid)','execute') dispatcher,
        has_function_privilege('authenticated','public.commit_customer_import_row(uuid,uuid)','execute') browser,
        has_function_privilege('service_role','private.commit_company_customer_import(uuid,uuid)','execute') direct_company,
        has_function_privilege('service_role','private.commit_customer_import_legacy_row(uuid,uuid)','execute') direct_legacy
      `)
      ).rows.every((r) => r.dispatcher && !r.browser && !r.direct_company && !r.direct_legacy),
      'workbook dispatch remains service-only and private delegates stay inaccessible',
    );
    await assert.rejects(
      () => db.query('select public.commit_customer_import_row(null,null)'),
      /ACTOR_INACTIVE/,
    );
    checks++;
    await db.query('begin');
    await db.query('drop function private.commit_company_customer_import(uuid,uuid)');
    await assert.rejects(() => db.query(sql(repair)), /WORKBOOK_PARTIAL_SCHEMA_REQUIRES_REVIEW/);
    checks++;
    await db.query('rollback');
    const invariants = await db.query(
      readFileSync(
        new URL('../../../supabase/security/rls_invariants.sql', import.meta.url),
        'utf8',
      ),
    );
    check(
      (Array.isArray(invariants) ? invariants : [invariants]).every((r) => r.rows.length === 0),
      'RLS invariants remain satisfied',
    );
    console.log('PASS recorded migration: ' + recorded);
  } finally {
    if (server) await server.stop();
  }
}
console.log(`Workbook/network migration reconciliation: ${checks} checks passed.`);
