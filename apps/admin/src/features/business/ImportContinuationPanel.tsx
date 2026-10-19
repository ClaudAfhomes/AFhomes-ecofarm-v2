import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Button, DetailCard, DetailCardTitle, ErrorState } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { getImportContinuations } from './import-workflow-services';
import type { CustomerImportContinuation } from '@afhomes/contracts';

export function ImportContinuationPanel({ customerId }: { customerId?: string }) {
  const [offset, setOffset] = useState(0);
  const { user } = useSession();
  const allowed =
    user?.roleSlug === 'super_admin' ||
    ['governance.customer_import', 'sales.customers'].every((moduleKey) =>
      user?.afHomesPermissions.some((p) => p.moduleKey === moduleKey && p.canView),
    );
  const grant = (moduleKey: string, action: 'canView' | 'canCreate' | 'canUpdate') =>
    user?.roleSlug === 'super_admin' ||
    user?.afHomesPermissions.some((p) => p.moduleKey === moduleKey && p[action]);
  const canOpen = (source: CustomerImportContinuation) => {
    if (source.stage === 'review' || source.stage === 'complete') return true;
    if (source.stage === 'application')
      return (
        Boolean(source.applicationId) ||
        (grant('sales.customers', 'canCreate') && grant('governance.customer_import', 'canUpdate'))
      );
    if (source.stage === 'reservation') return grant('sales.card_sales', 'canView');
    return grant(
      source.stage === 'activation' ? 'finance.card_activation' : 'finance.payment_verification',
      'canView',
    );
  };
  const query = useQuery({
    queryKey: ['customer-import-continuations', customerId, offset],
    queryFn: () => getImportContinuations(customerId, offset),
    enabled: allowed,
  });
  if (!allowed || (offset === 0 && !query.isPending && !query.error && !query.data?.length))
    return null;
  return (
    <DetailCard>
      <DetailCardTitle>Imported purchases</DetailCardTitle>
      {query.isPending ? <p>Loading continuation…</p> : null}
      {query.error ? (
        <ErrorState
          title="Could not load imported purchases"
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {query.data?.map((source) => (
        <div key={source.rowId}>
          <h3>
            {source.customerName || 'Imported customer'} ·{' '}
            {source.purchaseReference || 'Purchase reference needs review'}
          </h3>
          {source.purchaseStatement ? (
            <p>
              Workbook claim: {source.purchaseStatement.tier || 'Plan not stated'} · Contract total{' '}
              {source.purchaseStatement.total || 'not stated'} · Included reservation fee{' '}
              {source.purchaseStatement.reservationFee || 'not stated'}.
            </p>
          ) : null}
          <p>
            Next stage: {source.stage}. Imported payment claims: {source.claimCount}. Claims require
            Finance review and separate payment verification.
          </p>
          {source.missingRequirements.length ? (
            <ul>
              {source.missingRequirements.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          ) : null}
          {source.conflicts.length ? (
            <ul>
              {source.conflicts.map((item) => (
                <li key={item.field}>
                  {item.field}: {item.message}
                </li>
              ))}
            </ul>
          ) : null}
          {source.nextAction && canOpen(source) ? (
            <Link to={source.nextAction.path}>{source.nextAction.label}</Link>
          ) : null}
        </div>
      ))}
      {offset > 0 ? (
        <Button variant="secondary" onClick={() => setOffset((n) => Math.max(0, n - 25))}>
          Previous imported purchases
        </Button>
      ) : null}
      {query.data?.length === 25 ? (
        <Button variant="secondary" onClick={() => setOffset((n) => n + 25)}>
          More imported purchases
        </Button>
      ) : null}
    </DetailCard>
  );
}
