import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export async function testSearchSettings(db, connect) {
  let checks = 0;
  const check = (actual, expected) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const get = async () =>
    (await db.query('select public.get_public_verification_settings() s')).rows[0].s;
  const before = await get();
  check(before.enabled, true);
  check(before.retentionDays, 30);
  const actor = randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)', [
    actor,
    `${actor}@example.invalid`,
  ]);
  await db.query(
    "insert into public.staff_users(id,email,full_name,status) values($1,$2,'Synthetic Configuration Owner','active')",
    [actor, `${actor}@example.invalid`],
  );
  await db.query(
    "insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='super_admin'",
    [actor],
  );
  const fields = {
    enabled: true,
    verificationPhone: '+639171234567',
    privacyNotice: before.privacyNotice,
    retentionDays: 7,
  };
  const update = (input, revision) =>
    db.query('select public.update_public_verification_settings($1,$2,$3) s', [
      actor,
      input,
      revision,
    ]);
  const saved = (await update(fields, before.revision)).rows[0].s;
  check(saved.retentionDays, 7);
  check(saved.enabled, true);
  check(saved.noticeVersion !== before.noticeVersion, true);
  await assert.rejects(
    update({ ...fields, retentionDays: 90 }, before.revision),
    /SETTINGS_CHANGED/,
  );
  checks++;
  check((await get()).retentionDays, 7);
  await assert.rejects(update({ ...fields, retentionDays: 0 }, saved.revision));
  checks++;
  check((await get()).retentionDays, 7);
  const contact = (
    await db.query('select public.save_sale_team_search_contact($1,$2,$3,$4) id', [
      'f'.repeat(64),
      'Synthetic Settings Visitor',
      'settings@example.invalid',
      '+639171234567',
    ])
  ).rows[0].id;
  await db.query(
    "update private.sale_team_search_contacts set created_at=now()-interval '10 days' where id=$1",
    [contact],
  );
  await db.query('select public.cleanup_sale_team_search()');
  check(
    (
      await db.query('select count(*)::int n from private.sale_team_search_contacts where id=$1', [
        contact,
      ])
    ).rows[0].n,
    0,
  );
  for (const role of ['anon', 'authenticated']) {
    check(
      (
        await db.query(
          "select has_function_privilege($1,'public.get_public_verification_settings()','execute') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
    check(
      (
        await db.query(
          "select has_function_privilege($1,'public.update_public_verification_settings(uuid,jsonb,integer)','execute') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
    check(
      (
        await db.query(
          "select has_table_privilege($1,'private.public_verification_settings','select,insert,update,delete') allowed",
          [role],
        )
      ).rows[0].allowed,
      false,
    );
  }
  await db.query(
    fs.readFileSync(
      'supabase/migrations/20261212000003_afhomes_public_verification_settings.sql',
      'utf8',
    ),
  );
  check((await get()).retentionDays, 7);
  check(
    (
      await db.query(
        "select count(*)::int n from public.audit_events where action='PUBLIC_VERIFICATION_SETTINGS_UPDATED' and actor_id=$1",
        [actor],
      )
    ).rows[0].n,
    1,
  );
  const disabled = (await update({ ...fields, enabled: false }, saved.revision)).rows[0].s;
  check(disabled.enabled, false);
  check(disabled.noticeVersion, saved.noticeVersion);
  const clients = await Promise.all([connect(), connect()]);
  const concurrent = await Promise.allSettled(clients.map((client,index) => client.query(
    'select public.update_public_verification_settings($1,$2,$3)',
    [actor,{...fields,retentionDays:index===0?60:90},disabled.revision],
  )));
  check(concurrent.filter(result=>result.status==='fulfilled').length,1);
  check(concurrent.filter(result=>result.status==='rejected'&&result.reason.code==='23505').length,1);
  check((await get()).revision,disabled.revision+1);
  const other=randomUUID();
  await db.query('insert into auth.users(id,email) values($1,$2)',[other,`${other}@example.invalid`]);
  await db.query("insert into public.staff_users(id,email,full_name,status) values($1,$2,'Synthetic Finance User','active')",[other,`${other}@example.invalid`]);
  await db.query("insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug='finance'",[other]);
  await db.query("insert into public.role_permissions(role_id,module_id,can_view,can_create,can_update,can_delete) select r.id,m.id,true,false,true,false from public.roles r cross join public.modules m where r.slug='finance' and m.key='governance.config' on conflict(role_id,module_id) do update set can_view=true,can_update=true");
  await assert.rejects(db.query('select public.update_public_verification_settings($1,$2,$3)',[other,fields,(await get()).revision]),/SETTINGS_FORBIDDEN/); checks++;
  const audit = await db.query(fs.readFileSync('supabase/security/rls_invariants.sql', 'utf8'));
  check((Array.isArray(audit) ? audit : [audit]).flatMap(result => result.rows), []);
  return checks;
}
