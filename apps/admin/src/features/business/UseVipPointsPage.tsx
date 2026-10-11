/** Staff prepare a quote; only the customer portal can authorize points. */
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';

import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
} from '@afhomes/ui';
import { formatMoney } from './format';
import styles from './points.module.css';

import {
  getPurchaseSummary,
  listOwnPurchases,
  quotePointDiscount,
} from './points-services';
import type { PurchaseRow, PurchaseSummaryRow } from './points-services';

export function UseVipPointsPage() {
  const purchases = useQuery({ queryKey: ['earning', 'pos', 'purchases'], queryFn: listOwnPurchases,refetchInterval:15_000 });

  // Only DRAFT purchases can take a discount; a settled one has already been
  // verified against its net, so changing net now would invalidate that decision.
  const drafts = (purchases.data ?? []).filter((row) => row.status === 'draft');

  return (
    <>
      <PageHeader
        title="Use VIP Points"
        description="Spend a member's accumulated points against an unsettled purchase. Staycation and hotel purchases are eligible by default; every other service needs an active promotion."
      />

      {purchases.isLoading && (
        <div role="status" aria-label="Loading purchases" aria-busy="true">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {purchases.isError && (
        <ErrorState
          title="Purchases unavailable"
          message="The purchase list could not be loaded, so a discount cannot be applied."
          onRetry={purchases.refetch}
        />
      )}
      {purchases.data && drafts.length === 0 && (
        <EmptyState
          title="Nothing to discount"
          description="A discount can only be applied to a purchase that has not been settled yet."
        />
      )}

      {drafts.length > 0 && (
        <div role="region" aria-label="Scrollable draft purchases" tabIndex={0} className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Purchase</th>
                <th scope="col">Customer</th>
                <th scope="col">Gross</th>
                <th scope="col">VIP tier discount</th>
                <th scope="col">Net due</th>
                <th scope="col">Status</th>
                <th scope="col">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {drafts.map((row) => (
                <tr key={row.id}>
                  <td>{row.purchaseNumber}</td>
                  <td>{row.customerName ?? row.customerId}</td>
                  <td>{formatMoney(row.grossAmount)}</td>
                  <td>{formatMoney(row.tierDiscountAmount ?? '0.00')}</td>
                  <td>{formatMoney(row.netAmount)}</td>
                  <td>
                    <StatusChip tone="neutral" label={row.status} />
                  </td>
                  <td>
                    <DiscountButton purchase={row} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/**
 * One purchase's discount. Everything happens in a dialog so the purchase list
 * behind it stays usable - a single slow action must never block the page.
 */
function DiscountButton({ purchase }: { purchase: PurchaseRow }) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState('');
  const [quote, setQuote] = useState<{
    quoteId: string;
    pesoValue: string;
    pointsRequested: number;
  } | null>(null);

  const summary = useQuery({
    queryKey: ['earning', 'purchase', purchase.id, 'summary'],
    queryFn: () => getPurchaseSummary(purchase.id),
    enabled: open,
  });

  const ask = useMutation({
    mutationFn: () => quotePointDiscount(purchase.id, Number(points)),
    // The typed amount is PRESERVED on failure, so a member who was interrupted
    // does not have to retype it.
    onSuccess: (result) =>
      setQuote({
        quoteId: result.quoteId,
        pesoValue: result.pesoValue,
        pointsRequested: result.pointsRequested,
      }),
  });

  const busy = ask.isPending;

  return (
    <>
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        Use points
      </Button>
      {open && (
        <Dialog
          open
          onClose={() => {
            if (!busy) setOpen(false);
          }}
          title={`Use points on ${purchase.purchaseNumber}`}
          footer={
            <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
              Close
            </Button>
          }
        >
          {/* Only this dialog is busy. The list behind it stays interactive. */}
          <div aria-busy={busy}>
            <PurchaseFigures summary={summary.data} loading={summary.isLoading} />

            <label htmlFor={`discount-points-${purchase.id}`}>Points to spend</label>
            <input
              id={`discount-points-${purchase.id}`}
              type="number"
              min={1}
              value={points}
              onChange={(event) => {
                setPoints(event.target.value);
                setQuote(null);
              }}
              disabled={busy}
            />

            {!quote && (
              <Button
                onClick={() => ask.mutate()}
                loading={ask.isPending}
                loadingLabel="Pricing…"
                disabled={busy || !points || Number(points) <= 0}
              >
                See what this is worth
              </Button>
            )}

            {ask.isError && (
              <ErrorState title="Cannot use points here" message={messageOf(ask.error)} />
            )}

            {quote && (
              <>
                <p role="status">
                  {quote.pointsRequested.toLocaleString('en-PH')} points are worth{' '}
                  <strong>{formatMoney(quote.pesoValue)}</strong> off this purchase.
                </p>
                <p role="status">Customer portal approval required. The customer must review this quote in their signed-in account. Approval reserves the points; deduction happens only after verified settlement and purchase completion.</p>
              </>
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
 * Gross, tier discount, points discount, net due and verified receipts are five
 * DIFFERENT numbers and are shown as five. Either discount column matters most:
 * each is what stops a member believing their points were treated as cash or
 * merged into the tier rate.
 */
function PurchaseFigures({
  summary,
  loading,
}: {
  summary: PurchaseSummaryRow | undefined;
  loading: boolean;
}) {
  if (loading)
    return (
      <div role="status" aria-label="Loading purchase figures" aria-busy="true">
        <Skeleton />
      </div>
    );
  if (!summary) {
    return <p className={styles.hint}>The figures for this purchase are unavailable.</p>;
  }
  return (
    <dl className={styles.figures}>
      <div>
        <dt>Gross service value</dt>
        <dd>{formatMoney(summary.grossAmount)}</dd>
      </div>
      <div>
        <dt>VIP tier discount</dt>
        <dd>{formatMoney(summary.tierDiscountAmount ?? '0.00')}</dd>
      </div>
      <div>
        <dt>Points discount so far</dt>
        <dd>{formatMoney(summary.pointsDiscountAmount)}</dd>
      </div>
      <div>
        <dt>Amount due</dt>
        <dd>{formatMoney(summary.netAmount)}</dd>
      </div>
      <div>
        <dt>Verified receipts</dt>
        <dd>{formatMoney(summary.verifiedTotal)}</dd>
      </div>
    </dl>
  );
}

/** One readable line for any failure, without leaking a driver message. */
function messageOf(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text || 'Something went wrong. Please try again.';
}
