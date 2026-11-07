import { useQuery } from '@tanstack/react-query';
import { ErrorState, Skeleton } from '@afhomes/ui';
import { getCustomerRefunds } from './services';
import { Card, Field, FieldList, formatDate } from './portal-ui';
export function CustomerRefundHistory() {
  const refunds = useQuery({
    queryKey: ['customer', 'points', 'refunds'],
    queryFn: getCustomerRefunds,
    refetchInterval: 30_000,
  });
  return (
    <Card title="Service refunds">
      {refunds.isLoading && (
        <div role="status" aria-label="Loading service refunds">
          <Skeleton />
          <Skeleton />
        </div>
      )}
      {refunds.isError && (
        <ErrorState title="Refund history unavailable" onRetry={refunds.refetch} />
      )}
      {refunds.data?.length === 0 && <p>No service refunds yet.</p>}
      {(refunds.data ?? []).map((refund) => (
        <section key={refund.id} aria-label={'Refund ' + refund.reference}>
          <h3>
            {refund.purchaseNumber} · {refund.status.replaceAll('_', ' ')}
          </h3>
          <p>
            {formatDate(refund.requestedAt)} · {refund.reference}
          </p>
          <FieldList>
            <Field label="Cash repaid" value={'₱' + refund.cashRepaid} />
            <Field label="Cash outstanding" value={'₱' + refund.cashOutstanding} />
            <Field label="Points restored" value={refund.pointsRestored.toLocaleString('en-PH')} />
            <Field
              label="Earned points adjusted"
              value={refund.earnedPointsAdjusted.toLocaleString('en-PH')}
            />
          </FieldList>
        </section>
      ))}
      {refunds.data && refunds.data.length > 0 && (
        <p>
          Showing the latest {refunds.data.length} service refunds. Approval and cash repayment are
          separate.
        </p>
      )}
    </Card>
  );
}
