import { useState, useCallback, useMemo } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Button, DateField, ErrorState, Skeleton, StatusChip } from '@afhomes/ui';
import { formatCountOrDash } from '@afhomes/shared';
import { getTeamSalesAnalytics } from '../genealogy/services';
import { humanizeCode } from '../business/format';
import { teamSalesKeys } from '../business/queryKeys';
import { useSession } from '../../lib/session';
import styles from '../genealogy/GenealogyDetailsPage.module.css';

export function TeamSalesActivity() {
  const { user } = useSession();
  const staffId = user?.id ?? '';
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  // Quick presets
  const presets = [
    { label: 'Today', days: 0 },
    { label: 'Past 7 Days', days: 7 },
    { label: 'Past 28 Days', days: 28 },
    { label: 'Past 6 Months', days: 180 },
  ] as const;

  // Compute today's date once per render cycle
  const today = useMemo(() => new Date(), []);
  const todayStr = today.toISOString().slice(0, 10);

  const applyPreset = useCallback((days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(to.getDate() - days);
    setDateTo(to.toISOString().slice(0, 10));
    setDateFrom(from.toISOString().slice(0, 10));
  }, []);

  const isPresetActive = useCallback(
    (days: number) => {
      const expectedFrom = new Date();
      expectedFrom.setDate(today.getDate() - days);
      return dateFrom === expectedFrom.toISOString().slice(0, 10) && dateTo === todayStr;
    },
    [dateFrom, dateTo, today, todayStr],
  );

  const salesQuery = useQuery({
    queryKey: teamSalesKeys.analytics(staffId, 'month', dateFrom, dateTo),
    queryFn: () => getTeamSalesAnalytics(staffId, 'month', dateFrom, dateTo),
    placeholderData: keepPreviousData,
    enabled: !!user,
  });
  return (
    <section className={styles.panel} aria-label="Team sales activity">
      <div className={styles.filterSection}>
        <h2 className={styles.panelTitle}>Team Sales Activity</h2>

        {/* Quick presets */}
        <div className={styles.presetButtons} role="group" aria-label="Quick date presets">
          {presets.map((p) => (
            <Button
              key={p.label}
              variant="ghost"
              size="sm"
              onClick={() => applyPreset(p.days)}
              className={isPresetActive(p.days) ? styles.presetActive : ''}
            >
              {p.label}
            </Button>
          ))}
        </div>

        {/* Custom date range */}
        <div className={styles.dateRangeInputs}>
          <div className={styles.dateInputGroup}>
            <DateField
              id="date-from"
              name="date-from"
              label="Start Date"
              value={dateFrom}
              onChange={setDateFrom}
              max={dateTo || todayStr}
              hint="Optional — defaults to period start"
              optional
            />
          </div>
          <div className={styles.dateInputGroup}>
            <DateField
              id="date-to"
              name="date-to"
              label="End Date"
              value={dateTo}
              onChange={setDateTo}
              min={dateFrom || undefined}
              max={todayStr}
              hint="Optional — defaults to today"
              optional
            />
          </div>
        </div>

        {/* Validation message */}
        {dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo) && (
          <div className={styles.validationError} role="alert">
            End date must be on or after start date
          </div>
        )}
      </div>

      {salesQuery.isPending ? (
        <div className={styles.salesLoading}>
          <Skeleton style={{ height: 120 }} />
          <Skeleton style={{ height: 200 }} />
        </div>
      ) : salesQuery.isError ? (
        <ErrorState
          error={salesQuery.error}
          title="Sales activity could not be loaded"
          onRetry={() => void salesQuery.refetch()}
        />
      ) : (
        <>
          <div className={styles.kpiGrid}>
            <article className={styles.kpiCard}>
              <dt>Total Sales</dt>
              <dd>{formatCountOrDash(salesQuery.data.kpis.totalTeamSales)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <dt>Members With Sales</dt>
              <dd>{formatCountOrDash(salesQuery.data.kpis.membersWithSales)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <dt>No Sales</dt>
              <dd>{formatCountOrDash(salesQuery.data.kpis.membersNoSales)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <dt>Top Seller</dt>
              <dd>{formatCountOrDash(salesQuery.data.kpis.topSellerCount)}</dd>
            </article>
            <article className={styles.kpiCard}>
              <dt>Participation</dt>
              <dd>{salesQuery.data.kpis.participationRate.toFixed(1)}%</dd>
            </article>
          </div>

          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th style={{ textAlign: 'right' }}>Sales</th>
                  <th>Activity</th>
                </tr>
              </thead>
              <tbody>
                {[...salesQuery.data.members]
                  .sort((a, b) => b.salesCount - a.salesCount)
                  .map((member) => (
                    <tr key={member.staffId}>
                      <td>
                        <span className={styles.memberName}>
                          {member.fullName}
                          {member.staffId === user?.id && (
                            <span className={styles.youBadge}>(You)</span>
                          )}
                        </span>
                      </td>
                      <td>
                        <StatusChip label={humanizeCode(member.role)} tone="neutral" />
                      </td>
                      <td style={{ textAlign: 'right' }}>{formatCountOrDash(member.salesCount)}</td>
                      <td>
                        <StatusChip
                          label={member.salesActivity}
                          tone={
                            member.salesActivity === 'Top Seller'
                              ? 'success'
                              : member.salesActivity === 'With Sales'
                                ? 'info'
                                : member.salesActivity === 'Low Sales'
                                  ? 'warning'
                                  : 'neutral'
                          }
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <p className={styles.reportPeriod}>
            {dateFrom || dateTo
              ? `Custom range: ${dateFrom || 'start'} to ${dateTo || 'today'} (UTC)`
              : `Reporting period: ${salesQuery.data.window.from.slice(0, 10)} to ${salesQuery.data.window.to.slice(0, 10)} (UTC)`}
          </p>
        </>
      )}
    </section>
  );
}
