import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PAYMENT_SCHEME_LABELS, type CardProduct, type PaymentScheme } from '@jad/contracts';
import { divideMoneyExact, formatMoney, multiplyMoney, subtractMoney } from '@jad/shared';
import { Alert, Button, DetailCard, DetailField, DetailFieldGrid, Dialog } from '@jad/ui';

import { createSale } from './services';
import styles from './SaleApplicationDialog.module.css';

type Track = 'spot' | 'installment';

export type DisplaySchedule = {
  total: string;
  reservation: string;
  initial: string;
  months: number | null;
  monthly: string | null;
};

/**
 * Display-only schedule preview, computed with exact-decimal helpers.
 * The server re-derives every figure from the plan row and freezes it, so
 * this preview can never change what a sale costs - the request carries only
 * the customer, the plan, and the scheme code.
 */
export function previewSchedule(plan: CardProduct, scheme: PaymentScheme): DisplaySchedule {
  const onSpotTrack = scheme === 'spot_cash' || scheme === 'move_a';
  const total = onSpotTrack ? plan.cashPrice : plan.installmentPrice;
  const reservation = plan.reservationFee;
  if (scheme === 'spot_cash') {
    return { total, reservation, initial: reservation, months: null, monthly: null };
  }
  if (scheme === 'move_a') {
    const monthly = divideMoneyExact(subtractMoney(total, reservation), 4);
    return { total, reservation, initial: reservation, months: 4, monthly };
  }
  if (scheme === 'installment_4_month') {
    const monthly = divideMoneyExact(
      subtractMoney(total, reservation),
      plan.standardInstallmentMonths,
    );
    return { total, reservation, initial: reservation, months: plan.standardInstallmentMonths, monthly };
  }
  const rate = scheme === 'move_b1_40_12' ? '0.40' : '0.25';
  const initial = multiplyMoney(total, rate);
  const monthly = divideMoneyExact(subtractMoney(total, initial), 12);
  return { total, reservation, initial, months: 12, monthly };
}

function movesFor(plan: CardProduct, track: Track): { code: PaymentScheme; hint: string }[] {
  if (track === 'spot') {
    const moves: { code: PaymentScheme; hint: string }[] = [
      { code: 'spot_cash', hint: `Settle ${formatMoney(plan.cashPrice)} within ${plan.spotCashDays} days` },
    ];
    if (plan.moveAEnabled) {
      moves.push({ code: 'move_a', hint: 'Same Spot Cash total: reservation upfront, balance over 4 months' });
    }
    return moves;
  }
  const moves: { code: PaymentScheme; hint: string }[] = [
    {
      code: 'installment_4_month',
      hint: `Reservation, then balance over ${plan.standardInstallmentMonths} months`,
    },
  ];
  if (plan.moveB1Enabled) {
    moves.push({ code: 'move_b1_40_12', hint: '40% down (reservation included), balance over 12 months' });
  }
  if (plan.moveB2Enabled) {
    moves.push({ code: 'move_b2_25_12', hint: '25% down (reservation included), balance over 12 months' });
  }
  return moves;
}

