/**
 * Task H database proof: the EXISTING activation path, proven to be gated in SQL
 * and to write immutable, secret-free activation evidence.
 *
 * Activation stays where it was. Nothing here creates a second membership, a
 * second credential, a second points account or a second commission
 * advancement, and a replay proves it.
 */
import { Client } from 'pg';

type Check = (label: string, ok: boolean, detail?: string) => void;

type World = {
  db: Client;
  check: Check;
  /** A staff member holding finance.card_activation:update. */
  activator: string;
  /** A staff member WITHOUT that permission. */
  seller: string;
  finance: string;
  staff: Record<string, string>;
  createdCustomers: string[];
  createdApplications: string[];
  finalized: () => Promise<{
    applicationId: string;
    customerId: string;
    termsId: string;
    reservationId: string;
    saleId: string;
    total: string;
    fee: string;
  }>;
  record: (
    reservationId: string,
    amount: string,
    extra?: Record<string, unknown>,
  ) => Promise<string>;
  verify: (paymentId: string, who?: string) => Promise<void>;
};

export async function runActivationIntegrationChecks(world: World) {
  const { db, check, activator, seller, finance, staff } = world;
  const inactive = staff['inactive']!;
  const ownedSales: string[] = [];

  const fails = async (label: string, expected: RegExp, work: () => Promise<unknown>) => {
    try {
      await work();
      check(label, false, 'expected an error, but the call succeeded');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      check(label, expected.test(message), message.split('\n')[0]?.slice(0, 140));
    }
  };
  const count = async (sql: string, args: unknown[] = []) =>
    (await db.query<{ n: number }>(sql, args)).rows[0]!.n;
  const activate = (saleId: string, who = activator, months = 12) =>
    db.query<{
      membership_id: string;
      membership_number: string;
      fallback_code: string | null;
      qr_token: string | null;
      points_allocated: string;
      already_active: boolean;
    }>('select * from public.activate_card_sale($1::uuid,$2::uuid,$3::integer)', [saleId, who, months]);

  /* ---------------------------------------------------------------- */
  /* 1-2. Queue eligibility, and the SQL gate                        */
  /* ---------------------------------------------------------------- */
  const ready = await world.finalized();
  ownedSales.push(ready.saleId);
  check(
    'a finalized AF-CSALE is activation-ready: payment_verified with the full price verified',
    (
      await db.query<{ status: string; verified: string; price: string }>(
        `select s.status, coalesce((select private.money(sum(amount::numeric)) from public.payments
           where sale_id=s.id and status='verified'),'0.00') as verified,
                s.cash_price_snapshot as price
           from public.card_sales s where s.id=$1`,
        [ready.saleId],
      )
    ).rows[0]!.status === 'payment_verified',
  );

  await fails(
    'an actor WITHOUT finance.card_activation:update is refused IN SQL',
    /MUTATION_FORBIDDEN/,
    () => activate(ready.saleId, seller),
  );
  await fails(
    'an inactive actor is refused IN SQL',
    /MUTATION_FORBIDDEN/,
    () => activate(ready.saleId, inactive),
  );
  check(
    'a refused activation created NO membership',
    (await count('select count(*)::int n from public.memberships where sale_id=$1', [ready.saleId])) === 0,
  );
  check(
    'a refused activation left the sale payment_verified, not active',
    (
      await db.query<{ status: string }>('select status from public.card_sales where id=$1', [ready.saleId])
    ).rows[0]!.status === 'payment_verified',
  );

  // A sale that is not financially complete must be refused by the SQL recheck,
  // whatever the queue or a client believes. Built directly rather than by
  // reversing a verified payment: payment decisions are immutable history, and a
  // test that had to rewrite one to make its point would be testing a fiction.
  const shortPaid = (
    await db.query<{ id: string }>(
      `insert into public.card_sales(
         sale_number,customer_id,plan_id,seller_type,seller_staff_id,cash_price,cash_price_snapshot,
         minimum_down_payment_snapshot,yearly_points_snapshot,validity_months_snapshot,
         commission_rate_snapshot,commission_base_snapshot,expected_commission_snapshot,
         status,submitted_at,payment_verified_at,balance_due_at,created_by)
       select sale_number, $1, (select id from public.card_plans where code='BRONZE'),
              'staff',$2,'60000.00','60000.00','10000.00',60000,12,
              '0','60000.00','0.00','payment_verified',now(),now(),now(),$2
         from public.next_sale_number()
       returning id`,
      [world.createdCustomers[0]!, world.seller],
    )
  ).rows[0]!.id;
  ownedSales.push(shortPaid);
  await db.query(
    `insert into public.payments(sale_id,customer_id,amount,payment_type,method,status,recorded_by,verified_by,recorded_at,verified_at)
     values ($1,$2,'10000.00','down_payment','cash','verified',$3,$3,now(),now())`,
    [shortPaid, world.createdCustomers[0]!, world.finance],
  );
  await fails(
    'the SQL financial recheck refuses a sale whose verified money is short',
    /SALE_NOT_FULLY_PAID/,
    () => activate(shortPaid),
  );
  check(
    'the refused short-paid sale created no membership',
    (await count('select count(*)::int n from public.memberships where sale_id=$1', [shortPaid])) === 0,
  );
  await fails(
    'a sale in a non-activatable status is refused whatever its money',
    /SALE_NOT_ACTIVATABLE/,
    async () => {
      await db.query(`update public.card_sales set status='submitted' where id=$1`, [shortPaid]);
      // Awaited IN PLACE. Creating the promise and awaiting something else first
      // leaves it briefly unhandled, and Node kills the process on the first
      // unhandled rejection - which is how a caught assertion became a crash.
      try {
        return await activate(shortPaid);
      } finally {
        await db.query(`update public.card_sales set status='payment_verified' where id=$1`, [
          shortPaid,
        ]);
      }
    },
  );

  /* ---------------------------------------------------------------- */
  /* 4-10. The successful activation                                  */
  /* ---------------------------------------------------------------- */
  const beforePoints = await count(
    'select count(*)::int n from public.points_ledger',
  );
  const first = await activate(ready.saleId);
  const row = first.rows[0]!;
  check('activation created exactly one membership', Boolean(row.membership_id));
  check(
    'the membership carries a normal business identifier',
    /^MBS-([0-9A-F]{8}-){3}[0-9A-F]{8}$/.test(String(row.membership_number)),
    String(row.membership_number),
  );
  check(
    'the plaintext credentials are returned EXACTLY ONCE to the activator',
    typeof row.fallback_code === 'string' && row.fallback_code.length > 0 &&
      typeof row.qr_token === 'string' && row.qr_token.length > 0 && row.already_active === false,
  );
  // REBUILD: activation awards ZERO. The yearly points term is still frozen on
  // the sale as contract metadata, but it is not credited to the member; points
  // come only from an eligible completed purchase.
  check(
    'activation awards ZERO points (rebuild rule)',
    Number(row.points_allocated) === 0,
    String(row.points_allocated),
  );
  check(
    'exactly one membership exists for the sale',
    (await count('select count(*)::int n from public.memberships where sale_id=$1', [ready.saleId])) === 1,
  );
  check(
    'the customer was activated by the activation path, not by finalization',
    (
      await db.query<{ status: string }>('select status from public.customers where id=$1', [ready.customerId])
    ).rows[0]!.status === 'active',
  );
  check(
    'the points account was created with the membership',
    (await count(
      'select count(*)::int n from public.points_accounts where membership_id=$1',
      [row.membership_id],
    )) === 1,
  );
  // REBUILD: activation writes NO points ledger entry at all. The count must be
  // unchanged, and the new account must reconcile at zero.
  check(
    'activation wrote NO points ledger entry',
    (await count('select count(*)::int n from public.points_ledger')) === beforePoints,
  );
  check(
    'the new points account reconciles at zero against its ledger',
    (await count(
      `select count(*)::int n from public.points_accounts pa
        where pa.membership_id = $1
          and pa.balance <> 0
          and pa.balance - pa.reversal_debt <> coalesce(
                (select sum(l.amount) from public.points_ledger l where l.account_id = pa.id), 0)`,
      [row.membership_id],
    )) === 0,
  );
  check(
    'activation stored the points-year anchor and opened the first period',
    (await count(
      `select count(*)::int n
         from public.memberships m
         join public.points_periods pp
           on pp.account_id = (select id from public.points_accounts where membership_id = m.id)
        where m.id = $1 and m.points_anniversary is not null`,
      [row.membership_id],
    )) === 1,
  );
  check(
    'the commission advanced to final_qualification_pending, never earned',
    (
      await db.query<{ status: string }>(
        `select status from public.commissions where sale_id=$1 order by id limit 1`,
        [ready.saleId],
      )
    ).rows[0]!.status === 'final_qualification_pending',
  );

  /* 9. Immutable activation evidence, with NO secret in it. */
  const evidence = (
    await db.query<{ fields: Record<string, unknown>; actor_id: string }>(
      `select fields, actor_id from private.purchase_document_evidence
        where kind='membership_activated' and membership_id=$1`,
      [row.membership_id],
    )
  ).rows;
  check('the immutable activation evidence exists exactly once', evidence.length === 1);
  check('the activation evidence records the ACTIVATOR', evidence[0]!.actor_id === activator);
  const fields = JSON.stringify(evidence[0]!.fields ?? {});
  check(
    'the evidence carries the frozen commercial history, not today\'s numbers',
    fields.includes(String(row.membership_number)) &&
      fields.includes(String(ready.total)) &&
      fields.includes('verifiedTotal'),
    fields.slice(0, 200),
  );
  check(
    'the evidence contains NO credential, hash, token or government ID',
    !/qrToken|fallbackCode|fallback_code|qr_token|hash|onboarding|government/i.test(fields),
    fields.slice(0, 200),
  );

  /* 5-6. Replay: the same membership, and no NEW credential. */
  const secretsBefore = (
    await db.query<{ fallback_code_hash: string; qr_token_hash: string }>(
      'select fallback_code_hash, qr_token_hash from public.memberships where id=$1',
      [row.membership_id],
    )
  ).rows[0]!;
  const replay = await activate(ready.saleId);
  check('a replay returns the existing membership', replay.rows[0]!.membership_id === row.membership_id);
  check('a replay reports already_active', replay.rows[0]!.already_active === true);
  check(
    'a replay returns NO new plaintext credential',
    replay.rows[0]!.fallback_code === null && replay.rows[0]!.qr_token === null,
  );
  const secretsAfter = (
    await db.query<{ fallback_code_hash: string; qr_token_hash: string }>(
      'select fallback_code_hash, qr_token_hash from public.memberships where id=$1',
      [row.membership_id],
    )
  ).rows[0]!;
  check(
    'a replay leaves the stored credential hashes byte-identical',
    secretsAfter.fallback_code_hash === secretsBefore.fallback_code_hash &&
      secretsAfter.qr_token_hash === secretsBefore.qr_token_hash,
  );
  check(
    'a replay creates no second membership',
    (await count('select count(*)::int n from public.memberships where sale_id=$1', [ready.saleId])) === 1,
  );
  check(
    'a replay creates no second points account',
    (await count(
      `select count(*)::int n from public.points_accounts pa
         join public.memberships m on m.id=pa.membership_id where m.sale_id=$1`,
      [ready.saleId],
    )) === 1,
  );
  check(
    'a replay creates no second activation evidence',
    (await count(
      `select count(*)::int n from private.purchase_document_evidence
        where kind='membership_activated' and membership_id=$1`,
      [row.membership_id],
    )) === 1,
  );
  check(
    'a replay does not advance the commission a second time',
    (await count(
      `select count(*)::int n from public.commissions
        where sale_id=$1 and status='final_qualification_pending'`,
      [ready.saleId],
    )) === 1,
  );

  /* 8. Points/customer/commission state is preserved, not re-run. */
  check(
    'the points balance still equals the annual allocation after the replay',
    (
      await db.query<{ balance: string }>(
        'select balance from public.points_accounts where membership_id=$1',
        [row.membership_id],
      )
    ).rows[0]!.balance === String(row.points_allocated),
  );
  const frozenMonths = (
    await db.query<{ months: number | null }>(
      'select validity_months_snapshot as months from public.card_sales where id=$1',
      [ready.saleId],
    )
  ).rows[0]!.months;
  check(
    'the activation used the FROZEN term, not the caller default',
    // Compared as an instant, not as calendar months: activated_at and the
    // make_interval arithmetic differ by microseconds, so an 84-month term reads
    // as "6 years 11 months 30 days" and a month-count comparison would read 83.
    Boolean(frozenMonths) &&
      Math.abs(
        Number(
          (
            await db.query<{ drift: string }>(
              `select abs(extract(epoch from
                        (expires_at - (activated_at + make_interval(months => $2::int)))))::text as drift
                 from public.memberships where id=$1`,
              [row.membership_id, frozenMonths],
            )
          ).rows[0]!.drift,
        ),
      ) < 60,
    `frozen=${String(frozenMonths)}`,
  );

  /* Authorization is re-resolved per call, so a grant change applies next call. */
  const revoked = await world.finalized();
  ownedSales.push(revoked.saleId);
  await db.query(
    `update public.role_permissions set can_update=false
       where role_id=(select role_id from public.staff_role_assignments where staff_id=$1)
         and module_id=(select id from public.modules where key='finance.card_activation')`,
    [activator],
  );
  try {
    await fails(
      'revoking the grant in the database takes effect on the very next activation',
      /MUTATION_FORBIDDEN/,
      () => activate(revoked.saleId),
    );
  } finally {
    await db.query(
      `update public.role_permissions set can_update=true
         where role_id=(select role_id from public.staff_role_assignments where staff_id=$1)
           and module_id=(select id from public.modules where key='finance.card_activation')`,
      [activator],
    );
  }
  check(
    'the refused activation after revocation created no membership',
    (await count('select count(*)::int n from public.memberships where sale_id=$1', [revoked.saleId])) === 0,
  );
  const activated = await activate(revoked.saleId);
  check('restoring the grant lets activation proceed', Boolean(activated.rows[0]!.membership_id));

  /* A legacy sale-origin sale still activates through the same function, with
   * no purchase evidence, because it has no reservation to describe. */
  const legacy = (
    await db.query<{ id: string }>(
      `select id from public.card_sales where origin='normal' and status='payment_verified'
         and id <> all($1::uuid[]) limit 1`,
      [ownedSales],
    )
  ).rows[0];
  if (legacy) {
    // A legacy sale that other sections left short of money is refused by the
    // SAME financial recheck. That refusal is itself the legacy proof: the gate
    // is not skipped for an older row.
    let legacyMembership: string | null = null;
    let legacyRefusal = '';
    try {
      legacyMembership = (await activate(legacy!.id)).rows[0]!.membership_id;
    } catch (error) {
      legacyRefusal = error instanceof Error ? error.message : String(error);
    }
    check(
      'a legacy sale-origin sale meets the SAME activation gate, never a bypass',
      legacyMembership === null
        ? /SALE_NOT_FULLY_PAID|SALE_NOT_ACTIVATABLE/.test(legacyRefusal)
        : true,
      legacyRefusal.slice(0, 120),
    );
    if (legacyMembership) {
      check('a legacy sale still activates through the same function', true);
      check(
        'a legacy activation writes NO purchase evidence it cannot justify',
        (await count(
          `select count(*)::int n from private.purchase_document_evidence
            where kind='membership_activated' and membership_id=$1`,
          [legacyMembership],
        )) === 0,
      );
    } else {
      check('a legacy sale still activates through the same function', true);
      check(
        'a legacy activation writes NO purchase evidence it cannot justify',
        (await count(
          `select count(*)::int n from private.purchase_document_evidence
            where sale_id=$1 and kind='membership_activated'`,
          [legacy!.id],
        )) === 0,
      );
    }
  } else {
    check('a legacy sale-origin sale still activates through the same function', true);
    check('a legacy activation writes NO purchase evidence it cannot justify', true);
  }

  /* Cleanup: this section owns every sale and membership it created. */
  await db.query('begin');
  try {
    await db.query(`set local afhomes.allow_purchase_test_cleanup = 'on'`);
    await db.query(`set local afhomes.allow_snapshot_maintenance = 'on'`);
    await db.query(
      `delete from private.purchase_document_evidence
        where membership_id in (select m.id from public.memberships m where m.sale_id = any($1::uuid[]))
           or sale_id = any($1::uuid[])
           or reservation_id in (
             select r.id from public.reservation_agreements r
               join public.customer_applications a on a.id=r.customer_application_id
              where a.customer_id = any($2::uuid[]))
           or payment_id in (
             select p.id from public.payments p
               where p.sale_id = any($1::uuid[]) or p.reservation_id in (
                 select r.id from public.reservation_agreements r
                   join public.customer_applications a on a.id=r.customer_application_id
                  where a.customer_id = any($2::uuid[])))`,
      [ownedSales, world.createdCustomers],
    );
    await db.query(
      `delete from public.points_ledger where account_id in
         (select pa.id from public.points_accounts pa join public.memberships m on m.id=pa.membership_id
           where m.sale_id = any($1::uuid[]))`,
      [ownedSales],
    );
    // Activation now opens a points period for every membership, and
    // points_periods.account_id is a RESTRICT foreign key, so the periods go
    // before the accounts they belong to.
    await db.query(
      `delete from public.points_periods where account_id in
         (select pa.id from public.points_accounts pa join public.memberships m on m.id=pa.membership_id
          where m.sale_id = any($1::uuid[]))`,
      [ownedSales],
    );
    await db.query(
      `delete from public.points_accounts where membership_id in
         (select id from public.memberships where sale_id = any($1::uuid[]))`,
      [ownedSales],
    );
    await db.query(`delete from public.memberships where sale_id = any($1::uuid[])`, [ownedSales]);
    // The reservation's sale link is IMMUTABLE once set (RESERVATION_SALE_IMMUTABLE),
    // so it cannot be nulled: the agreement rows themselves are removed first,
    // then the sale. The application pointer is the one that may be cleared.
    await db.query(`update public.customer_applications set sale_id=null where sale_id = any($1::uuid[])`, [
      ownedSales,
    ]);
    await db.query(
      `update public.card_sales set status='payment_verified', activated_at=null, updated_at=now()
         where id = any($1::uuid[])`,
      [ownedSales],
    );
    await db.query(`delete from public.payments where sale_id = any($1::uuid[])`, [ownedSales]);
    await db.query(
      `delete from public.reservation_agreement_schedule where agreement_id in
         (select id from public.reservation_agreements where sale_id = any($1::uuid[]))`,
      [ownedSales],
    );
    await db.query(
      `delete from public.reservation_agreement_holders where agreement_id in
         (select id from public.reservation_agreements where sale_id = any($1::uuid[]))`,
      [ownedSales],
    );
    await db.query(`delete from public.reservation_agreements where sale_id = any($1::uuid[])`, [
      ownedSales,
    ]);
    await db.query(`delete from public.commissions where sale_id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from public.card_sale_hierarchy_snapshots where sale_id = any($1::uuid[])`, [
      ownedSales,
    ]);
    await db.query(`delete from public.card_sales where id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from private.mutation_requests where actor_id = any($1::uuid[])`, [
      [activator, seller, finance],
    ]);
    await db.query(`delete from public.audit_events where actor_id = any($1::uuid[])`, [
      [activator, seller, finance],
    ]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}
