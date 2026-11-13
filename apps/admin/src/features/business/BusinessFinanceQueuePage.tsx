import styles from './BusinessFinanceQueuePage.module.css';
import { ImportPaymentClaimsPanel } from './ImportPaymentClaimsPanel';
import { FinanceSummaryCards } from './FinanceSummaryCards';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useSingleFlight } from '../../lib/useSingleFlight';
import { useMutationRequest } from '../../lib/useMutationRequest';
import { useSession } from '../../lib/session';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  PAYMENT_RECEIPT_CONTENT_TYPES,
  PAYMENT_RECEIPT_MAX_BYTES,
  REJECTION_REASON_MIN_LENGTH,
  paymentReceiptUploadRequestSchema,
  paymentSchemeLabel,
  recordPaymentSchema,
} from '@afhomes/contracts';
import { putUploadBytes } from '../documents/services';
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
  PurchaseDocumentKind,
  ReservationFinanceSummary,
} from '@afhomes/contracts';

import { formatDateTime } from '../../lib/format';
import { normalizeProfileName } from '../../lib/normalize';
import { downloadFile } from '../../lib/download';
import {
  SPOT_CASH_LABEL,
  activationBadge,
  formatMoney,
  paymentProgress,
  paymentProgressBadge,
  paymentStatusBadge,
  reservationAgreementStatusBadge,
  saleStatusBadge,
  type PaymentProgress,
  type StatusBadge,
} from './format';
import { TierBadge } from './TierBadge';
import { businessKeys, sharedScopes } from './queryKeys';
import { compareMoney, formatCountOrDash, formatMoneyOrDash, subtractMoney } from '@afhomes/shared';
import {
  PAYMENT_PURPOSE_LABEL,
  PURPOSE_PAYMENT_TYPE,
  type PaymentPurpose,
  availablePurposes,
  nextPaymentStep,
} from './payment-purposes';
import {
  exportPurchaseDocument,
  finalizeReservationPurchase,
  getFinanceQueue,
  getReservationPayments,
  getReservationFinance,
  recordReservationPayment,
  requestReservationPaymentReceiptUpload,
  requestSalePaymentReceiptUpload,
  verifyReservationPayment,
  getSalePayments,
  getSaleSummary,
  recordPayment,
  saveDuplicateReview,
  verifyPayment,
} from './services';
import {
  DuplicateHoldPanel,
  PaymentLedgerList,
  isDuplicateHold,
  paymentDetailLine,
  todayIso,
} from './PaymentFinanceParts';

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

