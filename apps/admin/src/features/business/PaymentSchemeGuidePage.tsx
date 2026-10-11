import {
  Alert,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import { useQuery } from '@tanstack/react-query';
import { divideMoneyExact, formatMoney, multiplyMoney, subtractMoney } from '@afhomes/shared';

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

/** One numbered panel, so every block reads in the same shape and order. */
function Section({
  index,
  title,
  hint,
  children,
}: {
  index: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.section} aria-label={title}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIndex} aria-hidden="true">
          {index}
        </span>
        <h2 className={styles.sectionTitle}>{title}</h2>
        {hint ? <p className={styles.sectionHint}>{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Loading skeleton for the guide body.
 *
 * Mirrors the real layout (header, then two panels) so the page never flashes
 * empty and never reflows when the tier figures land. The single `role="status"`
 * announces what is loading; every block inside is decorative. The
 * confidentiality banner is NOT here: it renders for real, above this.
 */
function GuideSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-label="Loading tiers…">
      <div className={styles.skeletonHeader}>
        <div className={styles.skeletonHeaderText}>
          <Skeleton style={{ height: 30, maxWidth: 320 }} />
          <Skeleton style={{ height: 16, maxWidth: 520 }} />
        </div>
        <Skeleton style={{ height: 40, width: 140 }} />
      </div>
      <div className={styles.skeletonSection} aria-hidden="true">
        <Skeleton style={{ height: 24, maxWidth: 220 }} />
        <div className={styles.skeletonRows}>
          {Array.from({ length: 3 }, (_, row) => (
            <div key={row} className={styles.skeletonRow}>
              {Array.from({ length: 6 }, (__, cell) => (
                <Skeleton key={cell} style={{ height: 16 }} />
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className={styles.skeletonSection} aria-hidden="true">
        <Skeleton style={{ height: 24, maxWidth: 200 }} />
        <div className={styles.skeletonSteps}>
          {Array.from({ length: 4 }, (_, step) => (
            <div key={step} className={styles.skeletonStep}>
              <Skeleton style={{ height: 26, width: 26, borderRadius: '50%' }} />
              <Skeleton style={{ height: 16 }} />
            </div>
          ))}
        </div>
      </div>
      <span className="sr-only">Loading tiers…</span>
    </div>
  );
}

export function PaymentSchemeGuidePage() {
  const plans = useQuery({
    queryKey: ['business', 'card-products'],
    queryFn: () => getCardProducts(),
  });
  const active = (plans.data ?? []).filter((p) => p.isActive && p.categoryIsActive);

  return (
    <section className={styles.page}>
      <PageHeader
        title="Payment Scheme Guide"
        description="Standard offer first, then the authorized internal move. Reservation is always included in the total."
        actions={
          <Button variant="secondary" onClick={() => window.print()}>
            Print guide
          </Button>
        }
      />
      {/* The confidentiality notice sits OUTSIDE the loading branch on purpose:
          a warning about what this page contains must be visible from the first
          paint, never gated behind the data it warns about. */}
      <Alert variant="warning" title="Internal sales team use only">
        Do not share this page, its figures, or the move playbook with clients. Clients see only
        the standard offer for their own tier and their own agreed scheme.
      </Alert>
      {plans.isPending ? (
        <GuideSkeleton />
      ) : plans.isError ? (
        <ErrorState error={plans.error} onRetry={plans.refetch} />
      ) : active.length === 0 ? (
        <EmptyState
          title="No active tiers"
          description="Activate a card plan to see its scheme guide."
        />
      ) : (
        <>
          <Section
            index={1}
            title="Standard offer"
            hint="The tier's published price list. Every authorized move below preserves one of these totals."
          >
            <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
              <Table>
                <TableCaption>
                  Standard published figures per active tier, taken live from the card plan
                  catalogue.
                </TableCaption>
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
                      <TableCell label="Tier" className={styles.tierCell}>
                        {plan.name}
                      </TableCell>
                      <TableCell label="Spot Cash" align="right" className={styles.numeric}>
                        {formatMoney(plan.cashPrice)}
                      </TableCell>
                      <TableCell label="4-Month Installment" align="right" className={styles.numeric}>
                        {formatMoney(plan.installmentPrice)}
                      </TableCell>
                      <TableCell label="Monthly" align="right" className={styles.numeric}>
                        {formatMoney(
                          divideMoneyExact(
                            subtractMoney(plan.installmentPrice, plan.reservationFee),
                            plan.standardInstallmentMonths,
                          ),
                        )}
                        <span className={styles.muted}> × {plan.standardInstallmentMonths}</span>
                      </TableCell>
                      <TableCell label="Validity">{plan.validityYears} years</TableCell>
                      <TableCell label="Moves">
                        {[
                          plan.moveAEnabled ? 'A' : null,
                          plan.moveB1Enabled ? 'B1' : null,
                          plan.moveB2Enabled ? 'B2' : null,
                        ].filter(Boolean).length === 0 ? (
                          <span className={styles.muted}>Standard only</span>
                        ) : (
                          <span className={styles.moves}>
                            {[
                              plan.moveAEnabled ? 'A' : null,
                              plan.moveB1Enabled ? 'B1' : null,
                              plan.moveB2Enabled ? 'B2' : null,
                            ]
                              .filter(Boolean)
                              .map((move) => (
                                <span key={move} className={styles.movePill}>
                                  Move {move}
                                </span>
                              ))}
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <p className={styles.note}>
              Reservation fee {formatMoney(active[0]!.reservationFee)} on every tier and every
              scheme: already applied toward the total, never added on top.
            </p>
          </Section>

          <Section
            index={2}
            title="Internal flow"
            hint="Work down the list. Each step is an escalation, not an alternative."
          >
            <ol className={styles.flow}>
              <li className={styles.flowStep}>
                <span className={styles.flowNode} aria-hidden="true" />
                <p className={styles.flowBody}>
                  Spot Cash → Move A (same Spot Cash total; reservation upfront, balance over 4
                  months).
                </p>
              </li>
              <li className={styles.flowStep}>
                <span className={styles.flowNode} aria-hidden="true" />
                <p className={styles.flowBody}>
                  4-Month Installment → Move B1 first (40% down including reservation, balance over
                  12 months).
                </p>
              </li>
              <li className={styles.flowStep}>
                <span className={styles.flowNode} aria-hidden="true" />
                <p className={styles.flowBody}>
                  Move B2 (25% down including reservation, balance over 12 months) only if B1 does
                  not fit.
                </p>
              </li>
              <li className={styles.flowStep}>
                <span className={styles.flowNode} aria-hidden="true" />
                <p className={styles.flowBody}>
                  Bronze: Spot Cash, Move A, and standard 4-month only. Never B1/B2.
                </p>
              </li>
            </ol>
          </Section>

          <Section
            index={3}
            title="Sample schedules"
            hint="Worked examples for each authorized scheme, per tier. These are obligations only; real cash is recorded in the payments ledger."
          >
            <div role="region" aria-label="Scrollable records" tabIndex={0} className="table-scroll">
              <Table>
                <TableCaption>
                  Sample upfront and monthly figures for every authorized scheme. Actual sale terms
                  are frozen server-side at creation.
                </TableCaption>
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
                    (
                      [
                        { code: 'Move A', months: 4, upfront: plan.reservationFee },
                        {
                          code: 'Standard 4-month',
                          months: plan.standardInstallmentMonths,
                          upfront: plan.reservationFee,
                        },
                        ...(plan.moveB1Enabled
                          ? [
                              {
                                code: 'Move B1',
                                months: 12,
                                upfront: multiplyMoney(plan.installmentPrice, '0.40'),
                              },
                            ]
                          : []),
                        ...(plan.moveB2Enabled
                          ? [
                              {
                                code: 'Move B2',
                                months: 12,
                                upfront: multiplyMoney(plan.installmentPrice, '0.25'),
                              },
                            ]
                          : []),
                      ] as const
                    ).map((row) => {
                      const base = row.code === 'Move A' ? plan.cashPrice : plan.installmentPrice;
                      return (
                        <TableRow key={`${plan.id}-${row.code}`}>
                          <TableCell label="Scheme" className={styles.tierCell}>
                            {plan.name} · {row.code}
                          </TableCell>
                          <TableCell label="Total" align="right" className={styles.numeric}>
                            {formatMoney(base)}
                          </TableCell>
                          <TableCell label="Upfront" align="right" className={styles.numeric}>
                            {formatMoney(row.upfront)}
                          </TableCell>
                          <TableCell label="Monthly" align="right" className={styles.numeric}>
                            {formatMoney(
                              divideMoneyExact(subtractMoney(base, row.upfront), row.months),
                            )}
                            <span className={styles.muted}> × {row.months}</span>
                          </TableCell>
                        </TableRow>
                      );
                    }),
                  )}
                </TableBody>
              </Table>
            </div>
          </Section>

          <Section
            index={4}
            title="Golden rules"
            hint="Non-negotiable. These are enforced server-side, not just by policy."
          >
            <ol className={styles.rules}>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>Always start with the standard offer.</span>
              </li>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>Spot Cash track may only move to Move A.</span>
              </li>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>Installment track: offer B1 first, B2 only if B1 does not fit.</span>
              </li>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>Never chain Move A into B1 or B2.</span>
              </li>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>Bronze: B1 and B2 never allowed (enforced server-side).</span>
              </li>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>
                  Move A keeps the Spot Cash total; B1/B2 keep the installment total. No interest,
                  no markup.
                </span>
              </li>
              <li>
                <span className={styles.ruleNode} aria-hidden="true" />
                <span>
                  Monthly installments begin the month after the down payment is completed.
                </span>
              </li>
            </ol>
          </Section>
        </>
      )}
    </section>
  );
}
