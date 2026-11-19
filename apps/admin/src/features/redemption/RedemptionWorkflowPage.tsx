import { useState } from 'react';
import { Link } from 'react-router';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatCountOrDash } from '@afhomes/shared';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatusChip,
  notifyConfirm,
  notifyError,
} from '@afhomes/ui';
import { listClaims, reissueEarningClaim, type ClaimRow } from '../business/points-services';
import { ClaimQr, type IssuedClaim } from '../business/ClaimQr';
import { useSession } from '../../lib/session';
import { formatDateTime } from '../../lib/format';
import styles from './claims.module.css';

const CLAIM_STATUSES = ['all', 'available', 'claimed', 'expired', 'reversed'] as const;

const capitalize = (value: string) =>
  value.length === 0 ? value : value.charAt(0).toUpperCase() + value.slice(1);

/**
 * Earned points claims (read-only queue plus code rotation).
 *
 * Nothing here moves points. Listing and rotating claim codes are reads and
 * credential maintenance; spending a balance happens only on the Use VIP Points
 * screen, never here. Rotation replaces the previous QR and typed code (both
 * are identifiers for the same claim, and neither authorizes anything on its
 * own) while an unexpired claim keeps its expiry.
 */
export function RedemptionWorkflowPage({ history = false }: { history?: boolean }) {
  const client = useQueryClient();
  const [status, setStatus] = useState<(typeof CLAIM_STATUSES)[number]>(
    history ? 'all' : 'available',
  );
  const [search, setSearch] = useState('');
  const [issued, setIssued] = useState<IssuedClaim | null>(null);
  const permission = useSession().user?.afHomesPermissions?.find(
    (p) => p.moduleKey === 'operations.redemption',
  );
  const claims = useQuery({
    queryKey: ['earning', 'claims'],
    queryFn: listClaims,
    // Keep the previous list visible while a refetch runs: without this the
    // data gap reads as an empty result during every background refresh.
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const rotation = useBusinessMutation({
    mutationFn: reissueEarningClaim,
    retry: false,
    onSuccess: (data) => {
      setIssued(data);
      void client.invalidateQueries({ queryKey: ['earning'] });
    },
    onError: (error) =>
      notifyError({ title: 'Could not rotate the claim', message: error.message }),
  });
  const rotate = async (row: ClaimRow) => {
    if (rotation.isPending) return;
    if (
      await notifyConfirm({
        title: 'Rotate this claim code?',
        message: `${row.claimNumber}: the previous QR and typed code will stop working. An unexpired claim keeps its expiry.`,
        confirmButtonText: 'Rotate code',
      })
    )
      rotation.mutate(row.id);
  };
  const rows = (claims.data ?? []).filter(
    (row) =>
      (status === 'all' || row.status === status) &&
      [
        row.claimNumber,
        row.purchaseNumber,
        row.customerNumber,
        row.customerName,
        row.membershipNumber,
        row.serviceName,
      ].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())),
  );

  // First load skeletonizes the whole page - header, filters, and table - so
  // no static content flashes before the data it describes. Refetches keep the
  // previous list visible via placeholderData and never reach this branch.
  if (claims.isPending)
    return (
      <section>
        <div
          style={{ display: 'grid', gap: 'var(--space-4)' }}
          role="status"
          aria-label="Loading earning claims"
        >
          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <Skeleton style={{ height: 32, maxWidth: 260 }} />
            <Skeleton style={{ height: 16, maxWidth: 420 }} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <Skeleton style={{ height: 40, flex: '1 1 200px', maxWidth: 420 }} />
            <Skeleton style={{ height: 40, width: 180 }} />
          </div>
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
            <Skeleton style={{ height: 48 }} />
          </div>
        </div>
      </section>
    );

  return (
    <section className={styles.page}>
      <PageHeader
        title={history ? 'Earning Claim History' : 'Earned Points Claims'}
        description="Points earned from paid service purchases. Customers claim them in their own accounts. Spending a balance happens only on the Use VIP Points screen, never here."
      />
      <nav className={styles.links} aria-label="Claim records">
        <Link to={history ? '/admin/redemption' : '/admin/redemption/history'}>
          {history ? 'Available claims' : 'Claim history'}
        </Link>
        <Link to="/admin/redemption/legacy-history">Legacy points transactions</Link>
      </nav>
      <FilterBar
        filtersToggleLabel="Expand Filters"
        search={
          <SearchField
            label="Search claims"
            value={search}
            onChange={setSearch}
            placeholder="Claim, purchase, member or service"
            busy={claims.isFetching}
          />
        }
        filters={
          <label className={styles.filterLabel}>
            Claim status
            <Select
              aria-label="Claim status"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              options={CLAIM_STATUSES.map((value) => ({
                value,
                label: capitalize(value),
              }))}
            />
          </label>
        }
      />
      {claims.isError ? (
        <ErrorState error={claims.error} onRetry={claims.refetch} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No earning claims"
          description="Claims become available after eligible service purchases are paid and completed."
        />
      ) : (
        // The shared `.table-scroll` contract rather than a local wrapper: it is
        // keyboard-focusable, so an operator on a 360px phone can actually reach
        // the scroller, and it announces itself as a region.
        <div
          role="region"
          aria-label="Scrollable claims"
          tabIndex={0}
          className={`table-scroll ${styles.tableWrap}`}
        >
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Claim / purchase</th>
                <th scope="col">Customer / membership</th>
                <th scope="col">Service</th>
                <th scope="col">Requested</th>
                <th scope="col">Reserved</th>
                <th scope="col">Awarded</th>
                <th scope="col">Capped</th>
                <th scope="col">Status</th>
                <th scope="col">Dates</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td data-label="Claim / purchase">
                    {row.claimNumber}
                    <small>{row.purchaseNumber ?? row.purchaseId}</small>
                  </td>
                  <td data-label="Customer / membership">
                    {row.customerName ?? row.customerNumber ?? row.customerId}
                    <small>{row.membershipNumber}</small>
                  </td>
                  <td data-label="Service">{row.serviceName ?? 'Service purchase'}</td>
                  <td data-label="Requested">{formatCountOrDash(row.pointsRequested)}</td>
                  <td data-label="Reserved">{formatCountOrDash(row.pointsReserved)}</td>
                  <td data-label="Awarded">{formatCountOrDash(row.pointsAwarded)}</td>
                  <td data-label="Capped">{formatCountOrDash(row.pointsCapped)}</td>
                  <td data-label="Status">
                    <StatusChip label={capitalize(row.status)} />
                  </td>
                  <td data-label="Dates">
                    <small>Expires: {row.expiresAt ? formatDateTime(row.expiresAt) : '-'}</small>
                    {row.claimedAt && <small>Claimed: {formatDateTime(row.claimedAt)}</small>}
                  </td>
                  <td data-label="Actions">
                    {permission?.canCreate && ['available', 'expired'].includes(row.status) && (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={rotation.isPending && rotation.variables === row.id}
                        // A named label, not the generic "Loading…": while the
                        // previous code is being invalidated the operator must be
                        // able to say WHICH action is running.
                        loadingLabel={`Rotating ${row.claimNumber}…`}
                        disabled={rotation.isPending}
                        onClick={() => void rotate(row)}
                      >
                        Rotate code
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {issued && (
        <Dialog
          open
          title="Give the customer their new claim code"
          onClose={() => {
            setIssued(null);
            rotation.reset();
          }}
        >
          <ClaimQr claim={issued} />
        </Dialog>
      )}
    </section>
  );
}