/** Formats a raw numeric money string with thousands separators while typing. */
function formatMoneyInput(raw: string): string {
  if (!/^[0-9,.]*$/.test(raw)) return raw;
  const cleaned = raw.replace(/,/g, '');
  if (!cleaned) return '';
  const [intPart, decPart] = cleaned.split('.');
  const formattedInt = (intPart ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${formattedInt}.${decPart}` : formattedInt;
}

/**
 * Client-side payment-progress filter over the loaded queue rows. It filters
 * on exactly the milestone the Payment column shows, never on lifecycle.
 */
const PROGRESS_OPTIONS = [
  { value: 'all', label: 'All payment progress' },
  { value: 'none', label: 'No Verified Payments' },
  { value: 'partial', label: 'Partially Paid' },
  { value: 'full', label: 'Fully Paid' },
] as const satisfies readonly { value: 'all' | PaymentProgress; label: string }[];

type ProgressFilter = (typeof PROGRESS_OPTIONS)[number]['value'];

/** Frozen contract amount the verified total is measured against. */
const frozenTotal = (item: FinanceCollectionQueueItem): string =>
  item.origin === 'sale' ? item.cashPrice : item.totalPrice;

/** Payment progress from verified settlement vs the frozen amount. */
const itemProgress = (item: FinanceCollectionQueueItem): PaymentProgress =>
  paymentProgress(item.verifiedTotal, frozenTotal(item));

/**
 * Lifecycle badge for a queue row: the sale's own status, or the reservation
 * agreement's status for an application-origin row. Never mixed with money.
 */
const lifecycleBadge = (item: FinanceCollectionQueueItem): StatusBadge =>
  item.origin === 'sale'
    ? saleStatusBadge(item.status)
    : reservationAgreementStatusBadge(item.status);

/**
 * Loading placeholder: hero chips, summary badges and table rows shaped like
 * the loaded queue, so nothing pops in and reflows once the data lands. The
 * search stays mounted and usable while loading (it is a control, not data).
 */
function QueueSkeleton() {
  return (
    <div role="status" aria-label="Loading payment queue" className={styles.skeletonShell}>
      <ul className={styles.skeletonBadges} aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <li key={index}>
            <Skeleton style={{ height: 24, width: '10rem', borderRadius: '999px' }} />
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
  /** Opens the record-payment dialog in the parent, pre-loaded with the next purpose. */
  onRecord: (purpose?: PaymentPurpose) => void;
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
  const step = nextPaymentStep({ ...item, origin: 'reservation' });
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
      label: 'Record & verify payment',
      icon: 'dollar-sign',
      disabled: !canHandlePayments || busy,
      onClick: () => onRecord(),
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
      <span
        data-row-menu
        onClick={(event) => event.stopPropagation()}
        style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}
      >
        <Button
          size="sm"
          disabled={!canHandlePayments || busy}
          onClick={() => (step.key === 'finalize' ? void finalize() : onRecord(step.purpose))}
        >
          {step.label}
        </Button>
        <OverflowMenu label={`Actions for ${item.reservationNumber}`} items={menuItems} />
      </span>
      {error ? <p role="alert">{error}</p> : null}
    </>
  );
}

export function BusinessFinanceQueuePage() {
  const { user } = useSession();
  const navigate = useNavigate();
  const canHandlePayments =
    user?.afHomesPermissions.some(
      (permission) =>
        permission.moduleKey === 'finance.payment_verification' && permission.canUpdate,
    ) ?? false;
  const client = useQueryClient();
  // A deep link from another list (`?search=RES-...`) lands on the right row.
  const [urlParams] = useSearchParams();
  const [search, setSearch] = useState(() => urlParams.get('search') ?? '');
  const settled = useDebouncedValue(search.trim());
  const query = useQuery({
    queryKey: businessKeys.financeQueue(settled),
    queryFn: () => getFinanceQueue(settled),
    // Keep the previous page on screen while the next search (or poll) lands:
    // refetches then feel instant and the skeleton only ever appears on the
    // very first load. `isPending` stays true only until the first page.
    placeholderData: keepPreviousData,
    // Money moves from other sessions too: poll the queue (same-session
    // writes invalidate instantly).
    refetchInterval: 15_000,
  });
  const rows = useMemo(() => query.data?.items ?? [], [query.data]);
  const [detail, setDetail] = useState<FinanceCollectionQueueItem | null>(null);
  const [recording, setRecording] = useState<{
    id: string;
    origin: 'sale' | 'reservation';
    customerName?: string;
    recordLabel?: string;
    purpose?: PaymentPurpose;
  } | null>(null);
  const [reviewing, setReviewing] = useState<{ id: string; origin: 'sale' | 'reservation' } | null>(
    null,
  );
  const [progressFilter, setProgressFilter] = useState<ProgressFilter>('all');
  const currentDetail = detail
    ? ((rows.find((item) =>
        detail.origin === 'sale'
          ? item.origin === 'sale' && item.saleId === detail.saleId
          : item.origin === 'reservation' && item.reservationId === detail.reservationId,
      ) ?? detail) as FinanceCollectionQueueItem)
    : null;

  // Row activation opens the view-details panel: recording stays available
  // through the row menu's "Record payment" action so a click never spends
  // or records money by accident.
  const selectItem = (item: FinanceCollectionQueueItem) => {
    setDetail(item);
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
    const progress = { none: 0, partial: 0, full: 0 };
    for (const item of rows) progress[itemProgress(item)] += 1;
    const overdue = rows.filter(
      (item) => item.origin === 'sale' && item.status === 'overdue',
    ).length;
    const total = query.data?.total ?? rows.length;
    return { total, loaded: rows.length, overdue, ...progress };
  }, [rows, query.data?.total]);
  // Client-side payment-progress filter over the loaded rows; the search
  // itself stays server-side via the debounced term.
  const visible = useMemo(
    () => rows.filter((item) => progressFilter === 'all' || itemProgress(item) === progressFilter),
    [rows, progressFilter],
  );
  const truncated = summary.total > summary.loaded;

  const refresh = async () => {
    await client.invalidateQueries({ queryKey: businessKeys.queue });
    // Payment reports (verified/pending/rejected totals) stay fresh too.
    await client.invalidateQueries({ queryKey: sharedScopes.reports });
    await client.invalidateQueries({ queryKey: businessKeys.saleSummaryScope });
    await client.invalidateQueries({ queryKey: businessKeys.salePaymentsScope });
    await client.invalidateQueries({ queryKey: businessKeys.sales });
  };

  // First load skeletonizes the whole page: header, summary, filters and
  // table. Refetches keep the previous page visible via placeholderData and
  // never reach this branch.
  if (query.isPending)
    return (
      <section className={styles.pageShell}>
        <div className={styles.hero} aria-hidden="true">
          <div className={styles.heroText}>
            <Skeleton style={{ height: 14, width: 160 }} />
            <Skeleton style={{ height: 30, maxWidth: 240 }} />
            <Skeleton style={{ height: 16, maxWidth: 360 }} />
          </div>
          <div className={styles.heroMeta}>
            <Skeleton style={{ height: 30, width: 120, borderRadius: 999 }} />
            <Skeleton style={{ height: 30, width: 110, borderRadius: 999 }} />
          </div>
        </div>
        <div
          style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}
          aria-hidden="true"
        >
          <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
          <Skeleton style={{ height: 40, width: 160 }} />
        </div>
        <QueueSkeleton />
      </section>
    );

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
          <span className={styles.heroChip}>
            <Icon name="clock" size={14} aria-hidden="true" />
            {formatCountOrDash(summary.none + summary.partial)} not fully paid
          </span>
          <span className={styles.heroChip}>
            <Icon name="check" size={14} aria-hidden="true" />
            {formatCountOrDash(summary.full)} fully paid
          </span>
        </div>
      </div>

      <FinanceSummaryCards />

      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
          <ul className={styles.badges} aria-label="Queue summary">
            <li>
              <StatusChip
                label={`No Verified Payments: ${formatCountOrDash(summary.none)}`}
                tone="neutral"
              />
            </li>
            <li>
              <StatusChip
                label={`Partially Paid: ${formatCountOrDash(summary.partial)}`}
                tone="warning"
              />
            </li>
            <li>
              <StatusChip label={`Fully Paid: ${formatCountOrDash(summary.full)}`} tone="success" />
            </li>
            <li>
              <StatusChip label={`Overdue: ${formatCountOrDash(summary.overdue)}`} tone="danger" />
            </li>
            <li>
              <StatusChip
                label={`Queue records: ${formatCountOrDash(summary.total)}`}
                tone="neutral"
                icon="file-text"
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
                Payment progress
                <Select
                  aria-label="Filter by payment progress"
                  value={progressFilter}
                  onChange={(event) => setProgressFilter(event.target.value as ProgressFilter)}
                  options={[...PROGRESS_OPTIONS]}
                />
              </label>
            }
          />

          {truncated ? (
            <Alert variant="warning" title="Queue capped">
              Showing the first {formatCountOrDash(summary.loaded)} of{' '}
              {formatCountOrDash(summary.total)} records. Narrow the search to reach the rest.
            </Alert>
          ) : null}

          {visible.length === 0 ? (
            <EmptyState
              title={
                settled || progressFilter !== 'all' ? 'No matching records.' : 'Nothing to handle'
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
                    <TableHeaderCell>Payment</TableHeaderCell>
                    <TableHeaderCell>Actions</TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {visible.map((item) => {
                    const recordNumber =
                      item.origin === 'sale' ? item.saleNumber : item.reservationNumber;
                    const status = lifecycleBadge(item);
                    const progress = paymentProgressBadge(itemProgress(item));
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
                          <TierBadge tier={item.tier} />
                        </TableCell>
                        <TableCell label="Balance" className={styles.numeric}>
                          <span className={styles.balanceFigure}>
                            {formatMoney(item.remainingBalance)}
                          </span>
                          <span className={styles.progress} aria-hidden="true">
                            <span
                              className={styles.progressBar}
                              style={{
                                width: `${progressPercent(item.verifiedTotal, frozenTotal(item))}%`,
                              }}
                            />
                          </span>
                        </TableCell>
                        <TableCell label="Status">
                          <StatusChip label={status.label} tone={status.tone} />
                        </TableCell>
                        <TableCell label="Payment">
                          <StatusChip label={progress.label} tone={progress.tone} />
                        </TableCell>
                        <TableCell label="Actions">
                          {item.origin === 'reservation' ? (
                            <ReservationActions
                              item={item}
                              canHandlePayments={canHandlePayments}
                              onViewDetails={() => setDetail(item)}
                              onRecord={(purpose) =>
                                setRecording({
                                  id: item.reservationId,
                                  origin: 'reservation',
                                  customerName: item.customerName,
                                  recordLabel: item.reservationNumber,
                                  purpose,
                                })
                              }
                              onVerify={() =>
                                setReviewing({ id: item.reservationId, origin: 'reservation' })
                              }
                              onDone={refresh}
                            />
                          ) : (
                            <span
                              data-row-menu
                              onClick={(event) => event.stopPropagation()}
                              style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}
                            >
                              {(() => {
                                const step = nextPaymentStep(item);
                                if (step.key === 'none')
                                  return <span className={styles.formNote}>{step.label}</span>;
                                return (
                                  <Button
                                    size="sm"
                                    disabled={!canHandlePayments}
                                    onClick={() =>
                                      step.key === 'activate'
                                        ? navigate('/admin/finance/activation')
                                        : setRecording({
                                            id: item.saleId,
                                            origin: 'sale',
                                            customerName: item.customerName,
                                            recordLabel: item.saleNumber,
                                            purpose: step.purpose,
                                          })
                                    }
                                  >
                                    {step.label}
                                  </Button>
                                );
                              })()}
                              <OverflowMenu
                                label={`Actions for ${recordNumber}`}
                                items={[
                                  {
                                    label: 'View details',
                                    icon: 'file-text',
                                    onClick: () => setDetail(item),
                                  },
                                  {
                                    label: 'Record & verify payment',
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
          initialPurpose={recording.purpose}
          customerName={recording.customerName}
          recordLabel={recording.recordLabel}
          onDone={async () => {
            if (recording.origin === 'reservation') {
              await client.invalidateQueries({
                queryKey: ['business', 'reservation-payments', recording.id],
              });
            }
            await refresh();
            // Drop the cached queue so the page re-enters its loading skeleton
            // and visibly re-fetches the updated content instead of silently
            // swapping stale rows.
            await client.resetQueries({ queryKey: businessKeys.queue });
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

/** Raised when the payment IS recorded but the verification step failed. */
class VerifyStageError extends Error {
  constructor(
    message: string,
    /** The server held verification for a duplicate bank reference / OR number. */
    readonly hold = false,
  ) {
    super(message);
  }
}

type RecordStep = 1 | 2 | 3;

/**
 * Finance's single "record and verify" flow: details -> proof -> review, then
 * ONE action records the payment and immediately verifies it. If verification
 * fails the payment stays Recorded in the queue and "Retry verification"
 * re-verifies the SAME payment (no second record).
 */
export function RecordPaymentDialog({
  saleId,
  origin = 'sale',
  customerName,
  recordLabel,
  initialPurpose,
  onDone,
  onClose,
}: {
  saleId: string;
  origin?: 'sale' | 'reservation';
  /** The next step the row asked for; used when still valid for the purchase. */
  initialPurpose?: PaymentPurpose;
  /** Shown in the confirmation so staff confirm the right customer. */
  customerName?: string;
  /** The sale or reservation number this payment belongs to. */
  recordLabel?: string;
  onDone: () => Promise<void>;
  onClose: () => void;
}) {
  const navigate = useNavigate();
  const { user: sessionUser } = useSession();
  // UX only: the server authorizes activation.
  const canActivate =
    sessionUser?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'finance.card_activation' && permission.canUpdate,
    ) ?? false;
  const [step, setStep] = useState<RecordStep>(1);
  const [purposeChoice, setPurposeChoice] = useState<PaymentPurpose | ''>(initialPurpose ?? '');
  const [amountEdit, setAmountEdit] = useState<string | null>(null);
  // Purpose and amount as recorded: later ledger changes never move them.
  const [frozen, setFrozen] = useState<{ purpose: PaymentPurpose | ''; amount: string } | null>(
    null,
  );
  const [orNumber, setOrNumber] = useState('');
  const [paidOn, setPaidOn] = useState(todayIso);
  const [paidByName, setPaidByName] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [reference, setReference] = useState('');
  const runPayment = useSingleFlight<
    Awaited<ReturnType<typeof recordPayment>> | Awaited<ReturnType<typeof recordReservationPayment>>
  >();
  const paymentRequest = useMutationRequest();
  const verifyRequest = useMutationRequest();
  // The payment this action recorded: a verify retry reuses it, never records again.
  const [recordedId, setRecordedId] = useState<string | null>(null);
  const [hold, setHold] = useState(false);
  const [verifyFailure, setVerifyFailure] = useState('');

  // Receipt: uploaded to the private bucket as soon as it is picked; the
  // returned storage path is what the record call carries. A replacement
  // clears the path first, so Next stays disabled until the new upload lands.
  const [receiptPath, setReceiptPath] = useState('');
  const [receiptName, setReceiptName] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptState, setReceiptState] = useState<'idle' | 'uploading' | 'error'>('idle');
  const [receiptError, setReceiptError] = useState('');
  const receiptAttempt = useRef(0);
  const previewRef = useRef('');
  const [previewUrl, setPreviewUrl] = useState('');
  const dropPreview = () => {
    if (previewRef.current) URL.revokeObjectURL?.(previewRef.current);
    previewRef.current = '';
    setPreviewUrl('');
  };
  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL?.(previewRef.current);
    },
    [],
  );
  const pickReceipt = async (file: File | undefined) => {
    if (!file) return;
    const attempt = ++receiptAttempt.current;
    setReceiptPath('');
    setReceiptFile(null);
    dropPreview();
    setReceiptName(file.name);
    const request = paymentReceiptUploadRequestSchema.safeParse({
      contentType: file.type,
      byteSize: file.size,
    });
    if (!request.success) {
      setReceiptState('error');
      setReceiptError(
        !(PAYMENT_RECEIPT_CONTENT_TYPES as readonly string[]).includes(file.type)
          ? 'Receipt must be a JPEG, PNG or PDF file.'
          : `Receipt must be larger than 0 bytes and at most ${Math.floor(PAYMENT_RECEIPT_MAX_BYTES / 1048576)} MB.`,
      );
      return;
    }
    setReceiptState('uploading');
    setReceiptError('');
    try {
      const grant = await (origin === 'reservation'
        ? requestReservationPaymentReceiptUpload(saleId, request.data)
        : requestSalePaymentReceiptUpload(saleId, request.data));
      await putUploadBytes(grant.uploadUrl, file);
      if (attempt !== receiptAttempt.current) return;
      setReceiptPath(grant.receiptStoragePath);
      setReceiptFile(file);
      if (typeof URL.createObjectURL === 'function') {
        previewRef.current = URL.createObjectURL(file);
        setPreviewUrl(previewRef.current);
      }
      setReceiptState('idle');
    } catch (error) {
      if (attempt !== receiptAttempt.current) return;
      setReceiptState('error');
      setReceiptError(
        error instanceof Error ? error.message : 'The receipt could not be uploaded. Try again.',
      );
    }
  };
  const summary = useQuery({
    queryKey: businessKeys.summaryFor(origin, saleId),
    queryFn: async () => {
      if (origin === 'sale') return getSaleSummary(saleId);
      const finance = await getReservationFinance(saleId);
      return { ...finance, cashPrice: finance.totalPrice };
    },
  });
  const ledger = useQuery({
    queryKey: businessKeys.paymentsFor(origin, saleId),
    queryFn: async () =>
      origin === 'reservation'
        ? await getReservationPayments(saleId)
        : await getSalePayments(saleId),
  });
  const options = useMemo(
    () =>
      summary.data && ledger.data
        ? availablePurposes(
            {
              total: summary.data.cashPrice,
              reservationFee: summary.data.reservationFee,
              requiredInitial: summary.data.requiredInitial,
              monthlyAmount: summary.data.monthlyAmount ?? null,
              installmentMonths: summary.data.installmentMonths ?? null,
            },
            ledger.data,
          )
        : [],
    [summary.data, ledger.data],
  );
  // Default to the next purpose due; a purpose that stops being valid falls back to it.
  const purpose: PaymentPurpose | '' =
    frozen?.purpose ??
    (options.find((option) => option.purpose === purposeChoice) ?? options[0])?.purpose ??
    '';
  const chosen = options.find((option) => option.purpose === purpose);
  const amount = frozen?.amount ?? amountEdit ?? chosen?.amount ?? '';
  const amountDirty = amountEdit !== null;
  const choosePurpose = (next: PaymentPurpose) => {
    setPurposeChoice(next);
    setAmountEdit(null);
  };

  const amountValid = recordPaymentSchema.shape.amount.safeParse(amount).success;
  const amountWithinLimit =
    Boolean(chosen) &&
    amountValid &&
    (chosen!.locked
      ? compareMoney(amount, chosen!.amount) === 0
      : compareMoney(amount, chosen!.max) <= 0);
  const paidOnValid = paidOn === '' || paidOn <= todayIso();
  const detailsValid = Boolean(frozen) || (Boolean(chosen) && amountWithinLimit && paidOnValid);
  const paymentInput = {
    amount,
    ...(purpose ? { paymentType: PURPOSE_PAYMENT_TYPE[purpose], paymentPurpose: purpose } : {}),
    method,
    ...(reference ? { reference } : {}),
    ...(orNumber.trim() ? { orNumber: orNumber.trim() } : {}),
    ...(paidOn ? { paidOn } : {}),
    ...(paidByName.trim() ? { paidByName: normalizeProfileName(paidByName.trim()) } : {}),
    ...(receiptPath ? { receiptStoragePath: receiptPath } : {}),
  };
  const paymentValid = recordPaymentSchema.safeParse(paymentInput).success;

  const verifiedBefore = summary.data?.verifiedTotal ?? '0.00';
  const balanceBefore = summary.data?.remainingBalance ?? '0.00';
  const balanceAfter =
    amountValid && compareMoney(balanceBefore, amount) > 0
      ? subtractMoney(balanceBefore, amount)
      : '0.00';

  const save = useBusinessMutation({
    mutationFn: async (input: { note?: string }) => {
      setVerifyFailure('');
      let paymentId = recordedId;
      if (!paymentId) {
        const parsed = recordPaymentSchema.parse(paymentInput);
        const before = new Set((await ledger.refetch()).data?.map((payment) => payment.id) ?? []);
        const result = await runPayment(() => {
          const body = {
            ...parsed,
            requestId: paymentRequest.forPayload({ origin, saleId, ...parsed }),
          };
          return origin === 'reservation'
            ? recordReservationPayment(saleId, body as never)
            : recordPayment(saleId, body);
        });
        let recorded: string | undefined;
        if (isReservationFinanceSummary(result)) {
          // The reservation endpoint answers with the finance summary: the
          // payment just recorded is the newest 'recorded' row that was not
          // in the ledger before (same purpose and amount).
          recorded = [...result.payments]
            .filter(
              (row) =>
                row.status === 'recorded' &&
                !before.has(row.id) &&
                row.paymentPurpose === parsed.paymentPurpose &&
                compareMoney(row.amount, parsed.amount) === 0,
            )
            .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))[0]?.id;
        } else {
          recorded = result.id;
        }
        if (!recorded)
          throw new VerifyStageError(
            'The payment was recorded but could not be identified for verification. Open Verify to finish.',
          );
        paymentId = recorded;
        setRecordedId(recorded);
        setFrozen({ purpose, amount });
      }
      let fullyPaid: boolean;
      try {
        if (input.note) await saveDuplicateReview(paymentId, input.note);
        if (origin === 'reservation') {
          const outcome = await verifyReservationPayment(saleId, paymentId, {
            requestId: verifyRequest.forPayload({ paymentId, decision: 'verified' }),
            decision: 'verified',
          });
          fullyPaid = outcome.fullyPaid;
        } else {
          const outcome = await verifyPayment(paymentId, { decision: 'verified' });
          fullyPaid = outcome.fullyPaid;
        }
      } catch (error) {
        // Recorded but unverified: keep it visible in the queue as Recorded.
        await onDone().catch(() => undefined);
        throw new VerifyStageError(
          error instanceof Error ? error.message : 'The verification did not complete.',
          isDuplicateHold(error) || Boolean(input.note),
        );
      }
      return { paymentId, fullyPaid };
    },
    // The alert reports the SERVER's stored row, never the browser's optimism.
    onSuccess: async ({ paymentId, fullyPaid }) => {
      await onDone();
      paymentRequest.complete();
      verifyRequest.complete();
      onClose();
      let stored:
        | {
            amount: string;
            reference: string | null;
            orNumber?: string | null;
            paymentNumber?: string | null;
            status: string;
          }
        | undefined;
      try {
        stored = (await ledger.refetch()).data?.find((row) => row.id === paymentId);
      } catch {
        // The payment IS recorded and verified; the alert falls back to the form.
      }
      const detail = [
          `Amount: ${formatMoneyOrDash(stored?.amount ?? amount)}`,
          purpose ? `Purpose: ${PAYMENT_PURPOSE_LABEL[purpose]}` : null,
          `Reference: ${stored?.reference ?? (reference || '—')}`,
          stored?.orNumber ? `OR number: ${stored.orNumber}` : null,
          `Payment ID: ${stored?.paymentNumber ?? '—'}`,
          customerName ? `Customer: ${customerName}` : null,
          recordLabel
            ? `${origin === 'reservation' ? 'Reservation' : 'Sale'}: ${recordLabel}`
            : null,
          `Current payment status: ${stored?.status ?? 'verified'}`,
        ]
        .filter((line): line is string => line !== null)
        .join('\n');
      // The final payment made the purchase fully paid: offer the (still manual)
      // activation. A sale activates directly; a reservation is finalized first.
      if (fullyPaid && origin === 'sale' && canActivate) {
        const activateNow = await notifyConfirm({
          title: 'Payment Recorded and Verified',
          message: `${detail}\n\nThis purchase is now fully paid. Activate the membership now?`,
          confirmButtonText: 'Activate now',
        });
        if (activateNow) navigate(`/admin/finance/activation?sale=${encodeURIComponent(saleId)}`);
        return;
      }
      notifySuccess({
        title: 'Payment Recorded and Verified',
        message: 'The payment has been recorded and verified, and the payment queue is updated.',
        detail,
      });
    },
    onError: (error) => {
      if (error instanceof VerifyStageError) {
        setVerifyFailure(error.message);
        setHold(error.hold);
        if (error.hold) return;
        notifyError({
          title: 'Recorded, not verified',
          message: `The payment was recorded but not verified: ${error.message} It stays in the queue as Recorded; use "Retry verification".`,
        });
        return;
      }
      // `message` is the server's own domain envelope, already free of SQL,
      // stack traces and RPC internals.
      notifyError({
        title: 'Unable to Record Payment',
        message: error instanceof Error ? error.message : 'The payment was not recorded.',
      });
    },
  });
  const recordedUnverified = Boolean(verifyFailure) || (save.isError && Boolean(recordedId));

  const stepLabel = ['Details', 'Proof', 'Review'];
  const footer = (
    <div className={styles.dialogFooter}>
      {step === 1 ? (
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      ) : (
        <Button
          variant="secondary"
          disabled={save.isPending || recordedUnverified}
          onClick={() => setStep((step - 1) as RecordStep)}
        >
          Back
        </Button>
      )}
      <span className={styles.dialogFooterSpacer} aria-hidden="true" />
      {step === 3 ? (
        <Button
          disabled={!paymentValid || !detailsValid || save.isSuccess || hold}
          loading={save.isPending}
          loadingLabel={recordedId ? 'Verifying…' : 'Recording and verifying…'}
          onClick={() => save.mutate({})}
        >
          {recordedUnverified ? 'Retry verification' : 'Verify and record'}
        </Button>
      ) : (
        <Button
          disabled={step === 1 ? !detailsValid : !receiptPath}
          onClick={() => setStep((step + 1) as RecordStep)}
        >
          Next
        </Button>
      )}
    </div>
  );

  return (
    <Dialog open onClose={onClose} title="Record & verify payment" footer={footer}>
      {summary.isPending || ledger.isPending ? (
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
          <p className={styles.formNote} aria-label="Progress">
            Step {step} of 3 · {stepLabel[step - 1]}
          </p>
          <div className={styles.formGrid}>
            {step === 1 ? (
              <>
                <p className={styles.formNote}>
                  <strong>Recorded and verified in one action.</strong> Server recalculates balance.
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
                    {options.length === 0 ? (
                      <p role="alert" className={styles.formAlert}>
                        No payment can be recorded: the purchase is fully paid or every remaining
                        amount is already awaiting verification.
                      </p>
                    ) : (
                      <label className={styles.field}>
                        Payment is for
                        <Select
                          aria-label="Payment is for"
                          value={purpose}
                          onChange={(e) => choosePurpose(e.target.value as PaymentPurpose)}
                          options={options.map((option) => ({
                            value: option.purpose,
                            label: option.label,
                          }))}
                        />
                      </label>
                    )}
                    <TextField
                      id="record-payment-amount"
                      name="amount"
                      label="Amount"
                      type="text"
                      inputMode="decimal"
                      value={formatMoneyInput(amount)}
                      readOnly={chosen?.locked ?? false}
                      hint={
                        chosen?.locked
                          ? 'Full payment must equal the exact remaining balance.'
                          : chosen
                            ? `Next amount due is pre-filled; at most ${formatMoney(chosen.max)}.`
                            : undefined
                      }
                      onChange={(value) => {
                        setAmountEdit(value.replace(/,/g, ''));
                      }}
                      error={
                        amountDirty && !amountValid
                          ? 'Enter a valid amount greater than zero without letters or scientific notation.'
                          : amountDirty && chosen && !amountWithinLimit
                            ? `Amount cannot exceed ${formatMoney(chosen.max)} for this payment.`
                            : undefined
                      }
                    />
                    <label className={styles.field}>
                      Method
                      <Select
                        aria-label="Method"
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                        options={[
                          { value: 'bank_transfer', label: 'Bank Transfer' },
                          { value: 'cash', label: 'Cash' },
                          { value: 'gcash', label: 'GCash' },
                          { value: 'maya', label: 'Maya' },
                          { value: 'check', label: 'Check' },
                          { value: 'other', label: 'Other' },
                        ]}
                      />
                    </label>
                    <TextField
                      id="record-payment-reference"
                      name="reference"
                      label="Payment reference"
                      optional
                      value={reference}
                      onChange={setReference}
                      hint="Enter the transaction or reference number."
                    />
                    <TextField
                      id="record-payment-or"
                      name="orNumber"
                      label="OR number"
                      optional
                      maxLength={60}
                      value={orNumber}
                      onChange={setOrNumber}
                    />
                    <label className={styles.field}>
                      Payment date
                      <input
                        type="date"
                        name="paidOn"
                        value={paidOn}
                        max={todayIso()}
                        aria-invalid={!paidOnValid}
                        onChange={(event) => setPaidOn(event.target.value)}
                      />
                      {!paidOnValid ? (
                        <span role="alert" className={styles.formAlert}>
                          The payment date cannot be in the future.
                        </span>
                      ) : null}
                    </label>
                    <TextField
                      id="record-payment-paid-by"
                      name="paidByName"
                      label="Paid by"
                      optional
                      maxLength={120}
                      value={paidByName}
                      onChange={setPaidByName}
                    />
                  </div>
                </section>
              </>
            ) : null}
            {step === 2 ? (
              <section className={styles.detailSection} aria-label="Payment proof">
                <h2 className={styles.detailTitle}>Proof of payment</h2>
                <div className={styles.field}>
                  <label htmlFor="record-payment-receipt">
                    Payment receipt (JPEG, PNG or PDF, max 10 MB)
                  </label>
                  <input
                    id="record-payment-receipt"
                    type="file"
                    accept={PAYMENT_RECEIPT_CONTENT_TYPES.join(',')}
                    required
                    disabled={save.isPending}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      event.target.value = '';
                      void pickReceipt(file);
                    }}
                  />
                  {receiptState === 'uploading' ? (
                    <p role="status">Uploading {receiptName}…</p>
                  ) : receiptPath ? (
                    <p role="status">Uploaded: {receiptName}. Choose another file to replace it.</p>
                  ) : receiptState === 'error' ? (
                    <p role="alert" className={styles.formAlert}>
                      {receiptError}
                    </p>
                  ) : (
                    <p className={styles.formNote}>A receipt is required to record a payment.</p>
                  )}
                </div>
              </section>
            ) : null}
            {step === 3 ? (
              <>
                <section className={styles.detailSection} aria-label="Payment review">
                  <h2 className={styles.detailTitle}>Review before verifying</h2>
                  <dl className={styles.facts}>
                    {customerName ? (
                      <div>
                        <dt>Customer</dt>
                        <dd>{customerName}</dd>
                      </div>
                    ) : null}
                    {recordLabel ? (
                      <div>
                        <dt>{origin === 'reservation' ? 'Reservation' : 'Sale'}</dt>
                        <dd>{recordLabel}</dd>
                      </div>
                    ) : null}
                    <div>
                      <dt>Payment is for</dt>
                      <dd>{purpose ? PAYMENT_PURPOSE_LABEL[purpose] : '—'}</dd>
                    </div>
                    <div>
                      <dt>Amount</dt>
                      <dd>{formatMoneyOrDash(amount)}</dd>
                    </div>
                    <div>
                      <dt>Method</dt>
                      <dd>{method.replace(/_/g, ' ')}</dd>
                    </div>
                    <div>
                      <dt>Reference</dt>
                      <dd>{reference || '—'}</dd>
                    </div>
                    <div>
                      <dt>OR number</dt>
                      <dd>{orNumber.trim() || '—'}</dd>
                    </div>
                    <div>
                      <dt>Payment date</dt>
                      <dd>{paidOn || '—'}</dd>
                    </div>
                    <div>
                      <dt>Paid by</dt>
                      <dd>{paidByName.trim() ? normalizeProfileName(paidByName.trim()) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Price</dt>
                      <dd>{formatMoney(summary.data?.cashPrice ?? '0.00')}</dd>
                    </div>
                    <div>
                      <dt>Verified so far</dt>
                      <dd>{formatMoney(verifiedBefore)}</dd>
                    </div>
                    <div>
                      <dt>Balance before</dt>
                      <dd>{formatMoney(balanceBefore)}</dd>
                    </div>
                    <div>
                      <dt>Balance after</dt>
                      <dd>{formatMoney(balanceAfter)}</dd>
                    </div>
                  </dl>
                </section>
                <section className={styles.detailSection} aria-label="Proof preview">
                  <h2 className={styles.detailTitle}>Uploaded proof</h2>
                  <p className={styles.formNote}>{receiptName}</p>
                  {previewUrl && receiptFile?.type === 'application/pdf' ? (
                    <>
                      <object data={previewUrl} type="application/pdf" aria-label="Proof PDF preview" width="100%" height="320" />
                      <a href={previewUrl} target="_blank" rel="noreferrer">
                        Open proof PDF
                      </a>
                    </>
                  ) : previewUrl ? (
                    <img
                      src={previewUrl}
                      alt="Payment proof preview"
                      style={{ maxWidth: '100%', maxHeight: 320 }}
                    />
                  ) : null}
                </section>
                {verifyFailure ? (
                  <p role="alert" className={styles.formAlert}>
                    The payment was recorded but NOT verified. {verifyFailure} It remains in the
                    queue as Recorded; retry verification below.
                  </p>
                ) : save.error ? (
                  <p role="alert" className={styles.formAlert}>
                    The payment was not recorded. {save.error.message}
                  </p>
                ) : null}
                {hold && recordedId ? (
                  <DuplicateHoldPanel
                    paymentId={recordedId}
                    busy={save.isPending}
                    onSave={(note) => save.mutate({ note })}
                  />
                ) : null}
              </>
            ) : null}
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
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [decidingId, setDecidingId] = useState<string | null>(null);
  const [decidingDecision, setDecidingDecision] = useState<'verified' | 'rejected' | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // The payment the server held for a duplicate bank reference / OR number.
  const [holdId, setHoldId] = useState<string | null>(null);
  const payments = useQuery({
    queryKey: businessKeys.paymentsFor(origin, saleId),
    queryFn: async () =>
      origin === 'reservation'
        ? await getReservationPayments(saleId)
        : await getSalePayments(saleId),
  });
  const pending = payments.data?.filter((p) => p.status === 'recorded') ?? [];

  const verificationRequest = useMutationRequest();
  const decide = useBusinessMutation({
    mutationFn: async (input: {
      paymentId: string;
      decision: 'verified' | 'rejected';
      reason?: string;
      note?: string;
    }) => {
      setDecidingId(input.paymentId);
      setDecidingDecision(input.decision);
      if (input.note) await saveDuplicateReview(input.paymentId, input.note);
      return origin === 'reservation'
        ? await verifyReservationPayment(saleId, input.paymentId, {
            requestId: verificationRequest.forPayload({ ...input, note: undefined }),
            decision: input.decision,
            ...(input.reason ? { reason: input.reason } : {}),
          })
        : await verifyPayment(input.paymentId, {
            decision: input.decision,
            ...(input.reason ? { reason: input.reason } : {}),
          });
    },
    onSuccess: async (_result, input) => {
      verificationRequest.complete();
      setHoldId(null);
      if (input?.decision === 'verified') {
        notifySuccess({
          title: 'Payment verified',
          message: 'The payment now counts toward the price.',
        });
      }
      setRefreshing(true);
      await onDone();
      await payments.refetch();
      setRefreshing(false);
      setDecidingId(null);
      setDecidingDecision(null);
      setRejectingId(null);
      setReason('');
    },
    onError: (error, input) => {
      setDecidingId(null);
      setDecidingDecision(null);
      // Stays Recorded; the panel collects the reason and retries the SAME payment.
      setHoldId(isDuplicateHold(error) ? input.paymentId : null);
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
        {refreshing ? (
          <div role="status" aria-label="Refreshing payments" className={styles.formGrid}>
            <Skeleton style={{ height: 64 }} />
            <Skeleton style={{ height: 64 }} />
          </div>
        ) : null}
        {!refreshing && pending.length === 0 ? (
          <p className={styles.formNote}>No payment is awaiting verification.</p>
        ) : null}
        {!refreshing && pending.length > 0 ? (
          <>
            <div className={styles.dialogHero}>
              <span className={styles.dialogHeroIcon} aria-hidden="true">
                <Icon name="check" size={22} />
              </span>
              <div className={styles.dialogHeroBody}>
                <p className={styles.dialogHeroTitle}>
                  {formatCountOrDash(pending.length)} awaiting verification
                </p>
                <p className={styles.dialogHeroMeta}>
                  Verify to count the money, or reject for correction.
                </p>
              </div>
            </div>
            <ul className={styles.timeline}>
              {pending.map((payment) => {
                const isDeciding = decidingId === payment.id;
                const isRejecting = rejectingId === payment.id;
                return (
                  <li key={payment.id} className={styles.timelineItem}>
                    <div className={styles.timelineTop}>
                      <span className={styles.timelineAmount}>{formatMoney(payment.amount)}</span>
                      <StatusChip {...paymentStatusBadge(payment.status)} />
                    </div>
                    <p className={styles.timelineMeta}>
                      {payment.paymentType.replaceAll('_', ' ')} · {payment.method}{' '}
                      {payment.reference ? `(${payment.reference})` : '(No reference)'}
                    </p>
                    {paymentDetailLine(payment) ? (
                      <p className={styles.timelineMeta}>{paymentDetailLine(payment)}</p>
                    ) : null}
                    <div className={styles.timelineActions}>
                      <Button
                        onClick={() =>
                          decide.mutate({ paymentId: payment.id, decision: 'verified' })
                        }
                        loading={isDeciding && decidingDecision === 'verified'}
                        loadingLabel="Verifying…"
                        disabled={decide.isPending}
                      >
                        Verify
                      </Button>
                      <Button
                        variant="danger"
                        onClick={() => setRejectingId(isRejecting ? null : payment.id)}
                        disabled={decide.isPending}
                      >
                        {isRejecting ? 'Cancel' : 'Reject'}
                      </Button>
                    </div>
                    {holdId === payment.id ? (
                      <DuplicateHoldPanel
                        paymentId={payment.id}
                        busy={decide.isPending}
                        onSave={(note) =>
                          decide.mutate({ paymentId: payment.id, decision: 'verified', note })
                        }
                      />
                    ) : null}
                    {isRejecting ? (
                      <div className={styles.formGrid}>
                        <TextField
                          id="verify-reject-reason"
                          name="reason"
                          label="Reason (required to reject)"
                          value={reason}
                          onChange={setReason}
                        />
                        <Button
                          variant="danger"
                          disabled={
                            decide.isPending || reason.trim().length < REJECTION_REASON_MIN_LENGTH
                          }
                          loading={isDeciding && decidingDecision === 'rejected'}
                          loadingLabel="Rejecting…"
                          onClick={() =>
                            decide.mutate({
                              paymentId: payment.id,
                              decision: 'rejected',
                              reason: reason.trim(),
                            })
                          }
                        >
                          Confirm reject
                        </Button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
        {decide.error && !holdId ? (
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
  const status = reservationAgreementStatusBadge(item.status);
  const progress = paymentProgressBadge(itemProgress(item));
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
      <ImportPaymentClaimsPanel reservationId={item.reservationId} />
      <section className={styles.detailSection} aria-label="Payment ledger">
        <h2 className={styles.detailTitle}>Payment ledger</h2>
        {payments.isPending ? (
          <TimelineSkeleton />
        ) : payments.isError ? (
          <ErrorState error={payments.error} onRetry={payments.refetch} />
        ) : payments.data.length ? (
          <PaymentLedgerList payments={payments.data} />
        ) : (
          <p className={styles.dialogHeroMeta}>No payments recorded.</p>
        )}
      </section>
      <section className={styles.detailSection} aria-label="Status">
        <h2 className={styles.detailTitle}>Status</h2>
        <dl className={styles.facts}>
          <div>
            <dt>Agreement</dt>
            <dd>
              <StatusChip label={status.label} tone={status.tone} />
            </dd>
          </div>
          <div>
            <dt>Payment progress</dt>
            <dd>
              <StatusChip label={progress.label} tone={progress.tone} />
            </dd>
          </div>
          <div>
            <dt>Recorded payments</dt>
            <dd>{formatCountOrDash(item.recordedPaymentCount)}</dd>
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
    queryKey: businessKeys.salePayments(item.saleId),
    queryFn: () => getSalePayments(item.saleId),
    refetchInterval: 15_000,
  });
  const status = saleStatusBadge(item.status);
  const progress = paymentProgressBadge(paymentProgress(item.verifiedTotal, item.cashPrice));
  const activation = activationBadge(item.activationBlocker);
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
            <dd>{formatMoneyOrDash(item.reservationFee)}</dd>
          </div>
          <div>
            <dt>Required initial</dt>
            <dd>{formatMoneyOrDash(item.requiredInitial)}</dd>
          </div>
          <div>
            <dt>Verified paid</dt>
            <dd>{formatMoneyOrDash(item.verifiedTotal)}</dd>
          </div>
          <div>
            <dt>Balance</dt>
            <dd>{formatMoneyOrDash(item.remainingBalance)}</dd>
          </div>
          <div>
            <dt>Monthly target</dt>
            <dd>
              {formatMoneyOrDash(item.monthlyAmount)}{' '}
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
          <PaymentLedgerList payments={payments.data} />
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
            <dt>Sale status</dt>
            <dd>
              <StatusChip label={status.label} tone={status.tone} />
            </dd>
          </div>
          <div>
            <dt>Payment progress</dt>
            <dd>
              <StatusChip label={progress.label} tone={progress.tone} />
            </dd>
          </div>
          <div>
            <dt>Activation</dt>
            <dd>
              <StatusChip label={activation.label} tone={activation.tone} />
            </dd>
          </div>
        </dl>
      </section>
      <div className={styles.actionGroup}>
        <Button disabled={!canHandlePayments} onClick={() => onRecord(item)}>
          Record &amp; verify payment
        </Button>
        <Button disabled={!canHandlePayments} variant="secondary" onClick={onVerify}>
          Verify payment
        </Button>
      </div>
    </Dialog>
  );
}
