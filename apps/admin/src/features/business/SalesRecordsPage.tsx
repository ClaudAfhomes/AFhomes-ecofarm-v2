import { useQuery } from '@tanstack/react-query';
import { ErrorState, PageHeader, Skeleton, StatusChip } from '@afhomes/ui';
import { formatMoney } from './format';
import styles from './points.module.css';
import { listClaims, listPurchases, type ClaimRow, type PurchaseRow } from './points-services';
import { useSession } from '../../lib/session';

export function SalesRecordsPage() {
  const purchases = useQuery({
    queryKey: ['earning', 'purchases'],
    queryFn: listPurchases,
    refetchInterval: 15000,
  });
  const mayViewClaims =
    useSession().user?.afHomesPermissions?.some(
      (p) => p.moduleKey === 'operations.redemption' && p.canView,
    ) === true;
  const claims = useQuery({
    queryKey: ['earning', 'claims'],
    queryFn: listClaims,
    refetchInterval: 15000,
    enabled: mayViewClaims,
  });
  return (
    <>
      <PageHeader
        title="Operational Services Sales Records"
        description="Permanent purchase and claim evidence. Recorded receipts and verified money are shown separately."
      />
      <p>
        The points ledger is permanent. Corrections require a separate authorized, audited
        adjustment.
      </p>
      {/* `isLoading`, never `isPending`: the claims query is DISABLED for a caller
          without `operations.redemption`, and in TanStack Query v5 a disabled
          query stays `isPending` forever. Gating a skeleton on `isPending` is
          exactly how a page becomes a permanent loading state for a legitimate
          user. `aria-busy` says the region is working; the Skeletons are
          aria-hidden, so this element is the only announcement. */}
      {purchases.isLoading || (mayViewClaims && claims.isLoading) ? (
        <div role="status" aria-label="Loading sales records" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : purchases.isError || (mayViewClaims && claims.isError) ? (
        <ErrorState
          error={purchases.error ?? claims.error}
          onRetry={() => {
            void purchases.refetch();
            if (mayViewClaims) void claims.refetch();
          }}
        />
      ) : (
        <PointsHistory
          purchases={purchases.data ?? []}
          claims={mayViewClaims ? (claims.data ?? []) : []}
        />
      )}
    </>
  );
}

function PointsHistory({ purchases, claims }: { purchases: PurchaseRow[]; claims: ClaimRow[] }) {
  return (
    <>
      <section aria-label="Purchases">
        <h3>Purchases</h3>
        {purchases.length === 0 && <p className={styles.hint}>No purchases recorded yet.</p>}
        {purchases.length > 0 && (
          // Eleven columns cannot fit a 360px phone. The shared `.table-scroll`
          // contract keeps the overflow INSIDE this region so the page itself
          // never scrolls sideways, and `tabIndex` is what makes the scroller
          // reachable by keyboard at all.
          <div
            role="region"
            aria-label="Scrollable purchases"
            tabIndex={0}
            className="table-scroll"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Purchase</th>
                  <th scope="col">Status</th>
                  <th scope="col">Gross</th>
                  <th scope="col">VIP discount</th>
                  <th scope="col">Legacy points discount</th>
                  <th scope="col">Recorded</th>
                  <th scope="col">Verified</th>
                  <th scope="col">Customer / seller</th>
                  <th scope="col">Services</th>
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
                    <td>{formatMoney(row.tierDiscountAmount ?? '0.00')}</td>
                    <td>{formatMoney(row.pointsDiscountAmount)}</td>
                    <td>{formatMoney(row.recordedTotal)}</td>
                    <td>{formatMoney(row.verifiedTotal)}</td>
                    <td>
                      {row.customerName ?? row.customerId}
                      <br />
                      {row.createdByName ?? '-'}
                    </td>
                    <td>
                      {row.lines
                        .map((line) => `${line.serviceName ?? 'Service'} x ${line.quantity}`)
                        .join(', ')}
                    </td>
                    <td>{formatMoney(row.netAmount)}</td>
                    <td>
                      {row.completedAt
                        ? new Date(row.completedAt).toLocaleDateString('en-PH')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-label="Claims">
        <h3>Claims</h3>
        {claims.length === 0 && <p className={styles.hint}>No claims issued yet.</p>}
        {claims.length > 0 && (
          <div role="region" aria-label="Scrollable claims" tabIndex={0} className="table-scroll">
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
          </div>
        )}
      </section>
    </>
  );
}
