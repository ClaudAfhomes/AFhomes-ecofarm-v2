/** Synthetic, rollback-only proof. Caller owns the transaction. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';

export async function runBulkCommissionRuleChecks(db: Client): Promise<number> {
  let checks = 0;
  const eq = (actual: unknown, expected: unknown) => {
    assert.deepEqual(actual, expected);
    checks++;
  };
  const denied = async (fn: () => Promise<unknown>, pattern: RegExp) => {
    await db.query('savepoint bulk_denied');
    try {
      await assert.rejects(fn, pattern);
      checks++;
    } finally {
      await db.query('rollback to savepoint bulk_denied');
    }
  };
  const people: Record<string, string> = {};
  for (const role of ['super_admin', 'sales_manager', 'finance']) {
    const id = randomUUID();
    const email = id + '@example.invalid';
    await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
    await db.query(
      "insert into public.staff_users(id,email,full_name,status) values($1,$2,'BULK RULE TEST','active')",
      [id, email],
    );
    await db.query(
      'insert into public.staff_role_assignments(staff_id,role_id) select $1,id from public.roles where slug=$2',
      [id, role],
    );
    people[role] = id;
  }
  const actor = people.super_admin!;
  const seller = people.sales_manager!;
  const configure = (ids = [seller], rate = '0.05', from = '2026-11-18', by = actor) =>
    db
      .query('select public.bulk_set_commission_rate($1,$2,$3,$4) result', [ids, rate, from, by])
      .then((r) => r.rows[0].result);
  eq(await configure(), { created: 1, replaced: 0 });
  eq(await configure(), { created: 0, replaced: 0 });
  eq(await configure([seller], '0.06', '2026-12-01'), { created: 1, replaced: 1 });
  const rules = (
    await db.query(
      'select rate,effective_from::text,effective_until::text,is_active from public.commission_rules where target_id=$1 order by effective_from',
      [seller],
    )
  ).rows;
  eq(rules, [
    { rate: '0.05', effective_from: '2026-11-18', effective_until: '2026-11-30', is_active: true },
    { rate: '0.06', effective_from: '2026-12-01', effective_until: null, is_active: true },
  ]);
  const count = async () =>
    (
      await db.query('select count(*)::int n from public.commission_rules where target_id=$1', [
        seller,
      ])
    ).rows[0].n;
  await denied(() => configure([seller, 'ffffffff-ffff-ffff-ffff-ffffffffffff'], '0.08'), /COMMISSION_SELLER_NOT_ELIGIBLE/);
  eq(await count(), 2);
  eq(
    (
      await db.query(
        "select count(*)::int n from public.audit_events where actor_id=$1 and action='COMMISSION_RULE_CREATED'",
        [actor],
      )
    ).rows[0].n,
    2,
  );
  await denied(() => configure([seller], '2'), /COMMISSION_BULK_INVALID/);
  await denied(() => configure([seller, seller]), /COMMISSION_BULK_INVALID/);
  await denied(
    () => configure([seller], '0.05', '2026-11-18', people.finance!),
    /PERMISSION|FORBIDDEN/,
  );
  await db.query("update public.staff_users set status='inactive' where id=$1", [seller]);
  await denied(() => configure(), /COMMISSION_SELLER_NOT_ELIGIBLE/);
  eq(
    (
      await db.query(
        "select has_function_privilege('authenticated','public.bulk_set_commission_rate(uuid[],text,date,uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  eq(
    (
      await db.query(
        "select has_function_privilege('anon','public.bulk_set_commission_rate(uuid[],text,date,uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    false,
  );
  eq(
    (
      await db.query(
        "select has_function_privilege('service_role','public.bulk_set_commission_rate(uuid[],text,date,uuid)','EXECUTE') allowed",
      )
    ).rows[0].allowed,
    true,
  );
  return checks;
}

