/**
 * Staff points-discount workflow.
 *
 * Spends a member's points against a purchase, in the only order that is safe:
 *
 *   1. QUOTE - prices the discount and spends nothing. The member sees what they
 *      would get, and can walk away.
 *   2. COMMIT - spends the points.
 *
 * The two are separate because a quote is a promise about configuration, and
 * configuration can change. The server re-validates everything at commit
 * (balance, debt, purchase status, quote expiry), so this screen never assumes a
 * quote it was shown is still good.
 *
 * What this screen deliberately does NOT do:
 *
 *  - It never records a discount as a payment. A points discount is an adjustment
 *    to what is DUE; it is never cash received. The figure shown as "verified
 *    receipts" comes from purchase_payments and never includes points.
 *  - It never computes a peso value. `pesoValue` is whatever the server priced.
 *  - It never offers to settle a purchase. Cash receipts are recorded through the
 *    existing purchase-payment flow, untouched.
 */
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Spinner,
  StatusChip,
  notifySuccess,
} from '@afhomes/ui';
import { formatMoney } from './format';
import styles from './points.module.css';

import {
  commitPointDiscount,
  getPurchaseSummary,
  listClaims,
  listPurchases,
  quotePointDiscount,
} from './points-services';
import type { ClaimRow, PurchaseRow, PurchaseSummaryRow } from './points-services';

