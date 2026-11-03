import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { staffSaleInvolvementSchema } from '@afhomes/contracts';
import { SalesParticipationList } from '@afhomes/ui';
import { requestList } from '../../lib/api/client';
import { useCustomerSession } from '../../lib/customer-session';
import { isMongoAuth } from '../../lib/cookie-auth';

export function OstSalesParticipation() {
  const { user } = useCustomerSession(),
    [offset, setOffset] = useState(0);
  const history = useQuery({
    queryKey: ['sales-participation', user?.authUserId, offset],
    queryFn: () =>
      requestList(`/sales-involvement?limit=25&offset=${offset}`, staffSaleInvolvementSchema),
    enabled: isMongoAuth && !!user,
  });
  if (!isMongoAuth) return null;
  return (
    <SalesParticipationList
      records={history.data ?? []}
      loading={history.isPending}
      error={history.isError}
      onRetry={() => void history.refetch()}
      offset={offset}
      onPage={setOffset}
    />
  );
}
