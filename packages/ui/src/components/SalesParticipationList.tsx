import type { StaffSaleInvolvement } from '@afhomes/contracts';
import { DetailCard, DetailCardTitle } from './DetailCard';
import { Button } from './Button';
import { ErrorState } from './ErrorState';
import { Skeleton } from './Skeleton';

export function SalesParticipationList({
  records,
  loading,
  error,
  onRetry,
  offset,
  onPage,
}: {
  records: readonly StaffSaleInvolvement[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  offset: number;
  onPage: (offset: number) => void;
}) {
  return (
    <DetailCard>
      <DetailCardTitle>Recorded sales participation</DetailCardTitle>
      <p>
        Applications and sales that list you as a participant, with your recorded role and current status.
      </p>
      {loading ? (
        <Skeleton style={{ height: 80 }} />
      ) : error ? (
        <ErrorState onRetry={onRetry} />
      ) : (
        <>
          {records.length ? (
            <ul>
              {records.map((item) => (
                <li key={item.id}>
                  <strong>{item.customerName}</strong>
                  <p>
                    {item.reference} · {item.tier}
                  </p>
                  <p>
                    {item.roles.map((role) => role.replaceAll('_', ' ')).join(', ')} ·{' '}
                    {item.status.replaceAll('_', ' ')} ·{' '}
                    {new Date(item.createdAt).toLocaleDateString('en-PH')}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p>No recorded participation on this page.</p>
          )}
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => onPage(Math.max(0, offset - 25))}
          >
            Previous participation
          </Button>
          <Button
            variant="secondary"
            disabled={records.length < 25}
            onClick={() => onPage(offset + 25)}
          >
            Next participation
          </Button>
        </>
      )}
    </DetailCard>
  );
}
