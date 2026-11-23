import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  EmptyState,
  ErrorState,
  PageHeader,
  StatusChip,
  Tabs,
  buttonClassName,
  type TabItem,
} from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';

import { useSession } from '../../lib/session';
import { CommissionPageSkeleton } from './CommissionSkeletons';
import { CommissionPositionRates } from './CommissionPositionRates';
import { CommissionRulesTab } from './CommissionRulesTab';
import { CommissionSellersTab } from './CommissionSellersTab';
import { sharedScopes } from './queryKeys';
import { getCommissionRoster } from './services';
import styles from './CommissionSettingsPage.module.css';

const TABS: TabItem[] = [
  { value: 'sellers', label: 'Sellers' },
  { value: 'positions', label: 'Position rates' },
  { value: 'rules', label: 'All rules' },
];
const TAB_BASE = 'commission-tabs';

export function CommissionSettingsPage() {
  const { user } = useSession();
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab = TABS.some((item) => item.value === requested) ? requested! : 'sellers';
  const permissions = user?.afHomesPermissions ?? [];
  const holds = (key: string, action: 'canView' | 'canUpdate') =>
    permissions.some((permission) => permission.moduleKey === key && permission[action]);
  const mayManage = holds('network.commissions', 'canUpdate');
  // Mirrors the server's rate-read rule: everyone who sees EVERY commission
  // (Finance, card activation, managers) may read rates; scoped sellers may not.
  const mayRead =
    mayManage ||
    (holds('network.commissions', 'canView') &&
      (holds('finance.payment_verification', 'canView') ||
        holds('finance.card_activation', 'canView')));
  const readOnly = !mayManage;

  // One-row roster: positions and headline counts for the whole page.
  const overview = useQuery({
    queryKey: sharedScopes.commissionRosterPage({ overview: true }),
    queryFn: () => getCommissionRoster({ limit: 1 }),
    enabled: mayRead,
    placeholderData: keepPreviousData,
  });

  if (!mayRead)
    return (
      <section className={styles.page}>
        <PageHeader title="Commission Settings" description="Set rates by position or person." />
        {/* View opens this route; reading rates needs a see-all commission grant (server-enforced). */}
        <div role="alert">
          <EmptyState
            title="Rates are managed by commission administrators"
            description="Your role can view commissions but cannot see or change commission rates. Ask a Super Admin if you need this access."
            action={
              <Link to="/admin/finance/commissions" className={buttonClassName('secondary', 'sm')}>
                View commissions
              </Link>
            }
          />
        </div>
      </section>
    );

  // First load skeletonizes the whole page. Later refetches keep data on screen.
  if (overview.isPending)
    return (
      <section className={styles.page}>
        <CommissionPageSkeleton />
      </section>
    );

  const needsRate = overview.data?.needsRateCount ?? 0;
  const positions = overview.data?.positions ?? [];

  return (
    <section className={styles.page}>
      <PageHeader
        title="Commission Settings"
        description={
          readOnly
            ? 'Current rates by position and person (read-only).'
            : 'Set rates by position or person.'
        }
      />
      {readOnly ? (
        <Alert variant="info" title="Read-only">
          You can review rates. Changing them needs commission update access.
        </Alert>
      ) : null}

      {overview.isError ? (
        <ErrorState error={overview.error} onRetry={overview.refetch} />
      ) : (
        <>
          <ul className={styles.badges} aria-label="Commission summary">
            <li>
              <StatusChip
                label={`Sellers: ${formatCountOrDash(overview.data?.total ?? 0)}`}
                tone="neutral"
                icon="users"
              />
            </li>
            <li>
              <StatusChip
                label={
                  needsRate > 0
                    ? `Need a rate: ${formatCountOrDash(needsRate)}`
                    : 'All sellers have rates'
                }
                tone={needsRate > 0 ? 'warning' : 'success'}
                icon={needsRate > 0 ? 'alert' : 'check'}
              />
            </li>
          </ul>

          <details className={styles.howItWorks}>
            <summary>How rates work</summary>
            <ul className={styles.ruleFacts}>
              <li>Rules apply to future sales only.</li>
              <li>Personal rates override position rates.</li>
              <li>Rates never stack.</li>
              <li>No rate means 0%.</li>
              <li>Past commissions keep their frozen rate.</li>
            </ul>
          </details>

          <Tabs
            items={TABS}
            value={tab}
            baseId={TAB_BASE}
            ariaLabel="Commission settings sections"
            onChange={(next) =>
              setParams(
                (current) => {
                  const updated = new URLSearchParams(current);
                  if (next === 'sellers') updated.delete('tab');
                  else updated.set('tab', next);
                  return updated;
                },
                { replace: true },
              )
            }
          />
          {/* Inactive panels stay mounted but hidden, so selections and filters survive a tab switch. */}
          {(
            [
              [
                'sellers',
                <CommissionSellersTab key="sellers" positions={positions} readOnly={readOnly} />,
              ],
              [
                'positions',
                <CommissionPositionRates
                  key="positions"
                  positions={positions}
                  readOnly={readOnly}
                />,
              ],
              ['rules', <CommissionRulesTab key="rules" readOnly={readOnly} />],
            ] as const
          ).map(([value, content]) => (
            <div
              key={value}
              role="tabpanel"
              id={`${TAB_BASE}-${value}-panel`}
              aria-labelledby={`${TAB_BASE}-${value}-tab`}
              hidden={tab !== value}
            >
              {content}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
