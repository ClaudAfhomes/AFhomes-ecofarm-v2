import styles from './BusinessFinanceQueuePage.module.css';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useMemo, useState, type KeyboardEvent } from 'react';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { useSession } from '../../lib/session';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { paymentSchemeLabel, recordPaymentSchema } from '@afhomes/contracts';
import {
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeaderCell,
  TableCell,
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  Icon,
  MetricCard,
  OverflowMenu,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  TextField,
  notifyConfirm,
  notifyError,
  notifySuccess,
} from '@afhomes/ui';
import type { OverflowMenuItem } from '@afhomes/ui';
import type {
  FinanceCollectionQueueItem,
  FinanceQueueItem,
  PaymentType,
  PurchaseDocumentKind,
  ReservationFinanceSummary,
} from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { downloadFile } from '../../lib/download';
import {
  SPOT_CASH_LABEL,
  SALE_STATUS_LABEL,
  SALE_STATUS_TONE,
  formatMoney,
  formatPoints,
  humanizeCode,
} from './format';
import { TierBadge } from './TierBadge';
import {
  exportPurchaseDocument,
  finalizeReservationPurchase,
  getFinanceQueue,
  FINANCE_QUEUE_LIMIT,
  getReservationPayments,
  getReservationFinance,
  recordReservationPayment,
  verifyReservationPayment,
  getSalePayments,
  getSaleSummary,
  recordPayment,
  verifyPayment,
} from './services';

/**
 * Finance payment queue.
 *
 * Finance records a payment and then verifies or rejects it. Only VERIFIED
 * money counts toward the price, and every total on this screen comes from
 * `sale_financial_summary`, so nobody can type a paid total or a balance.
 */

/**
 * Bar width for the payment-progress paint, from exact-decimal figures.
 *
 * `Number` is used ONLY to derive this CSS geometry — it never produces,
 * stores or compares a monetary figure. Every displayed amount still comes
 * from the exact-decimal string via `formatMoney`.
 */
function progressPercent(verified: string, total: string): number {
  const done = Number(verified);
  const full = Number(total);
  if (!Number.isFinite(done) || !Number.isFinite(full) || full <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / full) * 100)));
}

/** Client-side status filter over the loaded queue rows (no API change). */
const STATUS_OPTIONS = [
  { value: 'all', label: 'All statuses' },
  { value: 'awaiting', label: 'Awaiting payment' },
  { value: 'paid', label: 'Fully paid' },
] as const;

type StatusFilter = (typeof STATUS_OPTIONS)[number]['value'];

/**
 * Badge vocabulary for a queue status code: a capitalized human label plus
 * the settlement tone. Unknown codes fall back to a humanized Capitalized
 * label on neutral — a new server status never renders as snake_case.
 */
function statusBadgeProps(status: string): {
  label: string;
  tone: 'success' | 'warning' | 'danger' | 'neutral';
} {
  return {
    label: SALE_STATUS_LABEL[status] ?? humanizeCode(status),
    tone: SALE_STATUS_TONE[status] ?? 'neutral',
  };
}

/**
 * Tier from a card plan name, using the same uppercase-substring rule the
 * dashboard uses to read tiers off published names. Unrecognized plans pass
 * through to TierBadge's neutral treatment with the name intact.
 */
function tierFromProductName(productName: string): string {
  const upper = productName.toUpperCase();
  if (upper.includes('GOLD')) return 'GOLD';
  if (upper.includes('SILVER')) return 'SILVER';
  if (upper.includes('BRONZE')) return 'BRONZE';
  return productName;
}
/**
 * Loading placeholder: hero chips, summary cards and table rows shaped like
 * the loaded queue, so nothing pops in and reflows once the data lands. The
 * search stays mounted and usable while loading (it is a control, not data).
 */
