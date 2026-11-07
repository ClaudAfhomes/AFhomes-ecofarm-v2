import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { seedSearchOst } from './lib/sale-team-search-fixture.mjs';

export async function testSearch(db, connect) {
  let checks = 0;
  const check = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const seller = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    seller,
    `${seller}@example.invalid`,
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'Synthetic Seller','active')",
    [seller, `${seller}@example.invalid`],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='sales_manager'",
    [seller],
  );
  await db.query(
    "insert into private.sale_team_accreditations(staff_id,aa_number,public_name,kind,status,starts_on,expires_on,approved_by) values($1,'AAI20010001','Synthetic Seller','IST','active','2020-01-01','2020-12-31',$1)",
    [seller],
  );
  check(
    (await db.query('select public.get_sale_team_accreditation($1) r', [seller])).rows[0].r.status,
    'accredited',
  );
  const save = (client, key = 'a'.repeat(64), name = 'Synthetic Searcher') =>
    client.query('select public.save_sale_team_search_contact($1,$2,$3,$4) id', [
      key,
      name,
      'searcher@example.invalid',
      '+639171234567',
    ]);
  const contact = (await save(db)).rows[0].id;
  check((await save(db)).rows[0].id, contact);
  const a = await connect(),
    b = await connect();
  const contacts = await Promise.all([save(a), save(b)]);
  check(
    contacts.every((r) => r.rows[0].id === contact),
    true,
  );
  check(
    (await db.query('select count(*)::int n from private.sale_team_search_contacts')).rows[0].n,
    1,
  );
  const otherContact = (await save(db, 'b'.repeat(64), 'Other Searcher')).rows[0].id;
  check(otherContact !== contact, true);
  const firstSubmissions = await Promise.all([save(a, 'c'.repeat(64)), save(b, 'c'.repeat(64))]);
  check(firstSubmissions[0].rows[0].id, firstSubmissions[1].rows[0].id);
  const reveal = async (client, ip, request = randomUUID(), aa = 'AAI20010001', cid = contact) =>
    (
      await client.query('select public.reveal_sale_team_search($1,$2,$3,$4,$5) r', [
        ip,
        request,
        aa,
        'test-v1',
        cid,
      ])
    ).rows[0].r;
  const ostNumber = await seedSearchOst(db, seller);
  check((await reveal(db, '8'.repeat(64), randomUUID(), ostNumber)).result.kind, 'OST');
  check((await reveal(db, '8'.repeat(64))).result.kind, 'IST');
  check((await db.query('select count(*)::int n from private.sale_team_search_contacts')).rows[0].n, 3);
  const ip = '1'.repeat(64),
    request = randomUUID();
  check((await reveal(db, ip, request)).result.aaNumber, 'AAI20010001');
  check((await reveal(db, ip, request)).limited, false);
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_search_disclosures where ip_hash=$1',
        [ip],
      )
    ).rows[0].n,
    1,
  );
  await reveal(db, ip);
  await reveal(db, ip);
  check((await reveal(db, ip, request)).limited, false);
  check((await reveal(db, ip)).limited, true);
  check((await reveal(db, '2'.repeat(64), randomUUID(), 'AAI20019999')).result, null);
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_search_disclosures where ip_hash=$1',
        ['2'.repeat(64)],
      )
    ).rows[0].n,
    0,
  );
  await db.query(
    "update private.sale_team_search_disclosures set disclosed_at=clock_timestamp()-interval '24 hours' where ip_hash=$1",
    [ip],
  );
  check((await reveal(db, ip)).limited, false);
  const raceIp = '3'.repeat(64);
  const clients = await Promise.all(Array.from({ length: 8 }, () => connect()));
  const raced = await Promise.all(clients.map((client) => reveal(client, raceIp)));
  check(raced.filter((r) => !r.limited && r.result).length, 3);
  check(
    (
      await db.query(
        'select count(*)::int n from private.sale_team_search_disclosures where ip_hash=$1',
        [raceIp],
      )
    ).rows[0].n,
    3,
  );
  const revokedIp = '4'.repeat(64),
    revokedRequest = randomUUID();
  await reveal(db, revokedIp, revokedRequest);
  await db.query("update public.staff_users set status='suspended' where id=$1", [seller]);
  check((await reveal(db, revokedIp, revokedRequest)).result, null);
  await db.query("update public.staff_users set status='active' where id=$1", [seller]);
  await assert.rejects(
    reveal(db, '5'.repeat(64), randomUUID(), 'AAI20010001', randomUUID()),
    /CONTACT_REQUIRED/,
  );
  checks++;
  for (let i = 0; i < 20; i++)
    await db.query('select public.begin_sale_team_search($1,$2)', ['6'.repeat(64), 'AAI20019999']);
  check(
    (
      await db.query('select public.begin_sale_team_search($1,$2) r', [
        '6'.repeat(64),
        'AAI20010001',
      ])
    ).rows[0].r.allowed,
    false,
  );
  for (let i = 0; i < 30; i++) await db.query('select public.begin_sale_team_search($1,$2)', ['7'.repeat(64), 'AAI20010001']);
  check((await db.query('select public.begin_sale_team_search($1,$2) r', ['7'.repeat(64), 'AAI20010001'])).rows[0].r.allowed, false);
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const table of [
      'sale_team_search_contacts',
      'sale_team_search_disclosures',
      'sale_team_search_attempts',
    ]) {
      await db.query('begin');
      await db.query(`set local role ${role}`);
      await assert.rejects(db.query(`select * from private.${table}`), (e) => e.code === '42501');
      checks++;
      await db.query('rollback');
    }
    if (role !== 'service_role') {
      await db.query('begin');
      await db.query(`set local role ${role}`);
      await assert.rejects(
        db.query('select public.sale_team_search_contact_exists($1)', [contact]),
        (e) => e.code === '42501',
      );
      checks++;
      await db.query('rollback');
    }
  }
  await db.query('begin');
  await db.query('set local role service_role');
  check(
    (await db.query('select public.sale_team_search_contact_exists($1) exists', [contact])).rows[0]
      .exists,
    true,
  );
  await db.query('rollback');
  await db.query(
    "update private.sale_team_search_contacts set created_at=now()-interval '31 days'",
  );
  await db.query(
    "update private.sale_team_search_attempts set updated_at=now()-interval '31 days'",
  );
  await db.query(
    "update private.sale_team_search_disclosures set disclosed_at=now()-interval '31 days'",
  );
  await db.query('select public.cleanup_sale_team_search(30)');
  check(
    (await db.query('select public.sale_team_search_contact_exists($1) exists', [contact])).rows[0]
      .exists,
    false,
  );
  for (const table of [
    'sale_team_search_contacts',
    'sale_team_search_disclosures',
    'sale_team_search_attempts',
  ])
    check((await db.query(`select count(*)::int n from private.${table}`)).rows[0].n, 0);
  await assert.rejects(db.query('select public.cleanup_sale_team_search(0)'), /RETENTION_REQUIRED/);
  checks++;
  const migration = fs
    .readdirSync('supabase/migrations')
    .find((n) => n.endsWith('_afhomes_public_sale_team_search.sql'));
  await db.query(fs.readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  const results = await db.query(fs.readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
  for (const r of Array.isArray(results) ? results : [results]) check(r.rowCount, 0);
  return checks;
}
