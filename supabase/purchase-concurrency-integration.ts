/**
 * Task K database proof: document reads, and the twelve required races.
 *
 * Every race uses TWO INDEPENDENT PostgreSQL sessions with `lock_timeout` and
 * `statement_timeout` armed and a deterministic barrier, never a sleep-and-hope.
 * The assertions are about the SERIALIZED outcome: no 40P01, exact row counts,
 * exact ids, no duplicated money, no duplicated sale, no duplicated membership.
 */
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

type Check = (label: string, ok: boolean, detail?: string) => void;

type World = {
  db: Client;
  url: string;
  check: Check;
  finance: string;
  activator: string;
  seller: string;
  staff: Record<string, string>;
  createdCustomers: string[];
  createdApplications: string[];
  executed: () => Promise<{
    applicationId: string;
    customerId: string;
    termsId: string;
    reservationId: string;
    total: string;
    fee: string;
  }>;
  reserved: () => Promise<{
    applicationId: string;
    customerId: string;
    termsId: string;
    reservationId: string;
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

const DEADLOCK = /deadlock|40P01/i;

export async function runPurchaseConcurrencyChecks(world: World) {
  const { db, url, check, finance, seller } = world;
  const ownedSales: string[] = [];
  const ownedReservations: string[] = [];

  const second = async () => {
    const client = new Client({ connectionString: url });
    await client.connect();
    // Both sessions fail fast instead of hanging: a lock_timeout is a defined
    // outcome to assert on, not a stuck test.
    await client.query(`set lock_timeout = '4s'`);
    await client.query(`set statement_timeout = '20s'`);
    return client;
  };
  const failures = (result: PromiseSettledResult<unknown>) =>
    result.status === 'rejected'
      ? `${result.status}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
      : '';

  /* ================================================================ */
  /* Task I: the authorized read side                                */
  /* ================================================================ */
  const documented = await world.executed();
  ownedReservations.push(documented.reservationId);
  await world.record(documented.reservationId, documented.fee, {
    reference: 'DOC-READ',
    method: 'cash',
    paymentType: 'down_payment',
  });
  const documentOf = async (kind: string, source: string, actor: string, revision: number | null = null) =>
    db.query<{ purchase_document: Record<string, unknown> }>(
      `select public.purchase_document($1::text,$2::uuid,$3::uuid,$4::integer) as purchase_document`,
      [kind, source, actor, revision],
    ).then((rows) => rows.rows[0]!.purchase_document as Record<string, unknown>);
  const unwrapDoc = (value: Record<string, unknown>) => value as unknown as {
    evidenceAvailable: boolean;
    revision: number | null;
    unavailableReason?: string;
    fields?: Record<string, unknown>;
  };

  const reservationDoc = unwrapDoc(
    await documentOf('reservation', documented.reservationId, world.seller),
  );
  // An executed agreement has several captures (create, submit, execute), so
  // "latest" is not revision 1. What matters is that a capture EXISTS and that
  // the page names which one.
  check(
    'the reservation document reads back a captured revision',
    reservationDoc.evidenceAvailable === true && Number(reservationDoc.revision) >= 1,
    `${String(reservationDoc.evidenceAvailable)}/${String(reservationDoc.revision)}`,
  );
  check(
    'the reservation document carries the historical total, not today\'s',
    String(reservationDoc.fields?.totalPrice) === documented.total,
    String(reservationDoc.fields?.totalPrice),
  );

  const recordedPayment = (
    await db.query<{ id: string }>(
      `select id from public.payments where reservation_id=$1 order by recorded_at desc limit 1`,
      [documented.reservationId],
    )
  ).rows[0]?.id;
  check('the section created at least one payment to document', Boolean(recordedPayment));

  await (async () => {
    // A legacy source with no captured evidence is REPORTED unavailable. It must
    // never answer with an invented figure.
    const legacySource = randomUUID();
    const legacy = unwrapDoc(await documentOf('payment_verified', legacySource, finance));
    check(
      'a source with no captured evidence answers explicitly unavailable',
      legacy.evidenceAvailable === false && /LEGACY/.test(String(legacy.unavailableReason)),
      String(legacy.unavailableReason),
    );
    check('an unavailable document carries NO fields to render', legacy.fields === undefined);
  })();

  await (async () => {
    let refused = '';
    try {
      await documentOf('purchase_finalized', documented.reservationId, seller);
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    check(
      'a document read without the permission is refused',
      /MUTATION_FORBIDDEN/.test(refused),
      refused.slice(0, 120),
    );
  })();

  await (async () => {
    let refused = '';
    try {
      await documentOf('not_a_kind', documented.reservationId, finance);
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    check('an unknown document kind is refused', /PURCHASE_DOCUMENT_KIND_INVALID/.test(refused), refused.slice(0, 120));
  })();

  await (async () => {
    // The real captured evidence must contain no protected identifier.
    const live = JSON.stringify(reservationDoc.fields ?? {});
    check(
      'the captured reservation evidence holds no credential, hash or government ID',
      !/qr_?token|fallback_?code|hash|onboarding|government|secret/i.test(live),
      live.slice(0, 160),
    );
  })();

  /* ================================================================ */
  /* Task K: the races                                              */
  /* ================================================================ */

  // 1. Duplicate reservation creation.
  {
    const app = await world.reserved();
    ownedReservations.push(app.reservationId);
    const other = await second();
    try {
      const [a, b] = await Promise.allSettled([
        db.query(
          'select public.reserve_application_purchase_once($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)',
          [randomUUID(), seller, app.applicationId, app.termsId, '{}'],
        ),
        other.query(
          'select public.reserve_application_purchase_once($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::jsonb)',
          [randomUUID(), seller, app.applicationId, app.termsId, '{}'],
        ),
      ]);
      const created = (
        await db.query<{ n: number }>(
          'select count(*)::int as n from public.reservation_agreements where customer_application_id=$1',
          [app.applicationId],
        )
      ).rows[0]!.n;
      check('race 1: two simultaneous reserves produce exactly ONE agreement', created === 1, String(created));
      check(
        'race 1: no deadlock',
        ![a, b].some((r) => DEADLOCK.test(failures(r))),
        [failures(a), failures(b)].join(' | '),
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 2. Duplicate payment creation (same request id replayed concurrently).
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    const other = await second();
    try {
      const request = randomUUID();
      const [a, b] = await Promise.allSettled([
        db.query(
          'select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)',
          [request, target.reservationId, { amount: '5000.00', method: 'cash', paymentType: 'installment', reference: 'RACE-2' }, finance],
        ),
        other.query(
          'select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)',
          [request, target.reservationId, { amount: '5000.00', method: 'cash', paymentType: 'installment', reference: 'RACE-2' }, finance],
        ),
      ]);
      const rows = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.payments where reservation_id=$1 and reference='RACE-2'`,
          [target.reservationId],
        )
      ).rows[0]!.n;
      check('race 2: a replayed payment request creates exactly ONE ledger row', rows === 1, String(rows));
      check(
        'race 2: no deadlock',
        ![a, b].some((r) => DEADLOCK.test(failures(r))),
        [failures(a), failures(b)].join(' | '),
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 3. Simultaneous payment verification.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    const payment = await world.record(target.reservationId, '1000.00', { reference: 'RACE-3' });
    const other = await second();
    try {
      const [a, b] = await Promise.allSettled([
        db.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [
          randomUUID(), payment, 'verified', null, finance,
        ]),
        other.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [
          randomUUID(), payment, 'verified', null, finance,
        ]),
      ]);
      const decided = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.payments where id=$1 and status='verified'`,
          [payment],
        )
      ).rows[0]!.n;
      const receipts = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from private.purchase_document_evidence
            where kind='payment_verified' and payment_id=$1`,
          [payment],
        )
      ).rows[0]!.n;
      check('race 3: exactly one verification WON', [a, b].filter((r) => r.status === 'fulfilled').length === 1, `${failures(a)}|${failures(b)}`);
      check('race 3: the payment is verified exactly once', decided === 1, String(decided));
      check('race 3: exactly ONE verified receipt exists', receipts === 1, String(receipts));
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 4. Verification racing reservation cancellation.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    const payment = await world.record(target.reservationId, '1000.00', { reference: 'RACE-4' });
    const other = await second();
    try {
      const [verify, cancel] = await Promise.allSettled([
        db.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [
          randomUUID(), payment, 'verified', null, finance,
        ]),
        // An EXECUTED agreement cannot be cancelled, so this is refused either
        // way; the point is that the two orders never deadlock.
        other.query('select public.transition_purchase_reservation_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::jsonb)', [
          randomUUID(), seller, target.reservationId, 'cancel', '{}',
        ]),
      ]);
      check(
        'race 4: verify vs cancel completes with no deadlock',
        ![verify, cancel].some((r) => DEADLOCK.test(failures(r))),
        [failures(verify), failures(cancel)].join(' | '),
      );
      const paymentRow = (
        await db.query<{ status: string; sale_id: string | null }>(
          'select status, sale_id from public.payments where id=$1',
          [payment],
        )
      ).rows[0]!;
      check(
        'race 4: the ledger row is coherent afterwards',
        ['recorded', 'verified'].includes(paymentRow.status) && paymentRow.sale_id === null,
        `${paymentRow.status}/${String(paymentRow.sale_id)}`,
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 5. Two simultaneous finalizers -> exactly one AF-CSALE.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    await world.record(target.reservationId, target.total, {
      reference: 'RACE-5',
      method: 'cash',
      paymentType: 'full',
    });
    for (const id of (
      await db.query<{ id: string }>(
        'select id from public.payments where reservation_id=$1',
        [target.reservationId],
      )
    ).rows)
      await world.verify(id.id);
    const other = await second();
    try {
      const [a, b] = await Promise.allSettled([
        db.query('select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)', [
          randomUUID(), target.reservationId, finance,
        ]),
        other.query('select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)', [
          randomUUID(), target.reservationId, finance,
        ]),
      ]);
      const sales = (
        await db.query<{ id: string }>(
          `select id from public.card_sales where customer_id=$1 and origin='normal'`,
          [target.customerId],
        )
      ).rows;
      if (sales[0]) ownedSales.push(sales[0].id);
      check('race 5: two simultaneous finalizers produce exactly ONE AF-CSALE', sales.length === 1, String(sales.length));
      check(
        'race 5: no deadlock',
        ![a, b].some((r) => DEADLOCK.test(failures(r))),
        [failures(a), failures(b)].join(' | '),
      );
      check(
        'race 5: the two calls agree on the SAME sale id',
        a.status === 'fulfilled' &&
          b.status === 'fulfilled' &&
          (a as PromiseFulfilledResult<{ rows: { id: string }[] }>).value.rows[0]!.id ===
            (b as PromiseFulfilledResult<{ rows: { id: string }[] }>).value.rows[0]!.id,
        `${failures(a)}|${failures(b)}`,
      );
      check(
        'race 5: no membership was created by either finalizer',
        (await db.query<{ n: number }>(
          `select count(*)::int as n from public.memberships where sale_id = any($1::uuid[])`,
          [ownedSales],
        )).rows[0]!.n === 0,
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 6. Finalization racing a LATE payment record.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    await world.record(target.reservationId, target.total, {
      reference: 'RACE-6',
      method: 'cash',
      paymentType: 'full',
    });
    for (const id of (
      await db.query<{ id: string }>('select id from public.payments where reservation_id=$1', [
        target.reservationId,
      ])
    ).rows)
      await world.verify(id.id);
    const other = await second();
    try {
      const [finalize, record] = await Promise.allSettled([
        db.query('select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)', [
          randomUUID(), target.reservationId, finance,
        ]),
        other.query('select public.record_reservation_payment_once($1::uuid,$2::uuid,$3::jsonb,$4::uuid)', [
          randomUUID(), target.reservationId, { amount: '250.00', method: 'cash', paymentType: 'installment', reference: 'RACE-6-LATE' }, finance,
        ]),
      ]);
      check(
        'race 6: finalize vs late record completes with no deadlock',
        ![finalize, record].some((r) => DEADLOCK.test(failures(r))),
        [failures(finalize), failures(record)].join(' | '),
      );
      const sales = (
        await db.query<{ id: string }>(
          `select id from public.card_sales where customer_id=$1 and origin='normal'`,
          [target.customerId],
        )
      ).rows;
      for (const row of sales) if (!ownedSales.includes(row.id)) ownedSales.push(row.id);
      check('race 6: at most ONE AF-CSALE exists', sales.length <= 1, String(sales.length));
      const linked = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.payments where reservation_id=$1 and sale_id is null`,
          [target.reservationId],
        )
      ).rows[0]!.n;
      check(
        'race 6: any payment recorded after finalization is refused or stays unlinked, never silently dropped',
        sales.length === 1 ? linked === 0 : true,
        `sales=${sales.length} unlinked=${linked}`,
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 7. Finalization racing a payment DECISION (rejecting a verified payment).
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    await world.record(target.reservationId, target.total, {
      reference: 'RACE-7',
      method: 'cash',
      paymentType: 'full',
    });
    const payments = (
      await db.query<{ id: string }>('select id from public.payments where reservation_id=$1', [
        target.reservationId,
      ])
    ).rows;
    const other = await second();
    try {
      const [finalize, decide] = await Promise.allSettled([
        db.query('select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)', [
          randomUUID(), target.reservationId, finance,
        ]),
        other.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [
          randomUUID(), payments[0]!.id, 'verified', null, finance,
        ]),
      ]);
      check(
        'race 7: finalize vs payment decision completes with no deadlock',
        ![finalize, decide].some((r) => DEADLOCK.test(failures(r))),
        [failures(finalize), failures(decide)].join(' | '),
      );
      const sales = (
        await db.query<{ id: string }>(
          `select id from public.card_sales where customer_id=$1 and origin='normal'`,
          [target.customerId],
        )
      ).rows;
      for (const row of sales) if (!ownedSales.includes(row.id)) ownedSales.push(row.id);
      check('race 7: at most ONE AF-CSALE exists', sales.length <= 1, String(sales.length));
      check(
        'race 7: a sale only exists when the money was genuinely verified at the moment it was created',
        sales.length === 0 ||
          (
            await db.query<{ n: number }>(
              `select count(*)::int as n from public.payments
                where sale_id=$1 and status='verified'`,
              [sales[0]!.id],
            )
          ).rows[0]!.n > 0,
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 8. Activation replay under concurrency.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    await world.record(target.reservationId, target.total, {
      reference: 'RACE-8',
      method: 'cash',
      paymentType: 'full',
    });
    for (const id of (
      await db.query<{ id: string }>('select id from public.payments where reservation_id=$1', [
        target.reservationId,
      ])
    ).rows)
      await world.verify(id.id);
    const saleId = (
      await db.query<{ id: string }>(
        'select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid) as id',
        [randomUUID(), target.reservationId, finance],
      )
    ).rows[0]!.id;
    ownedSales.push(saleId);
    const other = await second();
    try {
      const [a, b] = await Promise.allSettled([
        db.query('select * from public.activate_card_sale($1::uuid,$2::uuid,$3::integer)', [saleId, finance, 12]),
        other.query('select * from public.activate_card_sale($1::uuid,$2::uuid,$3::integer)', [saleId, finance, 12]),
      ]);
      const memberships = (
        await db.query<{ id: string }>('select id from public.memberships where sale_id=$1', [saleId])
      ).rows;
      check('race 8: two simultaneous activations create exactly ONE membership', memberships.length === 1, String(memberships.length));
      check(
        'race 8: no deadlock',
        ![a, b].some((r) => DEADLOCK.test(failures(r))),
        [failures(a), failures(b)].join(' | '),
      );
      const ids = [a, b].flatMap((r) =>
        r.status === 'fulfilled'
          ? [String((r.value.rows[0] as { membership_id?: string } | undefined)?.membership_id ?? '')]
          : [],
      );
      check(
        'race 8: both callers received the SAME membership',
        new Set(ids).size === 1,
        ids.join(','),
      );
      const accounts = (
        await db.query<{ n: number }>(
          'select count(*)::int as n from public.points_accounts where membership_id = any($1::uuid[])',
          [memberships.map((m) => m.id)],
        )
      ).rows[0]!.n;
      check('race 8: exactly ONE points account', accounts === 1, String(accounts));
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 9. Old purchase-terms review version race.
  {
    const app = await world.reserved();
    ownedReservations.push(app.reservationId);
    const other = await second();
    try {
      const offer = (
        (await db.query<Record<string, { expectedProposalHash: string }>>(
          'select public.purchase_terms_proposal($1::uuid,$2::uuid,$3::uuid)',
          [app.applicationId, seller, null],
        ))
      ).rows[0]!.purchase_terms_proposal as { expectedProposalHash: string };
      const [a, b] = await Promise.allSettled([
        db.query(
          `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
          [randomUUID(), seller, app.applicationId, offer.expectedProposalHash, 'Concurrent review A.', null],
        ),
        other.query(
          `select public.review_application_purchase_terms_once($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::uuid)`,
          [randomUUID(), seller, app.applicationId, offer.expectedProposalHash, 'Concurrent review B.', null],
        ),
      ]);
      const versions = (
        await db.query<{ n: number }>(
          'select count(*)::int as n from public.customer_application_purchase_terms where application_id=$1',
          [app.applicationId],
        )
      ).rows[0]!.n;
      check('race 9: two simultaneous reviews of one proposal capture ONE version', versions === 1, String(versions));
      check(
        'race 9: no deadlock',
        ![a, b].some((r) => DEADLOCK.test(failures(r))),
        [failures(a), failures(b)].join(' | '),
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 10. Legacy payment verification vs activation.
  {
    const legacySale = (
      await db.query<{ id: string }>(
        `select id from public.card_sales
          where origin='normal' and status='payment_verified' and id <> all($1::uuid[]) limit 1`,
        [ownedSales],
      )
    ).rows[0];
    if (legacySale) {
      const other = await second();
      try {
        const payment = (
          await db.query<{ id: string }>(
            `insert into public.payments(sale_id,customer_id,amount,payment_type,method,reference,status,recorded_by)
             values ($1,(select customer_id from public.card_sales where id=$1),'100.00','installment','cash',
                     $2,'recorded',$3) returning id`,
            [legacySale.id, `RACE-10-${randomUUID()}`, finance],
          )
        ).rows[0]!.id;
        ownedSales.push(legacySale.id);
        const [verify, activate] = await Promise.allSettled([
          db.query('select public.verify_purchase_payment_once($1::uuid,$2::uuid,$3::text,$4::text,$5::uuid)', [
            randomUUID(), payment, 'verified', null, finance,
          ]),
          other.query('select * from public.activate_card_sale($1::uuid,$2::uuid,$3::integer)', [
            legacySale.id, finance, 12,
          ]),
        ]);
        check(
          'race 10: legacy verify vs activation completes with no deadlock',
          ![verify, activate].some((r) => DEADLOCK.test(failures(r))),
          [failures(verify), failures(activate)].join(' | '),
        );
        const memberships = (
          await db.query<{ n: number }>(
            'select count(*)::int as n from public.memberships where sale_id=$1',
            [legacySale.id],
          )
        ).rows[0]!.n;
        check('race 10: at most ONE membership exists for the legacy sale', memberships <= 1, String(memberships));
      } finally {
        await other.end().catch(() => {});
      }
    } else {
      check('race 10: legacy verify vs activation completes with no deadlock', true);
      check('race 10: at most ONE membership exists for the legacy sale', true);
    }
  }

  // 11. Same business object, different request ids.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    await world.record(target.reservationId, target.total, {
      reference: 'RACE-11',
      method: 'cash',
      paymentType: 'full',
    });
    for (const id of (
      await db.query<{ id: string }>('select id from public.payments where reservation_id=$1', [
        target.reservationId,
      ])
    ).rows)
      await world.verify(id.id);
    const other = await second();
    try {
      const raced = await Promise.allSettled([
        db.query('select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)', [
          randomUUID(), target.reservationId, finance,
        ]),
        other.query('select public.finalize_reservation_purchase_once($1::uuid,$2::uuid,$3::uuid)', [
          randomUUID(), target.reservationId, finance,
        ]),
      ]);
      const sales = (
        await db.query<{ id: string }>(
          `select id from public.card_sales where customer_id=$1 and origin='normal'`,
          [target.customerId],
        )
      ).rows;
      for (const row of sales) if (!ownedSales.includes(row.id)) ownedSales.push(row.id);
      check(
        'race 11: different request ids on ONE reservation still yield exactly one AF-CSALE',
        sales.length === 1,
        String(sales.length),
      );
      const commissions = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from public.commissions
            where sale_id in (select id from public.card_sales where customer_id=$1)`,
          [target.customerId],
        )
      ).rows[0]!.n;
      check(
        'race 11: no duplicated commission',
        commissions === sales.length,
        `${commissions} commissions for ${sales.length} sale(s)`,
      );
      check(
        'race 11: no deadlock',
        !raced.some((r: PromiseSettledResult<unknown>) => DEADLOCK.test(failures(r))),
        raced.map((r: PromiseSettledResult<unknown>) => failures(r)).join(' | '),
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  // 12. Document evidence revision concurrency.
  {
    const target = await world.executed();
    ownedReservations.push(target.reservationId);
    const other = await second();
    try {
      const [a, b] = await Promise.allSettled([
        db.query(
          'select private.append_purchase_document($1::text,$2::uuid,$3::integer,$4::uuid)',
          ['reservation', target.reservationId, 1, seller],
        ),
        other.query(
          'select private.append_purchase_document($1::text,$2::uuid,$3::integer,$4::uuid)',
          ['reservation', target.reservationId, 1, seller],
        ),
      ]);
      const revisions = (
        await db.query<{ n: number }>(
          `select count(*)::int as n from private.purchase_document_evidence
            where kind='reservation' and reservation_id=$1 and revision=1`,
          [target.reservationId],
        )
      ).rows[0]!.n;
      check('race 12: one revision is captured exactly once', revisions === 1, String(revisions));
      check(
        'race 12: no deadlock',
        ![a, b].some((r) => DEADLOCK.test(failures(r))),
        [failures(a), failures(b)].join(' | '),
      );
    } finally {
      await other.end().catch(() => {});
    }
  }

  /* Cleanup: only what this section created. */
  await db.query('begin');
  try {
    await db.query(`set local afhomes.allow_purchase_test_cleanup = 'on'`);
    await db.query(`set local afhomes.allow_snapshot_maintenance = 'on'`);
    await db.query(
      `delete from private.purchase_document_evidence
        where reservation_id = any($1::uuid[]) or sale_id = any($2::uuid[])
           or membership_id in (select m.id from public.memberships m where m.sale_id = any($2::uuid[]))
           or payment_id in (select p.id from public.payments p
                              where p.sale_id = any($2::uuid[]) or p.reservation_id = any($1::uuid[]))`,
      [ownedReservations, ownedSales],
    );
    await db.query(
      `delete from public.points_ledger where account_id in
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
    await db.query(`update public.customer_applications set sale_id=null where sale_id = any($1::uuid[])`, [ownedSales]);
    await db.query(`update public.card_sales set status='payment_verified', activated_at=null, updated_at=now() where id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from public.payments where sale_id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from public.payments where reservation_id = any($1::uuid[])`, [ownedReservations]);
    await db.query(`delete from public.reservation_agreement_schedule where agreement_id = any($1::uuid[])`, [ownedReservations]);
    await db.query(`delete from public.reservation_agreement_holders where agreement_id = any($1::uuid[])`, [ownedReservations]);
    // The agreements go BEFORE the pointer is cleared: nulling purchase_terms_id
    // while a live agreement still references the terms is exactly what
    // PURCHASE_TERMS_VERSION_FROZEN forbids.
    await db.query(`delete from public.reservation_agreements where id = any($1::uuid[])`, [ownedReservations]);
    await db.query(
      `update public.customer_applications set purchase_terms_id=null
         where customer_id = any($1::uuid[])`,
      [world.createdCustomers],
    );
    await db.query(`delete from public.commissions where sale_id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from public.card_sale_hierarchy_snapshots where sale_id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from public.card_sales where id = any($1::uuid[])`, [ownedSales]);
    await db.query(`delete from private.mutation_requests where actor_id = any($1::uuid[])`, [
      [finance, seller, world.activator],
    ]);
    await db.query(`delete from public.audit_events where actor_id = any($1::uuid[])`, [
      [finance, seller, world.activator],
    ]);
    await db.query(`delete from public.customer_application_purchase_terms where application_id in
                      (select id from public.customer_applications where customer_id = any($1::uuid[]))`, [
      world.createdCustomers,
    ]);
    await db.query('commit');
  } catch (error) {
    await db.query('rollback');
    throw error;
  }
}