export function PointsDiscountPage() {
  const client = useQueryClient();
  const [showHistory, setShowHistory] = useState(false);
  const purchases = useQuery({ queryKey: ['earning', 'purchases'], queryFn: listPurchases });
  const claims = useQuery({ queryKey: ['earning', 'claims'], queryFn: listClaims });

  // Only DRAFT purchases can take a discount; a settled one has already been
  // verified against its net, so changing net now would invalidate that decision.
  const drafts = (purchases.data ?? []).filter((row) => row.status === 'draft');

  return (
    <>
      <PageHeader
        title="Use Points"
        description="Spend a member's points against a purchase. A discount reduces what is DUE; it is never a cash payment."
      />

      <section aria-label="History">
        <h2>History</h2>
        <p>
          For investigating what happened. Nothing here can be edited: the points ledger is
          permanent, and there is no screen or API that changes a row in it.
        </p>
        <Button variant="secondary" onClick={() => setShowHistory((open) => !open)}>
          {showHistory ? 'Hide history' : 'Show purchase and claim history'}
        </Button>
      </section>

      {showHistory && <PointsHistory purchases={purchases.data ?? []} claims={claims.data ?? []} />}

      {purchases.isLoading && <Skeleton />}
      {purchases.isError && (
        <ErrorState
          title="Purchases unavailable"
          message="The purchase list could not be loaded, so a discount cannot be applied."
        />
      )}
      {purchases.data && drafts.length === 0 && (
        <EmptyState
          title="Nothing to discount"
          description="A discount can only be applied to a purchase that has not been settled yet."
        />
      )}

      {drafts.length > 0 && (
        <table>
          <thead>
            <tr>
              <th scope="col">Purchase</th>
              <th scope="col">Customer</th>
              <th scope="col">Gross</th>
              <th scope="col">Net due</th>
              <th scope="col">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {drafts.map((row) => (
              <tr key={row.id}>
                <td>{row.purchaseNumber}</td>
                <td>{row.customerId}</td>
                <td>{formatMoney(row.grossAmount)}</td>
                <td>{formatMoney(row.netAmount)}</td>
                <td>
                  <DiscountButton
                    purchaseId={row.id}
                    onDone={() => client.invalidateQueries({ queryKey: ['earning'] })}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/**
 * One purchase's discount. Everything happens in a dialog so the purchase list
 * behind it stays usable - a single slow action must never block the page.
 */
function DiscountButton({
  purchaseId,
  onDone,
}: {
  purchaseId: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState('');
  const [quote, setQuote] = useState<{ quoteId: string; pesoValue: string } | null>(null);

  const summary = useQuery({
    queryKey: ['earning', 'purchase', purchaseId, 'summary'],
    queryFn: () => getPurchaseSummary(purchaseId),
    enabled: open,
  });

  const ask = useMutation({
    mutationFn: () => quotePointDiscount(purchaseId, Number(points)),
    // The typed amount is PRESERVED on failure, so a member who was interrupted
    // does not have to retype it.
    onSuccess: (result) => setQuote({ quoteId: result.quoteId, pesoValue: result.pesoValue }),
  });

  const commit = useMutation({
    mutationFn: (quoteId: string) => commitPointDiscount(quoteId),
    onSuccess: (result) => {
      notifySuccess({
        title: 'Points applied',
        message: `${result.pointsSpent.toLocaleString('en-PH')} points worth ${formatMoney(result.discountApplied)}. New amount due: ${formatMoney(result.netAmount)}.`,
      });
      setOpen(false);
      setQuote(null);
      setPoints('');
      onDone();
    },
  });

  const busy = ask.isPending || commit.isPending;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Use points
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => setOpen(false)}
          title="Apply a points discount"
          footer={<Button variant="secondary" onClick={() => setOpen(false)}>Close</Button>}
        >
          {/* Only this dialog is busy. The list behind it stays interactive. */}
          <div aria-busy={busy}>
            <PurchaseFigures summary={summary.data} loading={summary.isLoading} />

            <label htmlFor="discount-points">Points to spend</label>
            <input
              id="discount-points"
              type="number"
              min={1}
              value={points}
              onChange={(event) => setPoints(event.target.value)}
              disabled={busy}
            />

            {!quote && (
              <Button
                onClick={() => ask.mutate()}
                disabled={busy || !points || Number(points) <= 0}
              >
                {ask.isPending ? 'Pricing…' : 'See what this is worth'}
              </Button>
            )}

            {ask.isError && (
              <ErrorState title="Cannot use points here" message={messageOf(ask.error)} />
            )}
            {ask.isPending && <Spinner label="Pricing the discount" />}

            {quote && (
              <>
                <p role="status">
                  {Number(points).toLocaleString('en-PH')} points are worth{' '}
                  <strong>{formatMoney(quote.pesoValue)}</strong> off this purchase.
                </p>
                <p>
                  Applying it spends the points and reduces the amount due. It does NOT count as a
                  payment - the verified receipts below are unchanged.
                </p>
                <Button
                  onClick={() => commit.mutate(quote.quoteId)}
                  // Disabled while committing, so a second click cannot spend the
                  // same quote twice. The server refuses a reused quote anyway.
                  disabled={commit.isPending}
                >
                  {commit.isPending ? 'Applying…' : 'Apply the discount'}
                </Button>
              </>
            )}

            {commit.isError && (
              <ErrorState title="Not applied" message={messageOf(commit.error)} />
            )}
          </div>
        </Dialog>
      )}
    </>
  );
}

/**
 * The figures a member must see before spending points.
 *
 * Gross, discount, net due and verified receipts are four DIFFERENT numbers and
 * are shown as four. The discount column matters most: it is what stops a member
 * believing their points were treated as cash.
 */
function PurchaseFigures({
  summary,
  loading,
}: {
  summary: PurchaseSummaryRow | undefined;
  loading: boolean;
}) {
  if (loading) return <Skeleton />;
  if (!summary) {
    return (
      <p role="status">Loading the purchase figures…</p>
    );
  }
  return (
    <>
      <table>
        <tbody>
          <tr>
            <th scope="row">Gross purchase value</th>
            <td>{formatMoney(summary.grossAmount)}</td>
          </tr>
          <tr>
            <th scope="row">Points discount</th>
            <td>{formatMoney(summary.pointsDiscountAmount)}</td>
          </tr>
          <tr>
            <th scope="row">Amount due</th>
            <td>{formatMoney(summary.netAmount)}</td>
          </tr>
          <tr>
            <th scope="row">Verified cash receipts</th>
            <td>{formatMoney(summary.verifiedTotal)}</td>
          </tr>
          <tr>
            <th scope="row">Remaining amount due</th>
            <td>
              {formatMoney(summary.remainingBalance)}{' '}
              <StatusChip
                tone={summary.fullyPaid ? 'success' : 'warning'}
                label={summary.fullyPaid ? 'Settled' : 'Outstanding'}
              />
            </td>
          </tr>
        </tbody>
      </table>
      <p>
        Verified receipts are cash only. Points are never recorded as a payment.
      </p>
    </>
  );
}

/**
 * Purchase and claim history, for investigation only.
 *
 * Deliberately read-only. A staff member needs to answer "what happened to this
 * claim and this purchase" - did it expire, was it claimed, was it reversed, what
 * did it cost - and must have no way to change the answer. There is no edit
 * control here and no verb behind one; corrections go through an audited manual
 * adjustment, which is a separate, attributed act.
 */
function PointsHistory({
  purchases,
  claims,
}: {
  purchases: PurchaseRow[];
  claims: ClaimRow[];
}) {
  return (
    <>
      <section aria-label="Purchases">
        <h3>Purchases</h3>
        {purchases.length === 0 && <p className={styles.hint}>No purchases recorded yet.</p>}
        {purchases.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Purchase</th>
                <th scope="col">Status</th>
                <th scope="col">Gross</th>
                <th scope="col">Discount</th>
                <th scope="col">Net</th>
                <th scope="col">Completed</th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((row) => (
                <tr key={row.id}>
                  <td>{row.purchaseNumber}</td>
                  <td>
                    <StatusChip
                      tone={
                        row.status === 'completed'
                          ? 'success'
                          : row.status === 'reversed'
                            ? 'danger'
                            : 'neutral'
                      }
                      label={row.status}
                    />
                  </td>
                  <td>{formatMoney(row.grossAmount)}</td>
                  <td>{formatMoney(row.pointsDiscountAmount)}</td>
                  <td>{formatMoney(row.netAmount)}</td>
                  <td>{row.completedAt ? new Date(row.completedAt).toLocaleDateString('en-PH') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section aria-label="Claims">
        <h3>Claims</h3>
        {claims.length === 0 && <p className={styles.hint}>No claims issued yet.</p>}
        {claims.length > 0 && (
          <table>
            <thead>
              <tr>
                <th scope="col">Claim</th>
                <th scope="col">Status</th>
                <th scope="col">Reserved</th>
                <th scope="col">Awarded</th>
                <th scope="col">Capped</th>
                <th scope="col">Expires</th>
              </tr>
            </thead>
            <tbody>
              {claims.map((row) => (
                <tr key={row.id}>
                  <td>{row.claimNumber}</td>
                  <td>
                    <StatusChip
                      tone={
                        row.status === 'claimed'
                          ? 'success'
                          : row.status === 'reversed'
                            ? 'danger'
                            : row.status === 'expired'
                              ? 'warning'
                              : 'neutral'
                      }
                      label={row.status}
                    />
                  </td>
                  <td>{row.pointsReserved.toLocaleString('en-PH')}</td>
                  <td>{row.pointsAwarded.toLocaleString('en-PH')}</td>
                  {/* The capped figure is SHOWN, never hidden: it is the part of an
                      award the annual limit refused, and a member is entitled to
                      know it exists. */}
                  <td>{row.pointsCapped.toLocaleString('en-PH')}</td>
                  <td>{row.expiresAt ? new Date(row.expiresAt).toLocaleString('en-PH') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

/** One readable line for a failure. The server message is already member-safe. */
function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message
    ? cause.message
    : 'Something went wrong. Please try again.';
}