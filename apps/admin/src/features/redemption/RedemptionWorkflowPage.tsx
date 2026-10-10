import { useState } from 'react';
import { Link } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusChip,
  notifyConfirm,
  notifyError,
} from '@afhomes/ui';
import { listClaims, reissueEarningClaim, type ClaimRow } from '../business/points-services';
import { ClaimQr, type IssuedClaim } from '../business/ClaimQr';
import { useSession } from '../../lib/session';
import styles from './claims.module.css';

export function RedemptionWorkflowPage({ history = false }: { history?: boolean }) {
  const client = useQueryClient();
  const [status, setStatus] = useState(history ? 'all' : 'available');
  const [search, setSearch] = useState('');
  const [issued, setIssued] = useState<IssuedClaim | null>(null);
  const permission = useSession().user?.afHomesPermissions?.find(
    (p) => p.moduleKey === 'operations.redemption',
  );
  const claims = useQuery({
    queryKey: ['earning', 'claims'],
    queryFn: listClaims,
    refetchInterval: 15_000,
  });
  const rotation = useMutation({
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
  return (
    <>
      <PageHeader
        title={history ? 'Earning Claim History' : 'Redeem Points'}
        description="Points earned from paid service purchases. Customers claim them in their own accounts."
      />
      <nav className={styles.links} aria-label="Claim records">
        <Link to={history ? '/admin/redemption' : '/admin/redemption/history'}>
          {history ? 'Available claims' : 'Claim history'}
        </Link>
        <Link to="/admin/redemption/legacy-history">Legacy points transactions</Link>
      </nav>
      <div className={styles.filters}>
        <label>
          Search claims
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Claim, purchase, member or service"
          />
        </label>
        <label>
          Claim status
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {['all', 'available', 'claimed', 'expired', 'reversed'].map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      </div>
      {claims.isPending ? (
        <div role="status" aria-label="Loading earning claims" aria-busy="true">
          <Skeleton />
          <Skeleton />
          <Skeleton />
        </div>
      ) : claims.isError ? (
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
        <div role="region" aria-label="Scrollable claims" tabIndex={0} className="table-scroll">
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
                  <td>
                    {row.claimNumber}
                    <small>{row.purchaseNumber ?? row.purchaseId}</small>
                  </td>
                  <td>
                    {row.customerName ?? row.customerNumber ?? row.customerId}
                    <small>{row.membershipNumber}</small>
                  </td>
                  <td>{row.serviceName ?? 'Service purchase'}</td>
                  <td>{row.pointsRequested.toLocaleString('en-PH')}</td>
                  <td>{row.pointsReserved.toLocaleString('en-PH')}</td>
                  <td>{row.pointsAwarded.toLocaleString('en-PH')}</td>
                  <td>{row.pointsCapped.toLocaleString('en-PH')}</td>
                  <td>
                    <StatusChip label={row.status} />
                  </td>
                  <td>
                    <small>
                      Expires:{' '}
                      {row.expiresAt ? new Date(row.expiresAt).toLocaleString('en-PH') : '-'}
                    </small>
                    {row.claimedAt && (
                      <small>Claimed: {new Date(row.claimedAt).toLocaleString('en-PH')}</small>
                    )}
                  </td>
                  <td>
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
    </>
  );
}
