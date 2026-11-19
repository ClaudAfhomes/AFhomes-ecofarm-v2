import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, DetailCard, DetailCardTitle, ErrorState, Skeleton } from '@afhomes/ui';
import { getStaffSalesInvolvement } from './services';
import { formatDateTime } from '../../lib/format';

export function StaffSalesInvolvement({ staffId }: { staffId: string }) {
  const [offset, setOffset] = useState(0);
  const history = useQuery({
    queryKey: ['afhomes', 'staff', staffId, 'sales-involvement', offset],
    queryFn: () => getStaffSalesInvolvement(staffId, offset),
  });
  return (
    <DetailCard>
      <DetailCardTitle>Sales involvement</DetailCardTitle>
      <p>
        Recorded participation in purchases and sales. Imported payment claims still require
        verification.
      </p>
      {history.isPending ? (
        <Skeleton style={{ height: 80 }} />
      ) : history.isError ? (
        <ErrorState onRetry={() => void history.refetch()} />
      ) : (
        <>
          {history.data.length === 0 ? (
            <p>No recorded involvement on this page.</p>
          ) : (
            <ul>
              {history.data.map((item) => (
                <li key={item.id}>
                  <Link to={`/admin/customers/${item.customerId}`}>{item.customerName}</Link>
                  <p>
                    {item.customerNumber} · {item.tier} · {item.reference}
                  </p>
                  <p>
                    {item.roles.map((role) => role.replaceAll('_', ' ')).join(', ')} ·{' '}
                    {item.status.replaceAll('_', ' ')} · {formatDateTime(item.createdAt)}
                  </p>
                </li>
              ))}
            </ul>
          )}
          <Button
            variant="secondary"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - 25))}
          >
            Previous
          </Button>
          <Button
            variant="secondary"
            disabled={history.data.length < 25}
            onClick={() => setOffset(offset + 25)}
          >
            Next
          </Button>
        </>
      )}
    </DetailCard>
  );
}
