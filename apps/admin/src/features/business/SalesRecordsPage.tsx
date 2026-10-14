import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  OverflowMenu,
  PageHeader,
  Pagination,
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
import { formatCountOrDash, formatMoneyOrDash } from '@afhomes/shared';
import styles from './points.module.css';
import { TierBadge } from './TierBadge';
import {
  listClaimsPage,
  listPurchasesPage,
  type ClaimRow,
  type PurchaseRow,
} from './points-services';
import { useSession } from '../../lib/session';
import { earningKeys } from './queryKeys';

const statusTone = (status: string) =>
  status === 'completed' || status === 'claimed'
    ? ('success' as const)
    : status === 'reversed'
      ? ('danger' as const)
      : status === 'expired'
        ? ('warning' as const)
        : ('neutral' as const);

export function SalesRecordsPage() {
  const [purchasePage, setPurchasePage] = useState(0);
  const [claimPage, setClaimPage] = useState(0);
  const purchases = useQuery({
    queryKey: earningKeys.purchases(purchasePage),
    queryFn: () => listPurchasesPage(purchasePage),
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
  });
  const mayViewClaims =
    useSession().user?.afHomesPermissions?.some(
      (p) => p.moduleKey === 'operations.redemption' && p.canView,
    ) === true;
  const claims = useQuery({
    queryKey: earningKeys.claims(claimPage),
    queryFn: () => listClaimsPage(claimPage),
    placeholderData: keepPreviousData,
    refetchInterval: 15000,
    enabled: mayViewClaims,
  });
  const [detail, setDetail] = useState<PurchaseRow | null>(null);

  const purchaseRows = useMemo(() => purchases.data ?? [], [purchases.data]);
  const claimRows = useMemo(
    () => (mayViewClaims ? (claims.data ?? []) : []),
    [claims.data, mayViewClaims],
  );

  const completed = purchaseRows.filter((row) => row.status === 'completed').length;

  // First load skeletonizes the whole page. Refetches keep the previous page
  // visible via keepPreviousData and never reach this branch. Uses isLoading
  // (not isPending) so a disabled claims query never pins the page as loading.
  const firstLoad = purchases.isLoading || (mayViewClaims && claims.isLoading);
  if (firstLoad)
    return (
      <section className={styles.page}>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading sales records"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 320 }} />
            <Skeleton style={{ height: 16, maxWidth: 520 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
          <span className="sr-only">Loading sales records</span>
        </div>
      </section>
    );

  const failed = purchases.isError || (mayViewClaims && claims.isError);
  if (failed)
    return (
      <section className={styles.page}>
        <PageHeader
          title="Operational Services Sales Records"
          description="Permanent purchase and claim evidence. Recorded receipts and verified money are shown separately."
        />
        <ErrorState
          error={purchases.error ?? claims.error}
          onRetry={() => {
            void purchases.refetch();
            if (mayViewClaims) void claims.refetch();
          }}
        />
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title="Operational Services Sales Records"
        description="Permanent purchase and claim evidence. Recorded receipts and verified money are shown separately."
      />
      <Alert variant="warning" title="Permanent ledger">
        The points ledger is permanent. Corrections require a separate authorized, audited
        adjustment.
      </Alert>

      <ul className={styles.badges} aria-label="Records summary">
        <li>
          <StatusChip
            label={`Purchases loaded: ${formatCountOrDash(purchaseRows.length)}`}
            tone="neutral"
            icon="file-text"
          />
        </li>
        <li>
          <StatusChip
            label={`Completed: ${formatCountOrDash(completed)}`}
            tone="success"
            icon="check"
          />
        </li>
        {mayViewClaims ? (
          <li>
            <StatusChip
              label={`Claims loaded: ${formatCountOrDash(claimRows.length)}`}
              tone="neutral"
              icon="grid"
            />
          </li>
        ) : null}
      </ul>

      <PointsHistory purchases={purchaseRows} claims={claimRows} onView={setDetail} />
      <nav aria-label="Purchase history pages">
        <Pagination
          page={purchasePage + 1}
          pageCount={Math.max(1, purchasePage + ((purchases.data?.length ?? 0) < 200 ? 1 : 2))}
          onChange={(next) => setPurchasePage(next - 1)}
          label="Purchases pagination"
        />
        <Button
          variant="secondary"
          disabled={purchasePage === 0 || purchases.isFetching}
          onClick={() => setPurchasePage((page) => page - 1)}
        >
          Previous purchases
        </Button>
        <span>Purchase page {purchasePage + 1}</span>
        <Button
          variant="secondary"
          disabled={
            purchases.isFetching || purchases.isError || (purchases.data?.length ?? 0) < 200
          }
          onClick={() => setPurchasePage((page) => page + 1)}
        >
          Older purchases
        </Button>
      </nav>
      {mayViewClaims && (
        <nav aria-label="Claim history pages">
          <Button
            variant="secondary"
            disabled={claimPage === 0 || claims.isFetching}
            onClick={() => setClaimPage((page) => page - 1)}
          >
            Previous claims
          </Button>
          <span>Claim page {claimPage + 1}</span>
          <Button
            variant="secondary"
            disabled={claims.isFetching || claims.isError || (claims.data?.length ?? 0) < 200}
            onClick={() => setClaimPage((page) => page + 1)}
          >
            Older claims
          </Button>
        </nav>
      )}

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
              <dt>Status</dt>
              <dd>
                <StatusChip tone={statusTone(detail.status)} label={detail.status} />
              </dd>
            </div>
            {'tierSnapshot' in detail && detail.tierSnapshot ? (
              <div>
                <dt>Tier</dt>
                <dd>
                  <TierBadge tier={String(detail.tierSnapshot)} />
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Gross</dt>
              <dd>{formatMoneyOrDash(detail.grossAmount)}</dd>
            </div>
            <div>
              <dt>VIP discount</dt>
              <dd>{formatMoneyOrDash(detail.tierDiscountAmount ?? '0.00')}</dd>
            </div>
            <div>
              <dt>Points discount</dt>
              <dd>{formatMoneyOrDash(detail.pointsDiscountAmount)}</dd>
            </div>
            <div>
              <dt>Net</dt>
              <dd>{formatMoneyOrDash(detail.netAmount)}</dd>
            </div>
            <div>
              <dt>Recorded</dt>
              <dd>{formatMoneyOrDash(detail.recordedTotal)}</dd>
            </div>
            <div>
              <dt>Verified</dt>
              <dd>{formatMoneyOrDash(detail.verifiedTotal)}</dd>
            </div>
            <div>
              <dt>Customer</dt>
              <dd>{detail.customerName ?? detail.customerId}</dd>
            </div>
          </dl>
          <p className={styles.hint}>
            This record is read-only. History is never edited here; corrections go through an
            authorized adjustment.
          </p>
        </Dialog>
      ) : null}
    </section>
  );
}

function PointsHistory({
  purchases,
  claims,
  onView,
}: {
  purchases: PurchaseRow[];
  claims: ClaimRow[];
  onView: (row: PurchaseRow) => void;
}) {
  return (
    <>
      <section aria-label="Purchases" className={styles.section}>
        <h2 className={styles.sectionTitle}>Purchases</h2>
        {purchases.length === 0 && (
          <EmptyState
            title="No purchases recorded yet."
            description="Record the first sale from the Elite Service Delivery screen."
          />
        )}
        {purchases.length > 0 && (
          // Eleven columns cannot fit a 360px phone. The shared `.table-scroll`
          // contract keeps the overflow INSIDE this region so the page itself
          // never scrolls sideways, and `tabIndex` is what makes the scroller
          // reachable by keyboard at all.
          <div
            role="region"
            aria-label="Scrollable purchases"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableCaption>
                Permanent purchase evidence with recorded and verified money.
              </TableCaption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Purchase</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Gross</TableHeaderCell>
                  <TableHeaderCell align="right">VIP discount</TableHeaderCell>
                  <TableHeaderCell align="right">Points discount</TableHeaderCell>
                  <TableHeaderCell align="right">Recorded</TableHeaderCell>
                  <TableHeaderCell align="right">Verified</TableHeaderCell>
                  <TableHeaderCell>Customer / seller</TableHeaderCell>
                  <TableHeaderCell>Services</TableHeaderCell>
                  <TableHeaderCell align="right">Net</TableHeaderCell>
                  <TableHeaderCell>Completed</TableHeaderCell>
                  <TableHeaderCell>
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {purchases.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell label="Purchase">{row.purchaseNumber}</TableCell>
                    <TableCell label="Status">
                      <StatusChip tone={statusTone(row.status)} label={row.status} />
                    </TableCell>
                    <TableCell label="Gross" align="right">
                      {formatMoneyOrDash(row.grossAmount)}
                    </TableCell>
                    <TableCell label="VIP discount" align="right">
                      {formatMoneyOrDash(row.tierDiscountAmount ?? '0.00')}
                    </TableCell>
                    <TableCell label="Points discount" align="right">
                      {formatMoneyOrDash(row.pointsDiscountAmount)}
                    </TableCell>
                    <TableCell label="Recorded" align="right">
                      {formatMoneyOrDash(row.recordedTotal)}
                    </TableCell>
                    <TableCell label="Verified" align="right">
                      {formatMoneyOrDash(row.verifiedTotal)}
                    </TableCell>
                    <TableCell label="Customer / seller">
                      {row.customerName ?? row.customerId}
                      <br />
                      {row.createdByName ?? '-'}
                    </TableCell>
                    <TableCell label="Services">
                      {row.lines
                        .map((line) => `${line.serviceName ?? 'Service'} x ${line.quantity}`)
                        .join(', ')}
                    </TableCell>
                    <TableCell label="Net" align="right">
                      {formatMoneyOrDash(row.netAmount)}
                    </TableCell>
                    <TableCell label="Completed">
                      {row.completedAt
                        ? new Date(row.completedAt).toLocaleDateString('en-PH')
                        : '—'}
                    </TableCell>
                    <TableCell label="Actions">
                      <OverflowMenu
                        label={`More actions for ${row.purchaseNumber}`}
                        items={[
                          {
                            label: 'View details',
                            icon: 'info',
                            onClick: () => onView(row),
                          },
                        ]}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      <section aria-label="Claims" className={styles.section}>
        <h2 className={styles.sectionTitle}>Claims</h2>
        {claims.length === 0 && (
          <EmptyState
            title="No claims issued yet."
            description="Claims appear here once a completed sale is issued its code."
          />
        )}
        {claims.length > 0 && (
          <div
            role="region"
            aria-label="Scrollable claims"
            tabIndex={0}
            className={`table-scroll ${styles.tableWrap}`}
          >
            <Table>
              <TableCaption>Issued earning claims with capped portions shown.</TableCaption>
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Claim</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell align="right">Reserved</TableHeaderCell>
                  <TableHeaderCell align="right">Awarded</TableHeaderCell>
                  <TableHeaderCell align="right">Capped</TableHeaderCell>
                  <TableHeaderCell>Expires</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {claims.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell label="Claim">{row.claimNumber}</TableCell>
                    <TableCell label="Status">
                      <StatusChip tone={statusTone(row.status)} label={row.status} />
                    </TableCell>
                    <TableCell label="Reserved" align="right">
                      {formatCountOrDash(row.pointsReserved)}
                    </TableCell>
                    <TableCell label="Awarded" align="right">
                      {formatCountOrDash(row.pointsAwarded)}
                    </TableCell>
                    {/* The capped figure is SHOWN, never hidden: it is the part of an
                        award the annual limit refused, and a member is entitled to
                        know it exists. */}
                    <TableCell label="Capped" align="right">
                      {formatCountOrDash(row.pointsCapped)}
                    </TableCell>
                    <TableCell label="Expires">
                      {row.expiresAt ? new Date(row.expiresAt).toLocaleString('en-PH') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}
