import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import { ErrorState, PageHeader, StatusChip, Tabs, type TabItem } from '@afhomes/ui';
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
  const mayManage =
    user?.afHomesPermissions.some(
      (permission) => permission.moduleKey === 'network.commissions' && permission.canUpdate,
    ) === true;

  // One-row roster: positions and headline counts for the whole page.
  const overview = useQuery({
    queryKey: sharedScopes.commissionRosterPage({ overview: true }),
    queryFn: () => getCommissionRoster({ limit: 1 }),
    enabled: mayManage,
    placeholderData: keepPreviousData,
  });

  if (!mayManage)
    return (
      <section className={styles.page}>
        <PageHeader title="Commission Settings" description="Set rates by position or person." />
        <p role="alert">You do not have permission to manage commission rules.</p>
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
      <PageHeader title="Commission Settings" description="Set rates by position or person." />

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
                label={needsRate > 0 ? `Need a rate: ${formatCountOrDash(needsRate)}` : 'All sellers have rates'}
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
              ['sellers', <CommissionSellersTab key="sellers" positions={positions} />],
              ['positions', <CommissionPositionRates key="positions" positions={positions} />],
              ['rules', <CommissionRulesTab key="rules" />],
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
