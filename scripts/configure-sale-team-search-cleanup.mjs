// Reads the same retention setting as the API; re-run after changing it.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadEnvFile } from 'node:process';
import pg from 'pg';

const project = 'ikaevepedpqygdlipsei';
const jobName = 'afhomes-sale-team-search-cleanup';
const schedule = '0 * * * *';
function retentionDays(value) {
  const days = Number(value);
  assert(Number.isInteger(days) && days >= 1 && days <= 3650, 'Retention must be 1–3650 whole days.');
  return days;
}
const command = (days) => `select public.cleanup_sale_team_search(${retentionDays(days)});`;

if (process.argv.includes('--self-test')) {
  assert.equal(command('30'), 'select public.cleanup_sale_team_search(30);');
  assert.equal(command('90'), 'select public.cleanup_sale_team_search(90);');
  for (const value of ['', '0', '-1', '1.5', '3651', '30); delete from customers;'])
    assert.throws(() => command(value));
  console.log('PASS: configurable retention bounds and SQL command safety.');
} else {
  assert(process.argv.slice(2).every(arg => ['--check', '--apply'].includes(arg)), 'Unknown argument.');
  assert(!(process.argv.includes('--check') && process.argv.includes('--apply')), 'Choose check or apply.');
  if (fs.existsSync('.env.local')) loadEnvFile('.env.local');
  const days = retentionDays(process.env.AFHOMES_SEARCH_CONTACT_RETENTION_DAYS);
  assert.equal(process.env.AFHOMES_TARGET_PROJECT_REF, project, 'Explicit target project required.');
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(decodeURIComponent(url.username).split('.')[1] || url.hostname.match(/^db\.([^.]+)/)?.[1], project, 'Wrong database project.');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000, statement_timeout: 10000 });
  try {
    await db.connect();
    assert((await db.query("select to_regprocedure('public.cleanup_sale_team_search(integer)') routine")).rows[0].routine, 'Apply the approved search repair first.');
    const installed = (await db.query("select exists(select 1 from pg_extension where extname='pg_cron') installed")).rows[0].installed;
    if (!process.argv.includes('--apply')) {
      const current = installed ? (await db.query('select schedule,command,active from cron.job where jobname=$1', [jobName])).rows : [];
      console.log(JSON.stringify({ mode: 'read-only', project, days, cronInstalled: installed, jobName, schedule, command: command(days), matches: current.length === 1 && current[0].active && current[0].schedule === schedule && current[0].command === command(days) }));
    } else {
      await db.query('begin');
      await db.query("select pg_advisory_xact_lock(hashtextextended('afhomes-search-cleanup-configuration',0))");
      await db.query('create extension if not exists pg_cron with schema pg_catalog');
      const fingerprint = async () => (await db.query(`select md5(coalesce(string_agg(jobid::text||schedule||command||active::text,'|' order by jobid),'')) fingerprint from cron.job where jobname<>$1`, [jobName])).rows[0].fingerprint;
      const before = await fingerprint();
      await db.query('select cron.schedule($1,$2,$3)', [jobName, schedule, command(days)]);
      const current = (await db.query('select schedule,command,active from cron.job where jobname=$1', [jobName])).rows;
      assert.equal(current.length, 1);
      assert(current[0].active && current[0].schedule === schedule && current[0].command === command(days));
      assert.equal(await fingerprint(), before, 'An unrelated cron job changed.');
      await db.query('commit');
      console.log(JSON.stringify({ configured: true, project, jobName, schedule, retentionDays: days, otherJobsUnchanged: true }));
    }
  } catch (error) {
    await db.query('rollback').catch(() => {});
    console.error(JSON.stringify({ failed: true, errorCode: error.code || error.name }));
    process.exitCode = 1;
  } finally { await db.end(); }
}
