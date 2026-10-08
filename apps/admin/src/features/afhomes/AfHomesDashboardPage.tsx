import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type {
  AfHomesModuleKey,
  AfHomesPermission,
  AnalyticsOverview,
  AnalyticsPeriod,
} from '@afhomes/contracts';
import { paymentSchemeLabel } from '@afhomes/contracts';
import {
  buttonClassName,
  EmptyState,
  ErrorState,
  Icon,
  MetricCard,
  PageHeader,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import type { IconName } from '@afhomes/ui';
import { canViewModule } from '../../app/navigation';
import { useSession } from '../../lib/session';
import { AfHomesQueueCards } from './AfHomesQueueCards';
import { AfHomesTrendChart, TrendChartSkeleton } from './AfHomesTrendChart';
import { getAnalyticsOverview } from './services';
import styles from './AfHomesDashboardPage.module.css';

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;
type Metric = [label: string, value: string | number];
type Action = { to: string; label: string; module: AfHomesModuleKey };
const ACTIONS: Action[] = [
  { to: '/admin/finance/payments', label: 'Payment queue', module: 'finance.payment_verification' },
  { to: '/admin/finance/activation', label: 'Activation queue', module: 'finance.card_activation' },
  { to: '/admin/staff', label: 'Staff records', module: 'organization.staff' },
  { to: '/admin/departments', label: 'Departments', module: 'organization.departments' },
  { to: '/admin/customers', label: 'Customers', module: 'sales.customers' },
  { to: '/admin/genealogy', label: 'Genealogy', module: 'network.genealogy' },
  { to: '/admin/ost/applications', label: 'OST applications', module: 'network.ost_registrations' },
  { to: '/admin/ost/referral-code', label: 'My referral code', module: 'network.referrals' },
  { to: '/admin/redemption', label: 'POS / QR scanner', module: 'operations.redemption' },
  { to: '/admin/redemption/history', label: 'Redemption history', module: 'operations.redemption' },
  { to: '/admin/redemption/items', label: 'Redemption catalog', module: 'operations.catalog' },
];

export const dashboardActions = (permissions?: readonly AfHomesPermission[]) =>
  ACTIONS.filter((action) => canViewModule(permissions, action.module));

export function dashboardMetrics(data: AnalyticsOverview): Metric[] {
  if (data.scope.kind === 'organization' && data.organization)
    return [
      ['Total staff', data.organization.totalStaff],
      ['Active staff', data.organization.activeStaff],
      ['Invited staff', data.organization.invitedStaff],
      ['Inactive staff', data.organization.inactiveStaff],
      ['Suspended staff', data.organization.suspendedStaff],
      ['Active departments', data.organization.activeDepartments],
    ];
  if (data.scope.kind === 'redemption')
    return data.redemptions
      ? [
          ['Redemptions', data.redemptions.count],
          ['Points redeemed', data.redemptions.pointsRedeemed],
        ]
      : [];
  if (data.scope.kind === 'finance')
    return [
      ['Pending payments', data.queues.pendingPaymentVerification],
      ['Verified payments', `₱${data.headline.periodVerifiedPayments}`],
      ['Fully paid sales', data.queues.fullPaidSales],
      ['Activation queue', data.queues.activationReadySales],
      ['Rejected payments', data.queues.rejectedPayments],
      ['Active memberships', data.headline.activatedMemberships],
    ];
  const values: Metric[] = [
    [data.scope.kind === 'self' ? 'My customers' : 'Customers', data.headline.totalCustomers],
    [data.scope.kind === 'self' ? 'My sales' : 'Card sales', data.headline.periodSales],
    ['Frozen sale value', `₱${data.headline.grossFrozenSaleValue}`],
    ['Active memberships', data.headline.activatedMemberships],
  ];
  if (data.scope.kind === 'global') {
    values.splice(1, 0, ['New customers', data.headline.newCustomers]);
    values.push(['Verified payments', `₱${data.headline.periodVerifiedPayments}`]);
  }
  return values;
}

/** Icon + helper text per metric label. Presentation only - values untouched. */
const METRIC_PRESENTATION: Record<string, { icon: IconName; description: string }> = {
  'Total staff': { icon: 'users', description: 'Everyone holding a staff profile' },
  'Active staff': { icon: 'user-check', description: 'Currently able to sign in' },
  'Invited staff': { icon: 'user-plus', description: 'Invited, password not set yet' },
  'Inactive staff': { icon: 'user-x', description: 'Deactivated profiles' },
  'Suspended staff': { icon: 'alert', description: 'Temporarily suspended' },
  'Active departments': { icon: 'grid', description: 'Departments in use' },
  Redemptions: { icon: 'list', description: 'Points redemptions in period' },
  'Points redeemed': { icon: 'wallet', description: 'Total points spent in period' },
  'Pending payments': { icon: 'clock', description: 'Awaiting verification' },
  'Verified payments': { icon: 'dollar-sign', description: 'Verified money in period' },
  'Fully paid sales': { icon: 'check', description: 'Ready for activation review' },
  'Activation queue': { icon: 'user-check', description: 'Fully paid, awaiting activation' },
  'Rejected payments': { icon: 'alert', description: 'Sent back for correction' },
  'Active memberships': { icon: 'users', description: 'Activated membership cards' },
  Customers: { icon: 'users', description: 'Customers in your scope' },
  'My customers': { icon: 'users', description: 'Customers attributed to you' },
  'Card sales': { icon: 'file-text', description: 'Sales in your scope and period' },
  'My sales': { icon: 'file-text', description: 'Sales you recorded in period' },
  'Frozen sale value': { icon: 'wallet', description: 'Frozen commercial record value' },
  'New customers': { icon: 'user-plus', description: 'Registered in this period' },
  'Direct reports': { icon: 'users', description: 'Your first-level team' },
  Descendants: { icon: 'users', description: 'Everyone below you' },
  'Active sellers': { icon: 'user-check', description: 'Sellers able to transact' },
  'Inactive sellers': { icon: 'user-x', description: 'Sellers unable to transact' },
};

function MetricCards({ values }: { values: Metric[] }) {
  if (!values.length)
    return (
      <EmptyState
        title="No dashboard activity"
        description="Your permitted operational areas have no activity to summarize yet."
      />
    );
  return (
    <ul className={styles.queues}>
      {values.map(([label, value]) => {
        const presentation = METRIC_PRESENTATION[label] ?? {
          icon: 'grid' as IconName,
          description: '',
        };
        return (
          <li key={label}>
            <MetricCard
              label={label}
              value={value}
              icon={presentation.icon}
              description={presentation.description || undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}

function MetricCardSkeletons({ count = 6 }: { count?: number }) {
  return (
    <ul className={styles.queues} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <Skeleton className={styles.cardSkeleton} />
        </li>
      ))}
    </ul>
  );
}

function Trend() {
  return <AfHomesTrendChart />;
}

export function AfHomesDashboardPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const { user } = useSession();
  const query = useQuery({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => getAnalyticsOverview(period),
  });
  const actions = dashboardActions(user?.afHomesPermissions);
  return (
    <section>
      <PageHeader
        title={`${user?.roleName ?? 'AF Homes'} Dashboard`}
        description="Live operational facts limited to your effective permissions and data scope"
        actions={
          <Select
            aria-label="Analytics period"
            value={period}
            onChange={(event) => setPeriod(event.target.value as AnalyticsPeriod)}
            options={[...PERIODS]}
          />
        }
      />
      {actions.length ? (
        <nav className={styles.actions} aria-label="Dashboard actions">
          {actions.map((action) => (
            <Link className={buttonClassName('secondary')} key={action.to} to={action.to}>
              {action.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {query.isPending ? (
        <div role="status" aria-label="Loading dashboard">
          <p className={styles.loadingRow} aria-live="polite" aria-busy="true">
            Loading dashboard…
          </p>
          <MetricCardSkeletons />
          <TrendChartSkeleton />
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          <p className={styles.scope}>
            Scope: {query.data.scope.kind} · {new Date(query.data.window.from).toLocaleDateString()}
            –{new Date(query.data.window.to).toLocaleDateString()}
          </p>
          <MetricCards values={dashboardMetrics(query.data)} />
          {query.data.scope.kind === 'organization' ? (
            <h2 className={styles.sectionTitle}>Sales Overview</h2>
          ) : null}
          {query.data.scope.kind !== 'organization' ? <Trend /> : null}
          {query.data.salesByScheme.length ? (
            <section aria-label="Sales by payment scheme">
              <h2 className={styles.sectionTitle}>Sales by payment scheme</h2>
              <MetricCards
                values={query.data.salesByScheme.map((entry) => [
                  paymentSchemeLabel(entry.scheme),
                  `${entry.count} sale${entry.count === 1 ? '' : 's'} · ₱${entry.value}`,
                ])}
              />
            </section>
          ) : null}
          {query.data.salesByPlan.length ? (
            <section className={styles.chartCard} aria-label="Sales by card plan">
              <div className={styles.cardHead}>
                <span className={styles.cardIcon} aria-hidden="true">
                  <Icon name="file-text" size={18} />
                </span>
                <h2 className={styles.cardTitle}>Sales by card plan</h2>
              </div>
              <div className={`table-scroll ${styles.tableWrap}`}>
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Plan</TableHeaderCell>
                      <TableHeaderCell align="right">Sales</TableHeaderCell>
                      <TableHeaderCell align="right">Frozen value</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {query.data.salesByPlan.map((plan) => (
                      <TableRow key={plan.planId}>
                        <TableCell label="Plan">{plan.planName}</TableCell>
                        <TableCell label="Sales" align="right">
                          {plan.count}
                        </TableCell>
                        <TableCell label="Frozen value" align="right">
                          ₱{plan.value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          ) : null}
          <AfHomesQueueCards />

          {query.data.networkContext?.upperline ? (
            <aside className={styles.notice}>
              <strong>Current upperline:</strong> {query.data.networkContext.upperline.name} ·{' '}
              {query.data.networkContext.upperline.role}
            </aside>
          ) : null}
          {query.data.scope.unattributedLegacySaleCount > 0 ? (
            <aside className={styles.notice}>
              <strong>Historical sales awaiting attribution:</strong>{' '}
              {query.data.scope.unattributedLegacySaleCount} sale(s), ₱
              {query.data.scope.unattributedLegacySaleValue}. They are excluded from team totals.
            </aside>
          ) : null}
          {query.data.sellers ? (
            <section aria-label="Current team">
              <h2 className={styles.sectionTitle}>Current team</h2>
              <MetricCards
                values={[
                  ['Direct reports', query.data.sellers.directCount],
                  ['Descendants', query.data.sellers.descendantCount],
                  ['Active sellers', query.data.sellers.active],
                  ['Inactive sellers', query.data.sellers.inactive],
                ]}
              />
            </section>
          ) : null}
          {query.data.commissions ? (
            <section aria-label="Commission status">
              <h2 className={styles.sectionTitle}>Commission status</h2>
              <MetricCards
                values={Object.entries(query.data.commissions).map(([status, count]) => [
                  status.replaceAll('_', ' '),
                  count,
                ])}
              />
            </section>
          ) : null}
          <p className={styles.timeframe}>As of today</p>
        </>
      )}
    </section>
  );
}