export function SaleApplicationDialog({
  customerId,
  products,
  productsPending,
  productsError,
  onClose,
  onCreated,
}: {
  customerId: string;
  products: CardProduct[];
  productsPending: boolean;
  productsError: unknown;
  onClose: () => void;
  onCreated: () => void;
}) {
  const client = useQueryClient();
  const [productId, setProductId] = useState(() => products[0]?.id ?? '');
  const [track, setTrack] = useState<Track>('spot');
  const [scheme, setScheme] = useState<PaymentScheme>('spot_cash');

  const plan = products.find((p) => p.id === productId) ?? null;
  const moves = plan ? movesFor(plan, track) : [];
  const effectiveScheme: PaymentScheme =
    plan && moves.some((m) => m.code === scheme) ? scheme : (moves[0]?.code ?? 'spot_cash');

  const preview = (() => {
    if (!plan) return null;
    try {
      return previewSchedule(plan, effectiveScheme);
    } catch {
      return null;
    }
  })();

  const installmentHint = (() => {
    if (!plan) return null;
    try {
      return `${formatMoney(plan.reservationFee)} reservation, then ${formatMoney(
        divideMoneyExact(
          subtractMoney(plan.installmentPrice, plan.reservationFee),
          plan.standardInstallmentMonths,
        ),
      )} × ${plan.standardInstallmentMonths}`;
    } catch {
      return 'Installment pricing incomplete for this tier';
    }
  })();

  const sell = useMutation({
    mutationFn: () => createSale({ customerId, productId, paymentScheme: effectiveScheme }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['business', 'sales'] });
      onCreated();
    },
  });

  const bronzeLocked = plan !== null && track === 'installment' && !plan.moveB1Enabled && !plan.moveB2Enabled;

  return (
    <Dialog
      open
      onClose={onClose}
      title="Open a card application"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={sell.isPending}
            disabled={!plan || !preview || sell.isPending}
            onClick={() => sell.mutate()}
          >
            Confirm application
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <p className={styles.note}>
          Present the standard offer first. Then choose the authorized internal move. The price,
          reservation, schedule, validity and commission freeze server-side and never change if
          the catalogue is edited later.
        </p>

        <label className={styles.field}>
          <span className={styles.label}>Tier</span>
          <select
            aria-label="Tier"
            value={productId}
            onChange={(e) => {
              setProductId(e.target.value);
              setTrack('spot');
              setScheme('spot_cash');
            }}
            disabled={productsPending || products.length === 0}
          >
            <option value="">Select a tier</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.name} — {product.code}
              </option>
            ))}
          </select>
        </label>
        {productsPending ? <p role="status">Loading card plans…</p> : null}
        {productsError ? <p role="alert">Could not load card plans. Close and retry.</p> : null}
        {!productsPending && !productsError && products.length === 0 ? (
          <p role="status">No active card plans available.</p>
        ) : null}

        {plan ? (
          <>
            <fieldset className={styles.group}>
              <legend className={styles.legend}>Standard offer</legend>
              <div className={styles.offers}>
                <label className={`${styles.offer} ${track === 'spot' ? styles.offerActive : ''}`}>
                  <input
                    type="radio"
                    name="scheme-track"
                    checked={track === 'spot'}
                    onChange={() => {
                      setTrack('spot');
                      setScheme('spot_cash');
                    }}
                  />
                  <span className={styles.offerTitle}>Spot Cash</span>
                  <span className={styles.offerValue}>{formatMoney(plan.cashPrice)}</span>
                  <span className={styles.offerHint}>Settle within {plan.spotCashDays} days</span>
                </label>
                <label
                  className={`${styles.offer} ${track === 'installment' ? styles.offerActive : ''}`}
                >
                  <input
                    type="radio"
                    name="scheme-track"
                    checked={track === 'installment'}
                    onChange={() => {
                      setTrack('installment');
                      setScheme('installment_4_month');
                    }}
                  />
                  <span className={styles.offerTitle}>4-Month Installment</span>
                  <span className={styles.offerValue}>{formatMoney(plan.installmentPrice)}</span>
                  <span className={styles.offerHint}>{installmentHint}</span>
                </label>
              </div>
            </fieldset>

            <fieldset className={styles.group}>
              <legend className={styles.legend}>Internal move</legend>
              <div className={styles.moves} role="radiogroup" aria-label="Internal move">
                {moves.map((move) => (
                  <label key={move.code} className={styles.move}>
                    <input
                      type="radio"
                      name="scheme-move"
                      checked={effectiveScheme === move.code}
                      onChange={() => setScheme(move.code)}
                    />
                    <span>
                      <span className={styles.moveTitle}>{PAYMENT_SCHEME_LABELS[move.code]}</span>
                      <span className={styles.moveHint}>{move.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              {bronzeLocked ? (
                <p className={styles.note}>Moves B1 and B2 are not available for Bronze.</p>
              ) : null}
            </fieldset>

            {preview ? (
              <DetailCard>
                <DetailFieldGrid>
                  <DetailField label="Tier">{`${plan.name} (${plan.code})`}</DetailField>
                  <DetailField label="Payment scheme">{PAYMENT_SCHEME_LABELS[effectiveScheme]}</DetailField>
                  <DetailField label="Total price">{formatMoney(preview.total)}</DetailField>
                  <DetailField label="Reservation fee">{formatMoney(preview.reservation)}</DetailField>
                  <DetailField label="Required initial">{formatMoney(preview.initial)}</DetailField>
                  <DetailField label="Installments">
                    {preview.months && preview.monthly
                      ? `${formatMoney(preview.monthly)} × ${preview.months}`
                      : `Settle within ${plan.spotCashDays} days`}
                  </DetailField>
                  <DetailField label="Membership validity">
                    {`${plan.validityYears} year${plan.validityYears === 1 ? '' : 's'}`}
                  </DetailField>
                </DetailFieldGrid>
              </DetailCard>
            ) : (
              <Alert variant="danger" title="Plan economics incomplete">
                This tier is missing its installment pricing. Ask an administrator to complete the
                card plan before selling it on this scheme.
              </Alert>
            )}
          </>
        ) : null}
        {sell.error ? (
          <Alert variant="danger" title="Could not open the application">
            {sell.error.message}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
