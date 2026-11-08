import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { startDisposablePostgres } from './lib/local-postgres.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
process.chdir(root);
const target = path.resolve(root, '.tmp-bin', 'pg-integration');
assert(target.startsWith(root + path.sep) && path.basename(target) === 'pg-integration');
await new Promise((resolve, reject) => {
  const probe = net.createServer();
  probe.once('error', reject);
  probe.listen(Number(process.env.AFHOMES_TEST_PG_PORT ?? 55432), '127.0.0.1', () =>
    probe.close(resolve),
  );
});
let pg;
try {
  pg = await startDisposablePostgres();
  const db = pg.client;
  const actor = randomUUID(),
    customer = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    'prefix-proof@example.test',
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'MARA SANTOS','active')",
    [actor, 'prefix-proof@example.test'],
  );
  await db.query(
    "insert into public.customers(id,customer_number,first_name,last_name,birth_date,email,phone,status) values($1,'PREFIX-LOCAL','MARA','SANTOS','1990-01-01','mara@example.test','+639171234567','active')",
    [customer],
  );
  const plan = (
    await db.query("select id from public.card_plans where code='GOLD' and is_active limit 1")
  ).rows[0];
  assert(plan);
  const primary = {
    holderType: 'PRIMARY',
    prefix: 'Dr.',
    firstName: 'MARA',
    lastName: 'SANTOS',
    birthDate: '1990-01-01',
    permanentAddressLine1: '123 GARDEN STREET',
    cityMunicipality: 'CALAMBA',
    province: 'LAGUNA',
    mobile: '09171234567',
    email: 'mara@example.test',
    printedName: 'MARA SANTOS',
  };
  const secondary = {
    ...primary,
    holderType: 'SECONDARY',
    prefix: 'Ms.',
    firstName: 'LINA',
    printedName: 'LINA SANTOS',
  };
  const header = {
    customerId: customer,
    planId: plan.id,
    paymentScheme: 'spot_cash',
    consentAcknowledged: true,
    primarySignatureStatus: 'pending',
    secondarySignatureStatus: 'pending',
    validIdReceived: false,
    reservationPaymentProofReceived: false,
    acknowledgedAt: '2026-11-07',
    acquisitionChannels: [],
    raDraft: { reservationDate: '2026-11-08', totalPrice: '123456.78', paymentReference: 'DRAFT-ONLY' },
  };
  const save = async (id, p = primary, s = secondary) =>
    (
      await db.query(
        'select public.save_customer_application($1,$2,$3::jsonb,$4::jsonb,$5::jsonb) as id',
        [id, actor, JSON.stringify(header), JSON.stringify(p), s ? JSON.stringify(s) : null],
      )
    ).rows[0].id;
  const id = await save(null);
  assert.deepEqual((await db.query('select ra_draft from public.customer_applications where id=$1', [id])).rows[0].ra_draft, header.raDraft);
  header.raDraft.agreementDate = '2026-11-09';
  await save(id);
  assert.equal((await db.query('select ra_draft from public.customer_applications where id=$1', [id])).rows[0].ra_draft.agreementDate, '2026-11-09');
  await assert.rejects(() => db.query("update public.customer_applications set ra_draft='[]'::jsonb where id=$1", [id]), e => e.code === '23514');
  let rows = (
    await db.query(
      'select holder_type,prefix from public.customer_application_holders where application_id=$1 order by holder_type',
      [id],
    )
  ).rows;
  assert.deepEqual(rows, [
    { holder_type: 'PRIMARY', prefix: 'Dr.' },
    { holder_type: 'SECONDARY', prefix: 'Ms.' },
  ]);
  await save(id, { ...primary, prefix: 'Prof.' }, secondary);
  assert.equal(
    (
      await db.query(
        "select prefix from public.customer_application_holders where application_id=$1 and holder_type='PRIMARY'",
        [id],
      )
    ).rows[0].prefix,
    'Prof.',
  );
  await assert.rejects(
    () => save(id, { ...primary, prefix: 'X'.repeat(21) }, secondary),
    (e) => e.code === '23514',
  );
  await save(id, { ...primary, prefix: '' }, null);
  assert.equal(
    (
      await db.query(
        'select prefix from public.customer_application_holders where application_id=$1',
        [id],
      )
    ).rows[0].prefix,
    null,
  );
  await db.query(
    fs.readFileSync(
      'supabase/migrations/20261228000001_afhomes_application_holder_prefix.sql',
      'utf8',
    ),
  );
  await db.query(fs.readFileSync('supabase/migrations/20261229000001_afhomes_application_ra_draft.sql', 'utf8'));
  assert.deepEqual((await db.query('select ra_draft from public.customer_applications where id=$1', [id])).rows[0].ra_draft, header.raDraft);
  const retainedDraft = header.raDraft;
  delete header.raDraft;
  await save(id);
  assert.deepEqual((await db.query('select ra_draft from public.customer_applications where id=$1', [id])).rows[0].ra_draft, retainedDraft, 'older clients preserve RA document details');
  assert.equal((await db.query('select count(*)::int as n from public.payments')).rows[0].n, 0, 'document draft never records payment');
  const rights = (
    await db.query(
      "select has_function_privilege('anon','public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb)','execute') as anon,has_function_privilege('authenticated','public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb)','execute') as authenticated,has_function_privilege('service_role','public.save_customer_application(uuid,uuid,jsonb,jsonb,jsonb)','execute') as service",
    )
  ).rows[0];
  assert.deepEqual(rights, { anon: false, authenticated: false, service: true });
  const result = await db.query(fs.readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
  for (const r of Array.isArray(result) ? result : [result])
    assert.equal(r.rows.length, 0, 'RLS invariants');
  console.log(
    'PASS: ' +
      pg.applied.length +
      ' migrations replayed; RA draft create/read/update and old-client preservation; no payment rows; both holder prefixes create/read/update; length rejection; NULL legacy; idempotent replay; server-only save ACL; RLS invariants. Loopback only.',
  );
} finally {
  if (pg) await pg.stop();
}
