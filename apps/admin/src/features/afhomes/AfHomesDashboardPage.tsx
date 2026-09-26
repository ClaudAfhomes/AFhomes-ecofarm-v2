import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyState, ErrorState, PageHeader, Select, Skeleton } from '@jad/ui';
import { getAfHomesDashboard } from './services';

export function AfHomesDashboardPage() {
  const [range, setRange] = useState('month');
  const query = useQuery({
    queryKey: ['afhomes', 'dashboard', range],
    queryFn: () => getAfHomesDashboard(range),
  });
  const cards = query.data
    ? [
        ['Verified sales', query.data.totals.verifiedSales],
        ['Verified collections', `₱${query.data.totals.verifiedCollections}`],
        ['Active memberships', query.data.totals.activeMemberships],
        ['Pending accounts', query.data.totals.pendingAccounts],
        ['Overdue accounts', query.data.totals.overdueAccounts],
        ['Pending qualifications', query.data.totals.pendingQualifications],
        ['Earned commissions', `₱${query.data.totals.earnedUnpaidCommissions}`],
        ['Active employees', query.data.totals.activeEmployees],
      ]
    : [];
  return (
    <section>
      <PageHeader
        title="AF Homes Dashboard"
        description="Live operational facts from the AF Homes database"
        actions={
          <Select
            aria-label="Chart period"
            value={range}
            onChange={(e) => setRange(e.target.value)}
            options={[
              { value: 'today', label: 'Today' },
              { value: 'week', label: 'Week' },
              { value: 'month', label: 'Month' },
              { value: 'year', label: 'Year' },
            ]}
          />
        }
      />
      {query.isPending ? (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
            gap: 16,
          }}
        >
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} />
          ))}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : (
        <>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))',
              gap: 16,
            }}
          >
            {cards.map(([label, value]) => (
              <article
                key={String(label)}
                style={{
                  padding: 18,
                  border: '1px solid var(--color-border-default)',
                  borderRadius: 12,
                }}
              >
                <small>{label}</small>
                <strong style={{ display: 'block', fontSize: 28 }}>{value}</strong>
              </article>
            ))}
          </div>
          <h2>Sales and activity trend</h2>
          {query.data?.trend.length === 0 ? (
            <EmptyState
              title="No verified activity in this period"
              description="The chart will populate from verified sales, collections, activations, and redemptions."
            />
          ) : (
            <div role="img" aria-label="Verified sales activity chart">
              {query.data?.trend.map((point) => (
                <p key={point.period}>
                  {point.period}: {point.verifiedSales} verified sales
                </p>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}
