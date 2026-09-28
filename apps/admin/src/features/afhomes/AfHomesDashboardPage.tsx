import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import type {
  AfHomesModuleKey,
  AfHomesPermission,
  AnalyticsOverview,
  AnalyticsPeriod,
} from '@jad/contracts';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@jad/ui';
import { canViewModule } from '../../app/navigation';
import { useSession } from '../../lib/session';
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
  { to: '/admin/sales', label: 'Card sales', module: 'sales.card_sales' },
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

function MetricCards({ values }: { values: Metric[] }) {
  if (!values.length)
    return (
      <EmptyState
        title="No dashboard activity"
        description="Your permitted operational areas have no activity to summarize yet."
      />
    );
  return (
    <div className={styles.metrics}>
      {values.map(([label, value]) => (
        <article className={styles.metric} key={label}>
          <small>{label}</small>
          <strong>{value}</strong>
        </article>
      ))}
    </div>
  );
}

function Trend({ data }: { data: AnalyticsOverview }) {
  if (!data.trends.length)
    return (
      <EmptyState
        title="No activity in this period"
        description="This chart will populate from real activity inside your authorized scope."
      />
    );
  const maximum = Math.max(
    1,
    ...data.trends.map((point) => point.sales + point.activations + point.redemptions),
  );
  return (
    <div className={styles.chart} role="img" aria-label="Authorized operational activity chart">
      {data.trends.map((point) => {
        const total = point.sales + point.activations + point.redemptions;
        return (
          <div
            className={styles.barColumn}
            key={point.period}
            title={`${point.period}: ${point.sales} sales, ${point.activations} activations, ${point.redemptions} redemptions`}
          >
            <div
              className={styles.bar}
              style={{ height: `${Math.max(4, (total / maximum) * 140)}px` }}
            />
            <small>{point.period}</small>
          </div>
        );
      })}
    </div>
  );
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
            <Link key={action.to} to={action.to}>
              {action.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {query.isPending ? (
        <div className={styles.metrics} role="status" aria-label="Loading dashboard">
          {Array.from({ length: 6 }, (_, index) => (
            <Skeleton key={index} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
          <p className={styles.scope}>
            Scope: {query.data.scope.kind} · {new Date(query.data.window.from).toLocaleDateString()}
            –{new Date(query.data.window.to).toLocaleDateString()}
          </p>
          <MetricCards values={dashboardMetrics(query.data)} />
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
            <section>
              <h2>Current team</h2>
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
            <section>
              <h2>Commission status</h2>
              <MetricCards
                values={Object.entries(query.data.commissions).map(([status, count]) => [
                  status.replaceAll('_', ' '),
                  count,
                ])}
              />
            </section>
          ) : null}
          {query.data.scope.kind !== 'organization' ? (
            <section>
              <h2>Activity trend</h2>
              <Trend data={query.data} />
            </section>
          ) : null}
          {query.data.salesByPlan.length ? (
            <section>
              <h2>Sales by card plan</h2>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Plan</th>
                      <th>Sales</th>
                      <th>Frozen value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {query.data.salesByPlan.map((plan) => (
                      <tr key={plan.planId}>
                        <td>{plan.planName}</td>
                        <td>{plan.count}</td>
                        <td>₱{plan.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      )}
    </section>
  );
}
