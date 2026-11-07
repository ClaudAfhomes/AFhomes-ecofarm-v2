/** Staff prepare a quote; only the customer portal can authorize points. */
import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';

import {
  Alert,
  Button,
  QrCode,
  Dialog,
  DateField,
  EmptyState,
  ErrorState,
  FilterBar,
  OverflowMenu,
  PageHeader,
  Pagination,
  SearchField,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import { webBase } from '../../lib/portal';
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import styles from './points.module.css';
import { TierBadge } from './TierBadge';

import { getPurchaseSummary, listOwnPurchases, quotePointDiscount } from './points-services';
import type { PurchaseRow, PurchaseSummaryRow } from './points-services';
import { earningKeys } from './queryKeys';

const PAGE_SIZE = 10;

const capitalize = (value: string) =>
  value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);

export function UseVipPointsPage() {
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  void useDebouncedValue(search.trim(), 300, setApplied);
  const [page, setPage] = useState(0);
  const purchases = useQuery({
    queryKey: earningKeys.posPurchases,
    queryFn: listOwnPurchases,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  // Only DRAFT purchases can take a discount; a settled one has already been
  // verified against its net, so changing net now would invalidate that decision.
  const drafts = useMemo(
    () => (purchases.data ?? []).filter((row) => row.status === 'draft'),
    [purchases.data],
  );
  const term = applied.toLowerCase();
  const filtered = useMemo(
    () =>
      term.length === 0
        ? drafts
        : drafts.filter(
            (row) =>
              row.purchaseNumber.toLowerCase().includes(term) ||
              (row.customerName ?? '').toLowerCase().includes(term),
          ),
    [drafts, term],
  );
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = filtered.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const [detail, setDetail] = useState<PurchaseRow | null>(null);

  if (purchases.isPending)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading purchases"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 280 }} />
            <Skeleton style={{ height: 16, maxWidth: 460 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading purchases</span>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Use VIP Points"
        description="Spend a member's accumulated points against an unsettled purchase. Staycation and hotel purchases are eligible by default; every other service needs an active promotion."
      />

      <Alert variant="info" title="Customer approval required">
        Staff prepare the quote here. The customer approves it in their own signed-in portal.
        Scanning or quoting alone never spends points.
      </Alert>

      <ul className={styles.badges} aria-label="Discount queue summary">
        <li>
          <StatusChip
            label={`Draft purchases: ${formatCountOrDash(filtered.length)}`}
            tone="neutral"
            icon="file-text"
          />
        </li>
        <li>
          <StatusChip
            label={`Awaiting quote: ${formatCountOrDash(visible.length)}`}
            tone="warning"
            icon="clock"
          />
        </li>
      </ul>

      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search draft purchases"
            placeholder="Purchase number or customer"
            value={search}
            onChange={(value) => {
              setSearch(value);
              setPage(0);
            }}
            busy={purchases.isFetching}
          />
        }
      />

      {purchases.isError ? (
        <ErrorState error={purchases.error} onRetry={() => void purchases.refetch()} />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nothing to discount"
          description="A discount can only be applied to a purchase that has not been settled yet."
        />
      ) : (
        <div
          role="region"
          aria-label="Scrollable draft purchases"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <Table>
            <TableCaption>Draft purchases that can take a points discount.</TableCaption>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Purchase</TableHeaderCell>
                <TableHeaderCell>Customer</TableHeaderCell>
                <TableHeaderCell>Tier</TableHeaderCell>
                <TableHeaderCell align="right">Gross</TableHeaderCell>
                <TableHeaderCell align="right">VIP tier discount</TableHeaderCell>
                <TableHeaderCell align="right">Net due</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>
                  <span className="sr-only">Actions</span>
                </TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((row) => (
                <TableRow key={row.id}>
                  <TableCell label="Purchase">{row.purchaseNumber}</TableCell>
                  <TableCell label="Customer">{row.customerName ?? row.customerId}</TableCell>
                  <TableCell label="Tier">
                    <TierBadge tier={row.tierSnapshot ?? null} />
                  </TableCell>
                  <TableCell label="Gross" align="right">
                    {formatMoneyOrDash(row.grossAmount)}
                  </TableCell>
                  <TableCell label="VIP tier discount" align="right">
                    {formatMoneyOrDash(row.tierDiscountAmount ?? '0.00')}
                  </TableCell>
                  <TableCell label="Net due" align="right">
                    {formatMoneyOrDash(row.netAmount)}
                  </TableCell>
                  <TableCell label="Status">
                    <StatusChip label={capitalize(row.status)} />
                  </TableCell>
                  <TableCell label="Actions">
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                      <DiscountButton purchase={row} />
                      <OverflowMenu
                        label={`More actions for ${row.purchaseNumber}`}
                        items={[
                          {
                            label: 'View details',
                            icon: 'info',
                            onClick: () => setDetail(row),
                          },
                        ]}
                      />
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {total > 0 ? (
        <div className={styles.pagination}>
          <Pagination
            page={safePage + 1}
            pageCount={pageCount}
            onChange={(next) => setPage(next - 1)}
            label="Draft purchases pagination"
          />
        </div>
      ) : null}

      {detail ? (
        <Dialog
          open
          onClose={() => setDetail(null)}
          title={`Purchase ${detail.purchaseNumber}`}
          footer={
            <Button variant="ghost" onClick={() => setDetail(null)}>
              Close
            </Button>
          }
        >
          <dl className={styles.figures}>
            <div>
              <dt>Customer</dt>
              <dd>{detail.customerName ?? detail.customerId}</dd>
            </div>
            <div>
              <dt>Tier</dt>
              <dd>
                <TierBadge tier={detail.tierSnapshot ?? null} />
              </dd>
            </div>
            <div>
              <dt>Gross</dt>
              <dd>{formatMoneyOrDash(detail.grossAmount)}</dd>
            </div>
            <div>
              <dt>VIP tier discount</dt>
              <dd>{formatMoneyOrDash(detail.tierDiscountAmount ?? '0.00')}</dd>
            </div>
            <div>
              <dt>Net due</dt>
              <dd>{formatMoneyOrDash(detail.netAmount)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>
                <StatusChip label={capitalize(detail.status)} />
              </dd>
            </div>
          </dl>
          <p className={styles.hint}>
            This record is read-only here. To spend points, use the row action and let the customer
            approve it in their portal.
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}

/**
 * One purchase's discount. Everything happens in a dialog so the purchase list
 * behind it stays usable - a single slow action must never block the page.
 */
function DiscountButton({ purchase }: { purchase: PurchaseRow }) {
  const [open, setOpen] = useState(false);
  const [points, setPoints] = useState('');
  const [overnight, setOvernight] = useState(false);
  const [serviceDate, setServiceDate] = useState('');
  const [checkInDate, setCheckInDate] = useState('');
  const [checkOutDate, setCheckOutDate] = useState('');
  const [quote, setQuote] = useState<{
    quoteId: string;
    pesoValue: string;
    pointsRequested: number;
  } | null>(null);

  const summary = useQuery({
    queryKey: earningKeys.purchaseSummary(purchase.id),
    queryFn: () => getPurchaseSummary(purchase.id),
    enabled: open,
    placeholderData: keepPreviousData,
  });

  const ask = useBusinessMutation({
    mutationFn: () => quotePointDiscount(purchase.id, Number(points), overnight ? { checkInDate, checkOutDate } : { serviceDate }),
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
            <>
              {!quote && (
                <Button
                  onClick={() => ask.mutate()}
                  loading={ask.isPending}
                  loadingLabel="Pricing…"
                  disabled={busy || !points || Number(points) <= 0 || (overnight ? !checkInDate || checkOutDate <= checkInDate : !serviceDate)}
                >
                  Request customer approval
                </Button>
              )}

              <Button variant="secondary" disabled={busy} onClick={() => setOpen(false)}>
                Close
              </Button>
            </>
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

            {!quote && <fieldset disabled={busy}>
              <legend>Actual stay/service dates (Philippine time)</legend>
              <label><input type="checkbox" checked={overnight} onChange={event => setOvernight(event.target.checked)} />Overnight accommodation</label>
              {overnight ? <>
                <DateField id={`check-in-${purchase.id}`} name="checkInDate" label="Check-in date" value={checkInDate} onChange={setCheckInDate} />
                <DateField id={`check-out-${purchase.id}`} name="checkOutDate" label="Check-out date" value={checkOutDate} onChange={setCheckOutDate} />
              </> : <DateField id={`service-date-${purchase.id}`} name="serviceDate" label="Service date" value={serviceDate} onChange={setServiceDate} />}
              <p>Monday–Friday uses weekday points; Saturday–Sunday uses weekend points. Overnight points are divided across each night's date. Check-out is excluded.</p>
            </fieldset>}

            {ask.isError && (
              <ErrorState title="Cannot use points here" message={messageOf(ask.error)} />
            )}

            {quote && (
              <>
                <p role="status">
                  {quote.pointsRequested.toLocaleString('en-PH')} points are worth{' '}
                  <strong>{formatMoneyOrDash(quote.pesoValue)}</strong> off this purchase.
                </p>
                <QrCode
                  value={webBase().replace(/\/$/, '') + '/customer/points'}
                  alt="Customer points approval portal QR"
                  size={180}
                />
                <a
                  href={webBase().replace(/\/$/, '') + '/customer/points'}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open customer approval portal
                </a>
                <p>
                  Ask the customer to scan this QR on their own device, sign in, and approve
                  purchase {purchase.purchaseNumber}. Scanning alone does not spend points.
                </p>
                <p role="status">
                  Customer portal approval required. The customer must review this quote in their
                  signed-in account. Approval reserves the points; deduction happens only after
                  verified settlement and purchase completion.
                </p>
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
        <dd>{formatMoneyOrDash(summary.grossAmount)}</dd>
      </div>
      <div>
        <dt>VIP tier discount</dt>
        <dd>{formatMoneyOrDash(summary.tierDiscountAmount ?? '0.00')}</dd>
      </div>
      <div>
        <dt>Points discount so far</dt>
        <dd>{formatMoneyOrDash(summary.pointsDiscountAmount)}</dd>
      </div>
      <div>
        <dt>Amount due</dt>
        <dd>{formatMoneyOrDash(summary.netAmount)}</dd>
      </div>
      <div>
        <dt>Verified receipts</dt>
        <dd>{formatMoneyOrDash(summary.verifiedTotal)}</dd>
      </div>
    </dl>
  );
}

/** One readable line for any failure, without leaking a driver message. */
function messageOf(cause: unknown): string {
  const text = cause instanceof Error ? cause.message : String(cause);
  return text || 'Something went wrong. Please try again.';
}
