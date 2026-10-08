import { randomUUID } from 'node:crypto';
import type { Client } from 'pg';
import { makePurchaseFixtures } from './reservation-purchase-integration.js';

/** Synthetic local fixtures only; the normal integration runner owns cleanup. */
export async function runPurchaseTierMatrixChecks(world: {
  db: Client;
  check: (label: string, ok: boolean, detail?: string) => void;
  actor: string;
  finance: string;
  createdCustomers: string[];
  createdApplications: string[];
}) {
  const { db, check, finance } = world;
  // Roll back this matrix's synthetic fixtures before adjacent sections; enforce deferred constraints first.
  await db.query('begin');
  try {
    for (const [tier, scheme] of [
      ['BRONZE', 'spot_cash'],
      ['SILVER', 'spot_cash'],
      ['GOLD', 'spot_cash'],
      ['BRONZE', 'move_a'],
      ['BRONZE', 'installment_4_month'],
      ['SILVER', 'move_b1_40_12'],
      ['SILVER', 'move_b2_25_12'],
      ['GOLD', 'move_b1_40_12'],
      ['GOLD', 'move_b2_25_12'],
    ] as const) {
      const label = `${tier} ${scheme}`;
      const fixture = await makePurchaseFixtures(db, { ...world, tier, scheme });
      const purchase = await fixture.executed();
      const terms = (
        await db.query<{
          total_price: string;
          required_initial: string;
          yearly_points: number;
          validity_months: number;
        }>(
          'select total_price, required_initial, yearly_points, validity_months from public.customer_application_purchase_terms where id=$1',
          [purchase.termsId],
        )
      ).rows[0]!;
      const record = async (amount: string, reference: string) =>
        (
          await db.query<{ id: string }>(
            'select public.record_reservation_payment_once($1,$2,$3,$4) as id',
            [
              randomUUID(),
              purchase.reservationId,
              { amount, method: 'cash', paymentType: 'installment', reference },
              finance,
            ],
          )
        ).rows[0]!.id;
      const verify = async (id: string) =>
        db.query('select public.verify_purchase_payment_once($1,$2,$3,$4,$5)', [
          randomUUID(),
          id,
          'verified',
          null,
          finance,
        ]);
      const finalize = async () =>
        (
          await db.query<{ id: string }>(
            'select public.finalize_reservation_purchase_once($1,$2,$3) as id',
            [randomUUID(), purchase.reservationId, finance],
          )
        ).rows[0]!.id;
      const initial = await record(terms.required_initial, `${label}-INITIAL`);
      const before = (
        await db.query<{ purchase_financial_summary: { verifiedTotal: string } }>(
          'select public.purchase_financial_summary($1)',
          [purchase.reservationId],
        )
      ).rows[0]!.purchase_financial_summary;
      check(
        `${label}: recording does not count as verified money`,
        before.verifiedTotal === '0.00',
      );
      await verify(initial);
      await db.query('savepoint partial_payment_gate');
      let prematureError = '';
      try {
        await finalize();
      } catch (error) {
        prematureError = error instanceof Error ? error.message : String(error);
      }
      await db.query('rollback to savepoint partial_payment_gate');
      await db.query('release savepoint partial_payment_gate');
      check(
        `${label}: initial payment cannot finalize the purchase`,
        /NOT_FULLY_PAID/.test(prematureError),
        prematureError,
      );
      const remaining = (
        await db.query<{ amount: string }>(
          'select private.money($1::numeric - $2::numeric) amount',
          [terms.total_price, terms.required_initial],
        )
      ).rows[0]!.amount;
      await verify(await record(remaining, `${label}-BALANCE`));
      const sale = await finalize();
      check(`${label}: repeated finalization returns the same sale`, (await finalize()) === sale);
      const activated = (
        await db.query<{
          membership_id: string;
          qr_token: string | null;
          fallback_code: string | null;
        }>('select * from public.activate_card_sale($1,$2,$3)', [
          sale,
          finance,
          terms.validity_months,
        ])
      ).rows[0]!;
      const replay = (
        await db.query<{
          membership_id: string;
          qr_token: string | null;
          fallback_code: string | null;
        }>('select * from public.activate_card_sale($1,$2,$3)', [
          sale,
          finance,
          terms.validity_months,
        ])
      ).rows[0]!;
      check(
        `${label}: activation replay has the same membership and no secrets`,
        replay.membership_id === activated.membership_id &&
          replay.qr_token === null &&
          replay.fallback_code === null,
      );
      const state = (
        await db.query<{
          status: string;
          sale_count: number;
          membership_count: number;
          payment_count: number;
          points: number;
          validity: number;
        }>(
          `select s.status, (select count(*)::int from public.card_sales where customer_id=s.customer_id) sale_count,
       (select count(*)::int from public.memberships where sale_id=s.id) membership_count,
       (select count(*)::int from public.payments where sale_id=s.id and status='verified') payment_count,
       a.balance points, s.validity_months_snapshot validity
       from public.card_sales s join public.memberships m on m.sale_id=s.id join public.points_accounts a on a.membership_id=m.id where s.id=$1`,
          [sale],
        )
      ).rows[0]!;
      check(
        `${label}: exactly one active sale and membership with two verified payments`,
        state.status === 'active' &&
          state.sale_count === 1 &&
          state.membership_count === 1 &&
          state.payment_count === 2,
      );
      check(
        `${label}: points and membership term match frozen terms`,
        Number(state.points) === terms.yearly_points && state.validity === terms.validity_months,
      );
    }
    await db.query('set constraints all immediate');
  } finally {
    await db.query('rollback');
  }
}
