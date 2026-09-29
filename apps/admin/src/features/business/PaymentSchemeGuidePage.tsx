import { Alert, EmptyState, ErrorState, PageHeader, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@jad/ui';
import { useQuery } from '@tanstack/react-query';
import { divideMoneyExact, formatMoney, multiplyMoney, subtractMoney } from '@jad/shared';

import { getCardProducts } from './services';
import styles from './PaymentSchemeGuidePage.module.css';

/**
 * Internal IST payment-scheme reference (staff only).
 *
 * System-native rendering of the VIP PAYMENT SCHEME GUIDELINES. Tier figures
 * come from the live card-plan catalogue (never hardcoded), and the sample
 * schedules use the same exact-decimal helpers as the sale dialog preview -
 * but every sale figure is still frozen server-side at creation. This page
 * carries NO prices to the customer: it lives behind the staff guard, and the
 * customer portal never links here.
 */
export function PaymentSchemeGuidePage() {
  const plans = useQuery({ queryKey: ['business', 'card-products'], queryFn: () => getCardProducts() });
  const active = (plans.data ?? []).filter((p) => p.isActive && p.categoryIsActive);

  return (
    <section>
      <PageHeader
        title="Payment Scheme Guide"
        description="Standard offer first, then the authorized internal move. Reservation is always included in the total."
      />
      <Alert variant="warning" title="Internal sales team use only">
        Do not share this page, its figures, or the move playbook with clients. Clients see only
        the standard offer for their own tier and their own agreed scheme.
      </Alert>

      {plans.isPending ? (
        <p role="status" className={styles.state}>Loading tiers…</p>
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={plans.refetch} />
      ) : active.length === 0 ? (
        <EmptyState title="No active tiers" description="Activate a card plan to see its scheme guide." />
      ) : (
        <>
          <h2 className={styles.sectionTitle}>Standard offer</h2>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Tier</TableHeaderCell>
                  <TableHeaderCell align="right">Spot Cash (7 days)</TableHeaderCell>
                  <TableHeaderCell align="right">4-Month Installment</TableHeaderCell>
                  <TableHeaderCell align="right">Monthly</TableHeaderCell>
                  <TableHeaderCell>Validity</TableHeaderCell>
                  <TableHeaderCell>Moves</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {active.map((plan) => (
                  <TableRow key={plan.id}>
                    <TableCell label="Tier">{plan.name}</TableCell>
                    <TableCell label="Spot Cash" align="right">{formatMoney(plan.cashPrice)}</TableCell>
                    <TableCell label="4-Month Installment" align="right">
                      {formatMoney(plan.installmentPrice)}
                    </TableCell>
                    <TableCell label="Monthly" align="right">
                      {formatMoney(
                        divideMoneyExact(
                          subtractMoney(plan.installmentPrice, plan.reservationFee),
                          plan.standardInstallmentMonths,
                        ),
                      )}{' '}
                      × {plan.standardInstallmentMonths}
                    </TableCell>
                    <TableCell label="Validity">{plan.validityYears} years</TableCell>
                    <TableCell label="Moves">
                      {[
                        plan.moveAEnabled ? 'A' : null,
                        plan.moveB1Enabled ? 'B1' : null,
                        plan.moveB2Enabled ? 'B2' : null,
                      ]
                        .filter(Boolean)
                        .join(' · ') || 'Standard only'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <p className={styles.note}>
            Reservation fee {formatMoney(active[0]!.reservationFee)} on every tier and every scheme —
            already applied toward the total, never added on top.
          </p>

          <h2 className={styles.sectionTitle}>Internal flow</h2>
          <ul className={styles.flow}>
            <li>Spot Cash → Move A (same Spot Cash total; reservation upfront, balance over 4 months).</li>
            <li>4-Month Installment → Move B1 first (40% down including reservation, balance over 12 months).</li>
            <li>Move B2 (25% down including reservation, balance over 12 months) only if B1 does not fit.</li>
            <li>Bronze: Spot Cash, Move A, and standard 4-month only. Never B1/B2.</li>
          </ul>

          <h2 className={styles.sectionTitle}>Sample schedules</h2>
          <div className="table-scroll">
            <Table>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Scheme</TableHeaderCell>
                  <TableHeaderCell align="right">Total</TableHeaderCell>
                  <TableHeaderCell align="right">Upfront</TableHeaderCell>
                  <TableHeaderCell align="right">Monthly</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {active.flatMap((plan) =>
                  ([
                    { code: 'Move A', months: 4, upfront: plan.reservationFee },
                    { code: 'Standard 4-month', months: plan.standardInstallmentMonths, upfront: plan.reservationFee },
                    ...(plan.moveB1Enabled
                      ? [{ code: 'Move B1', months: 12, upfront: multiplyMoney(plan.installmentPrice, '0.40') }]
                      : []),
                    ...(plan.moveB2Enabled
                      ? [{ code: 'Move B2', months: 12, upfront: multiplyMoney(plan.installmentPrice, '0.25') }]
                      : []),
                  ] as const).map((row) => {
                    const base = row.code === 'Move A' ? plan.cashPrice : plan.installmentPrice;
                    return (
                      <TableRow key={`${plan.id}-${row.code}`}>
                        <TableCell label="Scheme">
                          {plan.name} · {row.code}
                        </TableCell>
                        <TableCell label="Total" align="right">{formatMoney(base)}</TableCell>
                        <TableCell label="Upfront" align="right">{formatMoney(row.upfront)}</TableCell>
                        <TableCell label="Monthly" align="right">
                          {formatMoney(
                            divideMoneyExact(subtractMoney(base, row.upfront), row.months),
                          )}{' '}
                          × {row.months}
                        </TableCell>
                      </TableRow>
                    );
                  }),
                )}
              </TableBody>
            </Table>
          </div>

          <h2 className={styles.sectionTitle}>Golden rules</h2>
          <ol className={styles.rules}>
            <li>Always start with the standard offer.</li>
            <li>Spot Cash track may only move to Move A.</li>
            <li>Installment track: offer B1 first, B2 only if B1 does not fit.</li>
            <li>Never chain Move A into B1 or B2.</li>
            <li>Bronze: B1 and B2 never allowed (enforced server-side).</li>
            <li>Move A keeps the Spot Cash total; B1/B2 keep the installment total. No interest, no markup.</li>
            <li>Monthly installments begin the month after the down payment is completed.</li>
          </ol>
        </>
      )}
    </section>
  );
}
