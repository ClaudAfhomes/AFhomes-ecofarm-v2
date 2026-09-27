import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnalyticsOverview, AnalyticsPeriod } from '@jad/contracts';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@jad/ui';
import { getAnalyticsOverview } from './services';
import styles from './AfHomesDashboardPage.module.css';

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;

function MetricCards({ data }: { data: AnalyticsOverview }) {
  const values: [string, string | number][] = [
    ['Customers', data.headline.totalCustomers],
    ['New customers', data.headline.newCustomers],
    ['Card sales', data.headline.periodSales],
    ['Frozen sale value', `₱${data.headline.grossFrozenSaleValue}`],
    ['Verified payments', `₱${data.headline.periodVerifiedPayments}`],
    ['Active memberships', data.headline.activatedMemberships],
  ];
  if (data.redemptions)
    values.push(
      ['Redemptions', data.redemptions.count],
      ['Points redeemed', data.redemptions.pointsRedeemed],
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
  if (data.trends.length === 0)
    return (
      <EmptyState
        title="No activity in this period"
        description="This chart will populate from real sales, verified payments, activations, and completed redemptions."
      />
    );
  const maximum = Math.max(
    1,
    ...data.trends.map((point) => point.sales + point.activations + point.redemptions),
  );
  return (
    <div
      className={styles.chart}
      role="img"
      aria-label="Sales, activation, and redemption activity chart"
    >
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
  const query = useQuery({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => getAnalyticsOverview(period),
  });
  return (
    <section>
      <PageHeader
        title="AF Homes Dashboard"
        description="Role-scoped operational facts from the AF Homes database"
        actions={
          <Select
            aria-label="Analytics period"
            value={period}
            onChange={(event) => setPeriod(event.target.value as AnalyticsPeriod)}
            options={[...PERIODS]}
          />
        }
      />
      {query.isPending ? (
        <div className={styles.metrics}>
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
          <MetricCards data={query.data} />
          {query.data.scope.unattributedLegacySaleCount > 0 ? (
            <aside className={styles.notice}>
              <strong>Historical sales awaiting attribution:</strong>{' '}
              {query.data.scope.unattributedLegacySaleCount} sale(s), ₱
              {query.data.scope.unattributedLegacySaleValue}. They are excluded from team totals.
            </aside>
          ) : null}
          <h2>Activity trend</h2>
          <Trend data={query.data} />
          {query.data.sellers ? (
            <section>
              <h2>Current team</h2>
              <div className={styles.metrics}>
                <article className={styles.metric}>
                  <small>Direct reports</small>
                  <strong>{query.data.sellers.directCount}</strong>
                </article>
                <article className={styles.metric}>
                  <small>Descendants</small>
                  <strong>{query.data.sellers.descendantCount}</strong>
                </article>
                <article className={styles.metric}>
                  <small>Active sellers</small>
                  <strong>{query.data.sellers.active}</strong>
                </article>
                <article className={styles.metric}>
                  <small>Inactive sellers</small>
                  <strong>{query.data.sellers.inactive}</strong>
                </article>
              </div>
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
