/** Owner-confirmed workflow proof. Disposable loopback PostgreSQL only. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
import {
  runWorkflowAlignmentChecks,
  runWorkflowConcurrencyChecks,
} from '../../../supabase/workflow-alignment-integration.ts';

let postgres;
try {
  postgres = await startDisposablePostgres();
  console.log(`Migration ordering: PASS (${postgres.applied.length} migrations)`);
  const definitions = async () =>
    (
      await postgres.client.query(`select p.oid,pg_get_functiondef(p.oid) definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname in ('public','private') and p.prokind='f' order by p.oid`)
    ).rows;
  const before = await definitions();
  for (const migration of [
    '20270105000016_afhomes_coordinated_application_workflow.sql',
    '20270105000019_afhomes_import_coordinated_approval_stage.sql',
    '20270105000020_afhomes_external_import_coordinated_reservation.sql',
  ])
    await postgres.client.query(readFileSync('supabase/migrations/' + migration, 'utf8'));
  assert.deepEqual(
    await definitions(),
    before,
    'reapplying the migration must preserve function definitions',
  );
  console.log('Migration replay: PASS');
  await postgres.client.query('begin');
  console.log(`Workflow: PASS (${await runWorkflowAlignmentChecks(postgres.client)} assertions)`);
  await postgres.client.query('rollback');
  console.log(
    `Concurrent workflow: PASS (${await runWorkflowConcurrencyChecks(postgres.client, postgres.url)} assertions)`,
  );
  const result = await postgres.client.query(
    readFileSync('supabase/security/rls_invariants.sql', 'utf8'),
  );
  const violations = (Array.isArray(result) ? result : [result]).flatMap((item) => item.rows);
  assert.deepEqual(violations, [], 'RLS invariant violations');
  console.log('RLS invariants: PASS (zero violations)');
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await postgres?.stop();
}