function QueueSkeleton() {
  return (
    <div role="status" aria-label="Loading payment queue" className={styles.skeletonShell}>
      <ul className={styles.skeletonSummary} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <li key={index} className={styles.skMetric}>
            <Skeleton className={styles.skTile} />
            <Skeleton style={{ height: 28, width: '55%' }} />
            <Skeleton style={{ height: 14, width: '75%' }} />
            <Skeleton style={{ height: 12, width: '90%' }} />
          </li>
        ))}
      </ul>
      <div className={styles.skeletonTable} aria-hidden="true">
        {[0, 1, 2, 3].map((index) => (
          <div className={styles.skeletonRow} key={index}>
            <Skeleton className={styles.skPill} style={{ width: '85%' }} />
            <Skeleton style={{ height: 18 }} />
            <Skeleton className={styles.skPill} style={{ width: '70%' }} />
            <div>
              <Skeleton style={{ height: 18, width: '60%', marginLeft: 'auto' }} />
              <Skeleton className={styles.skTrack} />
            </div>
            <Skeleton className={styles.skPill} style={{ width: '80%' }} />
            <Skeleton className={styles.skDot} />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Loading placeholder for a payment ledger/timeline: ledger cards shaped
 * like the loaded rows (amount + badge over the meta line). Shared by both
 * detail dialogs.
 */
function TimelineSkeleton() {
  return (
    <div role="status" aria-label="Loading payments">
      <ol className={styles.timeline} aria-hidden="true">
        {[0, 1].map((index) => (
          <li key={index} className={styles.timelineItem} aria-hidden="true">
            <div className={styles.timelineTop}>
              <Skeleton style={{ height: 20, width: '7rem' }} />
              <Skeleton className={styles.skPill} style={{ width: '5.5rem' }} />
            </div>
            <Skeleton style={{ height: 14, width: '80%' }} />
          </li>
        ))}
      </ol>
    </div>
  );
}
/**
 * Actions for an EXECUTED application-origin reservation.
 *
 * Four actions, and one rule: eligibility is whatever the SERVER last said.
 * The button is enabled from the queue's own figures and the call is still
 * refused server-side if the money changed in between — a stale "fully paid" in
 * a browser must never produce a sale.
 */
function ReservationActions({
  item,
  canHandlePayments,
  onViewDetails,
  onRecord,
  onVerify,
  onDone,
}: {
  item: Extract<FinanceCollectionQueueItem, { origin: 'reservation' }>;
  canHandlePayments: boolean;
  /** Opens the read-only reservation details in the parent. */
  onViewDetails: () => void;
  /** Opens the record-payment dialog in the parent. */
  onRecord: () => void;
  /** Opens the payment ledger (Verify) in the parent. */
  onVerify: () => void;
  onDone: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const print = async (kind: PurchaseDocumentKind) => {
    setBusy(true);
    setError(null);
    try {
      const file = await exportPurchaseDocument(item.reservationId, kind);
      downloadFile(file);
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Print failed');
    } finally {
      setBusy(false);
    }
  };
  const finalize = async () => {
    setBusy(true);
    setError(null);
    try {
      await finalizeReservationPurchase(item.reservationId, crypto.randomUUID());
      await onDone();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Finalization failed');
    } finally {
      setBusy(false);
    }
  };
  const menuItems: OverflowMenuItem[] = [
    {
      label: 'View details',
      icon: 'file-text',
      onClick: onViewDetails,
    },
    {
      label: 'Print reservation',
      icon: 'download',
      disabled: !canHandlePayments || busy,
      onClick: () => void print('reservation'),
    },
    {
      label: 'Record payment',
      icon: 'dollar-sign',
      disabled: !canHandlePayments || busy,
      onClick: onRecord,
    },
    {
      label: 'Verify',
      icon: 'check',
      disabled: !canHandlePayments || busy,
      onClick: onVerify,
    },
  ];
  if (item.fullyPaid) {
    menuItems.push({
      label: 'Finalize purchase',
      icon: 'chevron-right',
      disabled: !canHandlePayments || busy,
      onClick: () => void finalize(),
    });
  }
  return (
    <>
      <span data-row-menu onClick={(event) => event.stopPropagation()}>
        <OverflowMenu label={`Actions for ${item.reservationNumber}`} items={menuItems} />
      </span>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

export function BusinessFinanceQueuePage() {
  const { user } = useSession();
  const canHandlePayments =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
    ) ?? false;
  const client = useQueryClient();
  const [search, setSearch] = useState('');
  const settled = useDebouncedValue(search.trim());
  const query = useQuery({
    queryKey: ['business', 'queue', 'finance', settled, FINANCE_QUEUE_LIMIT],
    queryFn: () => getFinanceQueue(settled),
    // Keep the previous page on screen while the next search (or poll) lands:
    // refetches then feel instant and the skeleton only ever appears on the
    // very first load. `isPending` stays true only until the first page.
    placeholderData: keepPreviousData,
    // Money moves from other sessions too: poll the queue (same-session
    // writes invalidate instantly).
    refetchInterval: 15_000,
  });
  const rows = query.data?.items ?? [];
  const [detail, setDetail] = useState<FinanceCollectionQueueItem | null>(null);
  const [recording, setRecording] = useState<{
    id: string;
    origin: 'sale' | 'reservation';
    customerName?: string;
    recordLabel?: string;
  } | null>(null);
  const [reviewing, setReviewing] = useState<{ id: string; origin: 'sale' | 'reservation' } | null>(
    null,
  );
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const currentDetail = detail
    ? ((rows.find((item) =>
        detail.origin === 'sale'
          ? item.origin === 'sale' && item.saleId === detail.saleId
          : item.origin === 'reservation' && item.reservationId === detail.reservationId,
      ) ?? detail) as FinanceCollectionQueueItem)
    : null;

  // Row activation opens the record-payment dialog straight away: this is
  // the finance operator's primary action on the queue. Full details stay
  // one step away behind the row menu's View details. Menu interactions
  // never reach here — the menu wrapper stops propagation.
  const selectItem = (item: FinanceCollectionQueueItem) => {
    if (item.origin === 'sale') {
      setRecording({
        id: item.saleId,
        origin: 'sale',
        customerName: item.customerName,
        recordLabel: item.saleNumber,
      });
    } else {
      setRecording({
        id: item.reservationId,
        origin: 'reservation',
        customerName: item.customerName,
        recordLabel: item.reservationNumber,
      });
    }
  };
  const onRowKeyDown = (event: KeyboardEvent, item: FinanceCollectionQueueItem) => {
    if ((event.target as HTMLElement).closest('[data-row-menu]')) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      selectItem(item);
    }
  };

  // Headline counts from the loaded rows (counts only, so no money figure is
  // ever printed twice on this screen). `total` is the server's full count,
  // which can exceed the capped page — the toolbar says so when it does.
  const summary = useMemo(() => {
    const paid = rows.filter((item) => item.fullyPaid).length;
    const total = query.data?.total ?? rows.length;
    return { total, loaded: rows.length, paid, awaiting: rows.length - paid };
  }, [rows, query.data?.total]);
  // Client-side status filter over the loaded rows; the search itself stays
  // server-side via the debounced term.
  const visible = useMemo(
    () =>
      rows.filter((item) => {
        if (statusFilter === 'awaiting') return !item.fullyPaid;
        if (statusFilter === 'paid') return item.fullyPaid;
        return true;
      }),
    [rows, statusFilter],
  );
  const truncated = summary.total > summary.loaded;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['business', 'queue'] });
    // Payment reports (verified/pending/rejected totals) stay fresh too.
    await client.invalidateQueries({ queryKey: ['reports'] });
    await client.invalidateQueries({ queryKey: ['business', 'sale-summary'] });
    await client.invalidateQueries({ queryKey: ['business', 'sale-payments'] });
    await client.invalidateQueries({ queryKey: ['business', 'sales'] });
  };

  return (
    <section className={styles.pageShell}>
      <div className={styles.hero}>
        <div className={styles.heroText}>
          <p className={styles.eyebrow}>Finance · Payment verification</p>
          <PageHeader
            title="Finance Queue"
            description="Only verified payments move sales forward."
          />
        </div>
        <div className={styles.heroMeta}>
          {query.isPending ? (
            <>
              <Skeleton style={{ height: 30, width: 120, borderRadius: 999 }} />
              <Skeleton style={{ height: 30, width: 110, borderRadius: 999 }} />
            </>
          ) : (
            <>
              <span className={styles.heroChip}>
                <Icon name="clock" size={14} aria-hidden="true" />
                {formatPoints(summary.awaiting)} awaiting
              </span>
              <span className={styles.heroChip}>
                <Icon name="check" size={14} aria-hidden="true" />
                {formatPoints(summary.paid)} fully paid
              </span>
            </>
          )}
        </div>
      </div>

      {query.isPending ? (
        <QueueSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
          <ul className={styles.summary} aria-label="Queue summary">
            <li>
              <MetricCard
                label="Awaiting payment"
                value={formatPoints(summary.awaiting)}
                icon="clock"
                description="Records with a remaining balance"
              />
            </li>
            <li>
              <MetricCard
                label="Fully paid"
                value={formatPoints(summary.paid)}
                icon="check"
                description="Ready for activation review"
              />
            </li>
            <li>
              <MetricCard
                label="Queue records"
                value={formatPoints(summary.total)}
                icon="file-text"
                description="Sales and reservations in scope"
              />
            </li>
          </ul>

          <FilterBar
            search={
              <SearchField
                label="Search payments"
                placeholder="Sale or reservation number, customer, card, or status"
                value={search}
                onChange={setSearch}
              />
            }
            filters={
              <label className={styles.filterLabel}>
                Status
                <Select
                  aria-label="Filter by status"
                  value={statusFilter}
                  onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
                  options={[...STATUS_OPTIONS]}
                />
              </label>
            }
            actions={
              <p className={styles.resultCount}>
                {statusFilter === 'all' && !settled && !truncated
                  ? `${formatPoints(visible.length)} records`
                  : `${formatPoints(visible.length)} of ${formatPoints(summary.total)} records`}
              </p>
            }
          />

          {truncated ? (
            <Alert variant="warning" title="Queue capped">
              Showing the first {formatPoints(summary.loaded)} of {formatPoints(summary.total)}{' '}
              records. Narrow the search to reach the rest.
            </Alert>
          ) : null}

          {visible.length === 0 ? (
            <EmptyState
              title={
                settled || statusFilter !== 'all' ? 'No matching records.' : 'Nothing to handle'
              }
              description="No sale is awaiting payment."
            />
          ) : (
            <div
              role="region"
              aria-label="Scrollable records"
              tabIndex={0}
              className={`table-scroll ${styles.tableWrap} ${styles.queueCard}`}
            >
              <Table className={styles.queueTable}>
                <TableHead>
                  <TableRow>
                    <TableHeaderCell>Record</TableHeaderCell>
                    <TableHeaderCell>Name</TableHeaderCell>
                    <TableHeaderCell>Plan</TableHeaderCell>
                    <TableHeaderCell align="right">Balance</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((item) => {
                    const recordNumber =
                      item.origin === 'sale' ? item.saleNumber : item.reservationNumber;
                    const status = statusBadgeProps(item.status);
                    return (
                      <TableRow
                        key={item.origin === 'sale' ? item.saleId : item.reservationId}
                        role="link"
                        tabIndex={0}
                        aria-label={
                          item.origin === 'sale'
                            ? `Record a payment for ${recordNumber}`
                            : `Record a reservation payment for ${recordNumber}`
                        }
                        onClick={() => selectItem(item)}
                        onKeyDown={(event) => onRowKeyDown(event, item)}
                        className={styles.clickableRow}
                      >
                        <TableCell label="Record">
                          <span className={styles.recordRef}>
                            <span className={styles.recordRefDot} aria-hidden="true" />
                            {recordNumber}
                          </span>
                        </TableCell>
                        <TableCell label="Name">
                          <span className={styles.cellTitle}>{item.customerName}</span>
                        </TableCell>
                        <TableCell label="Plan">
                          <TierBadge tier={tierFromProductName(item.productName)} />
                        </TableCell>
                        <TableCell label="Balance" className={styles.numeric}>
                          <span className={styles.balanceFigure}>
                            {formatMoney(item.remainingBalance)}
                          </span>
                          <span className={styles.progress} aria-hidden="true">
                            <span
                              className={styles.progressBar}
                              style={{
                                width: `${progressPercent(
                                  item.verifiedTotal,
                                  item.origin === 'sale' ? item.cashPrice : item.totalPrice,
                                )}%`,
                              }}
                            />
                          </span>
                        </TableCell>
                        <TableCell label="Status">
                          <StatusChip label={status.label} tone={status.tone} />
                        </TableCell>
                        <TableCell label="Actions">
                          {item.origin === 'reservation' ? (
                            <ReservationActions
                              item={item}
                              canHandlePayments={canHandlePayments}
                              onViewDetails={() => setDetail(item)}
                              onRecord={() =>
                                setRecording({
                                  id: item.reservationId,
                                  origin: 'reservation',
                                  customerName: item.customerName,
                                  recordLabel: item.reservationNumber,
                                })
                              }
                              onVerify={() =>
                                setReviewing({ id: item.reservationId, origin: 'reservation' })
                              }
                              onDone={refresh}
                            />
                          ) : (
                            <span data-row-menu onClick={(event) => event.stopPropagation()}>
                              <OverflowMenu
                                label={`Actions for ${recordNumber}`}
                                items={[
                                  {
                                    label: 'View details',
                                    icon: 'file-text',
                                    onClick: () => setDetail(item),
                                  },
                                  {
                                    label: 'Record payment',
                                    icon: 'dollar-sign',
                                    disabled: !canHandlePayments,
                                    onClick: () =>
                                      setRecording({
                                        id: item.saleId,
                                        origin: 'sale',
                                        customerName: item.customerName,
                                        recordLabel: item.saleNumber,
                                      }),
                                  },
                                  {
                                    label: 'Verify',
                                    icon: 'check',
                                    disabled: !canHandlePayments,
                                    onClick: () =>
                                      setReviewing({ id: item.saleId, origin: 'sale' }),
                                  },
                                ]}
                              />
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {currentDetail && currentDetail.origin === 'sale' ? (
        <PaymentDetails
          canHandlePayments={canHandlePayments}
          item={currentDetail}
          onClose={() => setDetail(null)}
          onRecord={(item) => {
            setRecording({
              id: item.saleId,
              origin: 'sale',
              customerName: item.customerName,
              recordLabel: item.saleNumber,
            });
            setDetail(null);
          }}
          onVerify={() => {
            setReviewing({ id: currentDetail.saleId, origin: 'sale' });
            setDetail(null);
          }}
        />
      ) : null}
      {currentDetail && currentDetail.origin === 'reservation' ? (
        <ReservationDetails item={currentDetail} onClose={() => setDetail(null)} />
      ) : null}
      {recording ? (
        <RecordPaymentDialog
          saleId={recording.id}
          origin={recording.origin}
          customerName={recording.customerName}
          recordLabel={recording.recordLabel}
          onDone={async () => {
            if (recording.origin === 'reservation') {
              await client.invalidateQueries({
                queryKey: ['business', 'reservation-payments', recording.id],
              });
            }
            await refresh();
          }}
          onClose={() => setRecording(null)}
        />
      ) : null}
      {reviewing ? (
        <VerifyDialog
          saleId={reviewing.id}
          origin={reviewing.origin}
          onDone={refresh}
          onClose={() => setReviewing(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * The two record-payment endpoints answer with different shapes: the reservation
 * one returns the recomputed finance summary (which carries the payment rows),
 * the sale one returns only the new id. This guard tells them apart by shape, so
 * the success alert can read the SERVER's stored row in both cases.
 */
function isReservationFinanceSummary(
  value: ReservationFinanceSummary | { id: string },
): value is ReservationFinanceSummary {
  return 'payments' in value;
}

/**
 * Loading placeholder for the record-payment dialog: hero, note, figures and
 * fields shaped like the loaded form, so nothing pops in and reflows once
 * the sale figures land. The footer stays live so Cancel always dismisses.
 */
function RecordDialogSkeleton() {
  return (
    <div role="status" aria-label="Loading payment form">
      <div className={styles.dialogHero} aria-hidden="true">
        <span className={styles.dialogHeroIcon} aria-hidden="true">
          <Icon name="dollar-sign" size={22} />
        </span>
        <div className={styles.dialogHeroBody}>
          <Skeleton style={{ height: 24, width: '12rem' }} />
          <Skeleton style={{ height: 14, width: '9rem' }} />
        </div>
      </div>
      <div className={styles.formGrid} aria-hidden="true">
        <Skeleton style={{ height: 56 }} />
        <section className={styles.detailSection} aria-hidden="true">
          <Skeleton style={{ height: 20, width: '8rem' }} />
          <div className={styles.facts}>
            {[0, 1, 2, 3, 4, 5, 6].map((index) => (
              <div key={index}>
                <Skeleton style={{ height: 12, width: '55%' }} />
                <Skeleton style={{ height: 16, width: '85%' }} />
              </div>
            ))}
          </div>
        </section>
        <section className={styles.detailSection} aria-hidden="true">
          <Skeleton style={{ height: 20, width: '10rem' }} />
          <div className={styles.formGrid} aria-hidden="true">
            {[0, 1, 2, 3].map((index) => (
              <div key={index} style={{ display: 'grid', gap: 8 }}>
                <Skeleton style={{ height: 12, width: '6rem' }} />
                <Skeleton style={{ height: 40 }} />
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function RecordPaymentDialog({
  saleId,
  origin = 'sale',
  customerName,
  recordLabel,
  onDone,
  onClose,
}: {
  saleId: string;
  origin?: 'sale' | 'reservation';
  /** Shown in the confirmation so staff confirm the right customer. */
  customerName?: string;
  /** The sale or reservation number this payment belongs to. */
  recordLabel?: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [amountDirty, setAmountDirty] = useState(false);
  const [type, setType] = useState<PaymentType>('installment');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const [confirming, setConfirming] = useState(false);
  const runPayment = useSingleFlight<
    Awaited<ReturnType<typeof recordPayment>> | Awaited<ReturnType<typeof recordReservationPayment>>
  >();
  const paymentRequest = useMutationRequest();
  const paymentInput = { amount, paymentType: type, method, ...(reference ? { reference } : {}) };
  const amountValid = recordPaymentSchema.shape.amount.safeParse(amount).success;
  const paymentValid = recordPaymentSchema.safeParse(paymentInput).success;

  const summary = useQuery({
    queryKey: [
      'business',
      origin === 'reservation' ? 'reservation-finance' : 'sale-summary',
      saleId,
    ],
    queryFn: async () => {
      if (origin === 'sale') return getSaleSummary(saleId);
      const finance = await getReservationFinance(saleId);
      return { ...finance, cashPrice: finance.totalPrice };
    },
  });

  const save = useMutation({
    mutationFn: async (input: typeof paymentInput) => {
      const confirmed = await notifyConfirm({
        title: 'Record this payment?',
        message:
          'The payment is saved as recorded and does not count toward the price until it is verified.',
        detail: [
          customerName ? `Customer: ${customerName}` : null,
          recordLabel
            ? `${origin === 'reservation' ? 'Reservation' : 'Sale'}: ${recordLabel}`
            : null,
          `Amount: ₱${input.amount}`,
          `Type: ${input.paymentType.replace(/_/g, ' ')}`,
          `Method: ${input.method}`,
          `Reference: ${input.reference ?? '—'}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
        confirmButtonText: 'Record Payment',
      });
      if (!confirmed) return null;
      setConfirming(true);
      const result = await runPayment(() => {
        const parsed = recordPaymentSchema.parse(input);
        const body = {
          ...parsed,
          requestId: paymentRequest.forPayload({ origin, saleId, ...parsed }),
        };
        return origin === 'reservation'
          ? recordReservationPayment(saleId, body)
          : recordPayment(saleId, body);
      });
      return { input, result };
    },
    // The alert reports the SERVER's stored row, never the browser's optimism.
    // An HTTP 201 alone proves nothing: the sale endpoint returns only the new
    // id, and the reservation endpoint returns the recomputed summary.
    onSuccess: async (recorded) => {
      if (!recorded) return;
      setConfirming(false);
      await onDone();
      paymentRequest.complete();
      // Captured in a const so the narrowing survives into the filter callback.
      const outcome = recorded.result;
      // The re-read reports the SERVER's row. If it fails the payment is still
      // recorded, so the confirmation must never be swallowed by it: the alert
      // falls back to the submitted figures and says the status is unconfirmed.
      let stored:
        | {
            amount: string;
            reference: string | null;
            // `paymentNumber` is nullish on the payment contract.
            paymentNumber?: string | null;
            id: string;
            status: string;
          }
        | undefined;
      try {
        const rows = isReservationFinanceSummary(outcome)
          ? outcome.payments
          : (await getSalePayments(saleId)).filter((row) => row.id === outcome.id);
        stored = [...rows].sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0];
      } catch {
        // Left undefined on purpose: the payment IS recorded, so the alert falls
        // back to the submitted figures rather than being swallowed.
      }
      notifySuccess({
        title: 'Payment Recorded Successfully',
        message: 'The payment has been recorded and the payment queue has been updated.',
        detail: [
          `Amount: ₱${stored?.amount ?? recorded.input.amount}`,
          `Reference: ${stored?.reference ?? recorded.input.reference ?? '—'}`,
          `Payment ID: ${stored?.paymentNumber ?? stored?.id ?? '—'}`,
          customerName ? `Customer: ${customerName}` : null,
          recordLabel
            ? `${origin === 'reservation' ? 'Reservation' : 'Sale'}: ${recordLabel}`
            : null,
          `Current payment status: ${stored?.status ?? 'recorded (confirmation unavailable)'}`,
        ]
          .filter((line): line is string => line !== null)
          .join('\n'),
      });
    },
    onError: (error) => {
      setConfirming(false);
      // `message` is the server's own domain envelope, already free of SQL,
      // stack traces and RPC internals.
      notifyError({
        title: 'Unable to Record Payment',
        message: error instanceof Error ? error.message : 'The payment was not recorded.',
      });
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Record a payment"
      footer={
        <div className={styles.dialogFooter}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <span className={styles.dialogFooterSpacer} aria-hidden="true" />
          <Button
            disabled={!paymentValid || save.isSuccess || confirming}
            loading={save.isPending}
            loadingLabel="Recording…"
            onClick={() => save.mutate(paymentInput)}
          >
            {confirming ? 'Recording…' : 'Record'}
          </Button>
        </div>
      }
    >
      {summary.isPending ? (
        <RecordDialogSkeleton />
      ) : (
        <>
          {customerName || recordLabel ? (
            <div className={styles.dialogHero}>
              <span className={styles.dialogHeroIcon} aria-hidden="true">
                <Icon name="dollar-sign" size={22} />
              </span>
              <div className={styles.dialogHeroBody}>
                <p className={styles.dialogHeroTitle}>{customerName ?? recordLabel}</p>
                {customerName && recordLabel ? (
                  <p className={styles.dialogHeroMeta}>{recordLabel}</p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className={styles.formGrid}>
            <p className={styles.formNote}>
              The payment is saved as <strong>recorded</strong> and does not count toward the price
              until it is verified. The resulting balance is recalculated on the server.
            </p>
            {summary.data ? (
              <section className={styles.detailSection} aria-label="Sale figures">
                <h2 className={styles.detailTitle}>Sale figures</h2>
                <dl className={styles.facts}>
                  <div>
                    <dt>Scheme</dt>
                    <dd>{paymentSchemeLabel(summary.data.paymentScheme)}</dd>
                  </div>
                  <div>
                    <dt>Frozen total</dt>
                    <dd>{formatMoney(summary.data.cashPrice)}</dd>
                  </div>
                  <div>
                    <dt>Reservation</dt>
                    <dd>{formatMoney(summary.data.reservationFee)}</dd>
                  </div>
                  <div>
                    <dt>Required initial</dt>
                    <dd>{formatMoney(summary.data.requiredInitial)}</dd>
                  </div>
                  <div>
                    <dt>Monthly target</dt>
                    <dd>
                      {summary.data.installmentMonths && summary.data.monthlyAmount
                        ? `${formatMoney(summary.data.monthlyAmount)} × ${summary.data.installmentMonths}`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Verified paid</dt>
                    <dd>{formatMoney(summary.data.verifiedTotal)}</dd>
                  </div>
                  <div>
                    <dt>Remaining balance</dt>
                    <dd>{formatMoney(summary.data.remainingBalance)}</dd>
                  </div>
                </dl>
              </section>
            ) : null}
            <section className={styles.detailSection} aria-label="Payment details">
              <h2 className={styles.detailTitle}>Payment details</h2>
              <div className={styles.formGrid}>
                <TextField
                  id="record-payment-amount"
                  name="amount"
                  label="Amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(value) => {
                    setAmount(value);
                    setAmountDirty(true);
                  }}
                  error={
                    amountDirty && !amountValid
                      ? 'Enter a valid amount greater than zero without letters or scientific notation.'
                      : undefined
                  }
                />
                <label className={styles.field}>
                  Type
                  <select value={type} onChange={(e) => setType(e.target.value as PaymentType)}>
                    <option value="down_payment">Down payment</option>
                    <option value="installment">Installment</option>
                    <option value="full">Full payment</option>
                  </select>
                </label>
                <label className={styles.field}>
                  Method
                  <input value={method} onChange={(e) => setMethod(e.target.value)} />
                </label>
                <label className={styles.field}>
                  Payment reference
                  <input
                    aria-describedby="payment-reference-help"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                  />
                </label>
                <p id="payment-reference-help" className={styles.formNote}>
                  Enter the transaction/reference number from the payment receipt, bank transfer,
                  GCash/Maya transaction, deposit slip, or official receipt.
                </p>
                {save.error ? (
                  <p role="alert" className={styles.formAlert}>
                    The payment was not recorded. {save.error.message}
                  </p>
                ) : null}
              </div>
            </section>
          </div>
        </>
      )}
    </Dialog>
  );
}

export function VerifyDialog({
  saleId,
  origin = 'sale',
  onDone,
  onClose,
}: {
  saleId: string;
  origin?: 'sale' | 'reservation';
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const payments = useQuery({
    queryKey: [
      'business',
      origin === 'reservation' ? 'reservation-payments' : 'sale-payments',
      saleId,
    ],
    queryFn: async () =>
      origin === 'reservation'
        ? await getReservationPayments(saleId)
        : await getSalePayments(saleId),
  });
  const pending = payments.data?.filter((p) => p.status === 'recorded') ?? [];

  const verificationRequest = useMutationRequest();
  const decide = useMutation({
    mutationFn: async (input: {
      paymentId: string;
      decision: 'verified' | 'rejected';
      reason?: string;
    }) =>
      origin === 'reservation'
        ? await verifyReservationPayment(saleId, input.paymentId, {
            requestId: verificationRequest.forPayload(input),
            decision: input.decision,
            ...(input.reason ? { reason: input.reason } : {}),
          })
        : await verifyPayment(input.paymentId, {
            decision: input.decision,
            ...(input.reason ? { reason: input.reason } : {}),
          }),
    onSuccess: async () => {
      await onDone();
      verificationRequest.complete();
    },
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Verify a payment"
      footer={
        <div className={styles.dialogFooter}>
          <span className={styles.dialogFooterSpacer} aria-hidden="true" />
          <Button onClick={onClose}>Done</Button>
        </div>
      }
    >
      <div className={styles.formGrid}>
        {decide.isSuccess ? (
          <p role="status" className={styles.formNote}>
            Payment {decide.variables?.decision}.
          </p>
        ) : null}
        {pending.length > 0 ? (
          <div className={styles.dialogHero}>
            <span className={styles.dialogHeroIcon} aria-hidden="true">
              <Icon name="check" size={22} />
            </span>
            <div className={styles.dialogHeroBody}>
              <p className={styles.dialogHeroTitle}>
                {formatPoints(pending.length)} awaiting verification
              </p>
              <p className={styles.dialogHeroMeta}>
                Verify to count the money toward the price, or reject it back for correction.
              </p>
            </div>
          </div>
        ) : null}
        {pending.length === 0 ? (
          <p className={styles.formNote}>No payment is awaiting verification.</p>
        ) : (
          <ul className={styles.timeline}>
            {pending.map((payment) => (
              <li key={payment.id} className={styles.timelineItem}>
                <div className={styles.timelineTop}>
                  <span className={styles.timelineAmount}>{formatMoney(payment.amount)}</span>
                  <StatusChip label={humanizeCode(payment.status)} />
                </div>
                <p className={styles.timelineMeta}>
                  {payment.paymentType.replaceAll('_', ' ')} · {payment.method}{' '}
                  {payment.reference ? `(${payment.reference})` : '(No reference)'}
                </p>
                <div className={styles.timelineActions}>
                  <Button
                    onClick={() => decide.mutate({ paymentId: payment.id, decision: 'verified' })}
                    loading={decide.isPending}
                    loadingLabel="Verifying…"
                  >
                    Verify
                  </Button>
                  <Button
                    variant="danger"
                    onClick={() =>
                      decide.mutate({
                        paymentId: payment.id,
                        decision: 'rejected',
                        reason: reason || 'Rejected by Finance',
                      })
                    }
                    disabled={decide.isPending}
                  >
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <label className={styles.field}>
          Reason (required to reject)
          <input value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
        {decide.error ? (
          <p role="alert" className={styles.formAlert}>
            {decide.error.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * Full details of an application-origin reservation. Read-only on purpose:
 * recording, verifying, printing and finalizing all live in the row menu,
 * so this dialog can never mutate anything it displays.
 */
function ReservationDetails({
  item,
  onClose,
}: {
  item: Extract<FinanceCollectionQueueItem, { origin: 'reservation' }>;
  onClose: () => void;
}) {
  const payments = useQuery({
    queryKey: ['business', 'reservation-payments', item.reservationId],
    queryFn: () => getReservationPayments(item.reservationId),
    refetchInterval: 15_000,
  });
  const status = statusBadgeProps(item.status);
  return (
    <Dialog
      open
      title={item.reservationNumber}
      onClose={onClose}
      footer={
        <div className={styles.dialogFooter}>
          <span className={styles.dialogFooterSpacer} aria-hidden="true" />
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className={styles.dialogHero}>
        <span className={styles.dialogHeroIcon} aria-hidden="true">
          <Icon name="file-text" size={22} />
        </span>
        <div className={styles.dialogHeroBody}>
          <p className={styles.dialogHeroTitle}>{item.reservationNumber}</p>
          <p className={styles.dialogHeroMeta}>
            {item.customerName} · {item.productName} · {paymentSchemeLabel(item.paymentScheme)}
          </p>
        </div>
        <TierBadge tier={item.tier} />
        <StatusChip label={status.label} tone={status.tone} />
      </div>
      <section className={styles.detailSection} aria-label="Reservation figures">
        <h2 className={styles.detailTitle}>Reservation figures</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Frozen total</dt>
            <dd>{formatMoney(item.totalPrice)}</dd>
          </div>
          <div>
            <dt>Verified paid</dt>
            <dd>{formatMoney(item.verifiedTotal)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatMoney(item.remainingBalance)}</dd>
          </div>
          <div>
            <dt>Reservation fee</dt>
            <dd>{formatMoney(item.reservationFee)}</dd>
          </div>
          <div>
            <dt>Required initial</dt>
            <dd>{formatMoney(item.requiredInitial)}</dd>
          </div>
          <div>
            <dt>Monthly target</dt>
            <dd>
              {item.installmentMonths && item.monthlyAmount
                ? `${formatMoney(item.monthlyAmount)} × ${item.installmentMonths}`
                : '—'}
            </dd>
          </div>
          <div>
            <dt>Application</dt>
            <dd>{item.applicationNumber}</dd>
          </div>
          <div>
            <dt>Seller</dt>
            <dd>{item.sellerName}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.detailSection} aria-label="Payment ledger">
        <h2 className={styles.detailTitle}>Payment ledger</h2>
        {payments.isPending ? (
          <TimelineSkeleton />
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : payments.data.length ? (
          <ol className={styles.timeline}>
            {payments.data.map((payment) => (
              <li key={payment.id} className={styles.timelineItem}>
                <div className={styles.timelineTop}>
                  <span className={styles.timelineAmount}>{formatMoney(payment.amount)}</span>
                  <StatusChip label={humanizeCode(payment.status)} />
                </div>
                <p className={styles.timelineMeta}>
                  {payment.paymentType.replaceAll('_', ' ')} · {payment.method} ·{' '}
                  {payment.reference ?? 'No reference'}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.dialogHeroMeta}>No payments recorded.</p>
        )}
      </section>
      <section className={styles.detailSection} aria-label="Status">
        <h2 className={styles.detailTitle}>Status</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Fully paid</dt>
            <dd>{item.fullyPaid ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Recorded payments</dt>
            <dd>{formatPoints(item.recordedPaymentCount)}</dd>
          </div>
        </dl>
      </section>
    </Dialog>
  );
}

function PaymentDetails({
  canHandlePayments,
  item,
  onClose,
  onRecord,
  onVerify,
}: {
  canHandlePayments: boolean;
  item: FinanceQueueItem;
  onClose: () => void;
  onRecord: (item: FinanceQueueItem) => void;
  onVerify: () => void;
}) {
  const payments = useQuery({
    queryKey: ['business', 'sale-payments', item.saleId],
    queryFn: () => getSalePayments(item.saleId),
    refetchInterval: 15_000,
  });
  const status = statusBadgeProps(item.status);
  return (
    <Dialog
      open
      title={item.saleNumber}
      onClose={onClose}
      footer={
        <div className={styles.dialogFooter}>
          <span className={styles.dialogFooterSpacer} aria-hidden="true" />
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className={styles.dialogHero}>
        <span className={styles.dialogHeroIcon} aria-hidden="true">
          <Icon name="file-text" size={22} />
        </span>
        <div className={styles.dialogHeroBody}>
          <p className={styles.dialogHeroTitle}>{item.saleNumber}</p>
          <p className={styles.dialogHeroMeta}>
            {item.customerName} · {item.productName} · {paymentSchemeLabel(item.paymentScheme)}
          </p>
        </div>
        <StatusChip label={status.label} tone={status.tone} />
      </div>
      <section className={styles.detailSection} aria-label="Sale summary">
        <h2 className={styles.detailTitle}>Sale summary</h2>
        <p className={styles.figureLine}>
          Total: <strong>{formatMoney(item.cashPrice)}</strong>
        </p>
      </section>
      <section className={styles.detailSection} aria-label="Payment progress">
        <h2 className={styles.detailTitle}>Payment progress</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Reservation</dt>
            <dd>{formatMoney(item.reservationFee)}</dd>
          </div>
          <div>
            <dt>Required initial</dt>
            <dd>{formatMoney(item.requiredInitial)}</dd>
          </div>
          <div>
            <dt>Verified paid</dt>
            <dd>{formatMoney(item.verifiedTotal)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatMoney(item.remainingBalance)}</dd>
          </div>
          <div>
            <dt>Monthly target</dt>
            <dd>
              {formatMoney(item.monthlyAmount)}{' '}
              {item.installmentMonths ? '× ' + item.installmentMonths : ''}
            </dd>
          </div>
          <div>
            <dt>First verified date</dt>
            <dd>{item.firstVerifiedPayment ? formatDateTime(item.firstVerifiedPayment) : '—'}</dd>
          </div>
          <div>
            <dt>Spot cash</dt>
            <dd>{SPOT_CASH_LABEL[item.spotCashState]}</dd>
          </div>
          <div>
            <dt>Deadline</dt>
            <dd>{item.spotCashDeadline ? formatDateTime(item.spotCashDeadline) : '—'}</dd>
          </div>
        </dl>
      </section>
      <section className={styles.detailSection} aria-label="Payment timeline">
        <h2 className={styles.detailTitle}>Payment timeline</h2>
        {payments.isPending ? (
          <TimelineSkeleton />
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : payments.data.length ? (
          <ol className={styles.timeline}>
            {payments.data.map((payment) => (
              <li key={payment.id} className={styles.timelineItem}>
                <div className={styles.timelineTop}>
                  <span className={styles.timelineAmount}>{formatMoney(payment.amount)}</span>
                  <StatusChip label={humanizeCode(payment.status)} />
                </div>
                <p className={styles.timelineMeta}>
                  {payment.paymentType.replaceAll('_', ' ')} · {payment.method} ·{' '}
                  {payment.reference ?? 'No reference'}
                </p>
              </li>
            ))}
          </ol>
        ) : (
          <p className={styles.dialogHeroMeta}>No payments recorded.</p>
        )}
      </section>
      <section className={styles.detailSection} aria-label="Status">
        <h2 className={styles.detailTitle}>Status</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Initial requirement met</dt>
            <dd>{item.downPaymentSatisfied ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Fully paid</dt>
            <dd>{item.fullyPaid ? 'Yes' : 'No'}</dd>
          </div>
          <div>
            <dt>Activation eligible</dt>
            <dd>{item.activatable ? 'Yes' : 'No'}</dd>
          </div>
        </dl>
      </section>
      <div className={styles.actionGroup}>
        <Button disabled={!canHandlePayments} onClick={() => onRecord(item)}>
          Record payment
        </Button>
        <Button disabled={!canHandlePayments} variant="secondary" onClick={onVerify}>
          Verify payment
        </Button>
      </div>
    </Dialog>
  );
}
