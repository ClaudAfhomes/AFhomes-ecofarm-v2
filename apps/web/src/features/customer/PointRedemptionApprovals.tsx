import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, ErrorState, Skeleton, notifyConfirm } from '@afhomes/ui';
import { formatMoney } from '@afhomes/shared';
import { Card } from './portal-ui';
import { decidePointApproval, getPointApprovals } from './services';
export function PointRedemptionApprovals() {
  const client = useQueryClient();
  const confirming = useRef(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const approvals = useQuery({
    queryKey: ['customer', 'points', 'approvals'],
    queryFn: getPointApprovals,
    refetchInterval: 15_000,
  });
  const decision = useMutation({
    mutationFn: async ({ quoteId, approve }: { quoteId: string; approve: boolean }) =>
      decidePointApproval(quoteId, approve),
    retry: false,
    onSuccess: () => client.invalidateQueries({ queryKey: ['customer', 'points'] }),
  });
  return (
    <Card title="Use accumulated points">
      <p>
        Staff prepare your purchase. Only you can approve spending from your account. Approval
        reserves points; your balance changes when the fully settled purchase completes.
      </p>
      {approvals.isLoading && (
        <div role="status" aria-label="Loading spending approvals">
          <Skeleton />
        </div>
      )}
      {approvals.isError && (
        <ErrorState
          title="Spending approvals unavailable"
          message="Your approvals could not be loaded."
          onRetry={approvals.refetch}
        />
      )}
      {approvals.data?.length === 0 && <p>No spending approvals yet.</p>}
      {approvals.data?.map((approval) => (
        <section key={approval.quoteId} aria-label={'Spending approval ' + approval.quoteNumber}>
          <h3>{approval.serviceName}</h3>
          <p>
            {approval.purchaseNumber} · {approval.quoteNumber}
          </p>
          <ul>
            {approval.lines.map((line, index) => (
              <li key={index}>
                {line.quantity} x {line.serviceName} - VIP discount{' '}
                {line.tierDiscountRate === null ? 'not recorded' : line.tierDiscountRate + '%'}
              </li>
            ))}
          </ul>
          <dl>
            <dt>Actual service / stay dates</dt>
            <dd>{approval.serviceDates?.serviceDate ?? (approval.serviceDates?.checkInDate && approval.serviceDates?.checkOutDate ? `${approval.serviceDates.checkInDate} to ${approval.serviceDates.checkOutDate} (check-out excluded)` : 'Missing dates ? ask staff to prepare a dated request')}</dd>
            <dt>Allowance</dt>
            <dd>{approval.allowanceType ?? 'Date update required'} ? Weekday: {approval.weekdayPoints ?? 'Unavailable'} ? Weekend: {approval.weekendPoints ?? 'Unavailable'}</dd>
            <dt>Gross amount</dt>
            <dd>{formatMoney(approval.grossAmount)}</dd>
            <dt>VIP tier discount</dt>
            <dd>{formatMoney(approval.tierDiscountAmount)}</dd>
            <dt>Configured conversion</dt>
            <dd>
              {'\u20b1'}
              {approval.pesoValuePerPoint} per point
            </dd>
            <dt>Points to reserve</dt>
            <dd>{approval.pointsRequested.toLocaleString('en-PH')}</dd>
            <dt>Points discount</dt>
            <dd>{formatMoney(approval.pesoValue)}</dd>
            <dt>Final cash payable</dt>
            <dd>{formatMoney(approval.finalAmountPayable)}</dd>
            <dt>Approval expires</dt>
            <dd>
              {new Intl.DateTimeFormat('en-PH', {
                dateStyle: 'medium',
                timeStyle: 'short',
                timeZone: 'Asia/Manila',
              }).format(new Date(approval.expiresAt))}{' '}
              (Manila)
            </dd>
            <dt>Status</dt>
            <dd>{approval.status}</dd>
          </dl>
          {approval.status === 'pending' && (
            <>
              <Button
                disabled={decision.isPending || confirmationOpen || !approval.allowanceType}
                loading={
                  decision.isPending &&
                  decision.variables?.quoteId === approval.quoteId &&
                  decision.variables.approve
                }
                loadingLabel="Approving…"
                onClick={async () => {
                  if (confirming.current || decision.isPending) return;
                  confirming.current = true;
                  setConfirmationOpen(true);
                  try {
                    if (
                      await notifyConfirm({
                        title: 'Authorize these points?',
                        message:
                          approval.purchaseNumber +
                          ': ' +
                          approval.pointsRequested.toLocaleString('en-PH') +
                          ' points for ' +
                          formatMoney(approval.pesoValue) +
                          ' off ' +
                          approval.serviceName +
                          '. Cash payable ' +
                          formatMoney(approval.finalAmountPayable) +
                          '.',
                        confirmButtonText: 'Authorize points',
                      })
                    )
                      decision.mutate({ quoteId: approval.quoteId, approve: true });
                  } finally {
                    confirming.current = false;
                    setConfirmationOpen(false);
                  }
                }}
              >
                Authorize points
              </Button>
              <Button
                variant="secondary"
                disabled={decision.isPending || confirmationOpen}
                onClick={() => decision.mutate({ quoteId: approval.quoteId, approve: false })}
              >
                Reject
              </Button>
            </>
          )}
          {approval.status === 'approved' && (
            <p>Reserved, awaiting verified settlement. No points have been permanently deducted.</p>
          )}
          {approval.status === 'completed' && (
            <p>Points deducted. Your points activity records this transaction.</p>
          )}
        </section>
      ))}
      {decision.isError && (
        <ErrorState
          title="Approval not recorded"
          message="The quote may have expired or changed. Refresh before trying again."
          onRetry={approvals.refetch}
        />
      )}
    </Card>
  );
}
