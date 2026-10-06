import { useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addMoney, formatMoney } from '@afhomes/shared';
import type { SalesTrendGranularity } from '@afhomes/contracts';
import { EmptyState, ErrorState, Icon, Spinner } from '@afhomes/ui';

import { useAfHomesSalesTrend } from './useAfHomesSalesTrend';
import styles from './AfHomesDashboardPage.module.css';

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

/** `2026-09` -> "Sep '26"; `2026` -> "2026". AF Homes `periodLabel` grammar. */
export function periodLabel(key: string): string {
  if (key.length === 4) return key;
  const year = key.slice(0, 4);
  const month = Number(key.slice(5, 7));
  return `${MONTH_LABELS[month - 1] ?? key} '${year.slice(2)}`;
}

/**
 * Axis abbreviation - display geometry only; money math stays string-based.
 * Same treatment as the AF Homes sales-trend axis.
 */
function abbreviateMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `₱${Math.round(value / 1_000)}K`;
  return `₱${value}`;
}

type Metric = 'value' | 'count';

interface Kpi {
  label: string;
  value: string;
}

/**
 * Sales Overview: AF Homes sales-trend behavior over AF Homes qualifying card
 * sales (status `active` - fully paid and activated). Only qualifying sales
 * feed the series; pipeline and cancelled sales are not recognized sales. The
 * exact-decimal totals are only converted to Number for SVG geometry.
 *
 * Owns its Monthly/Yearly granularity and its loading/error states - it never
 * reads the page-level Day/Week/Month/Year analytics selector.
 */
export function AfHomesTrendChart() {
  const [granularity, setGranularity] = useState<SalesTrendGranularity>('month');
  const [metric, setMetric] = useState<Metric>('value');
  const { data, isPending, isError, error, refetch } = useAfHomesSalesTrend(granularity);

  const points = data?.periods ?? [];
  const series = points.map((period) => ({
    key: period.key,
    label: periodLabel(period.key),
    count: period.count,
    total: period.total,
    plot: metric === 'value' ? Number(period.total) : period.count,
  }));

  const yearPrefix = String(new Date().getUTCFullYear());
  const yearPeriods = points.filter((p) => p.key.startsWith(yearPrefix));
  let totalThisYear = '0.00';
  for (const period of yearPeriods) totalThisYear = addMoney(totalThisYear, period.total);
  const countThisYear = yearPeriods.reduce((sum, period) => sum + period.count, 0);

  const current = points.at(-1);
  const previous = points.at(-2);
  const kpis: Kpi[] = [
    {
      label: granularity === 'month' ? 'Value this month' : `Value in ${yearPrefix}`,
      value: current ? formatMoney(current.total) : formatMoney('0.00'),
    },
    {
      label: 'Previous period',
      value: previous ? formatMoney(previous.total) : formatMoney('0.00'),
    },
    {
      label: 'Qualifying sales this year',
      value: `${countThisYear} · ${formatMoney(totalThisYear)}`,
    },
  ];

  const hasData = points.some((period) => period.count > 0);

  return (
    <section className={styles.chartCard} aria-label="Sales overview">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name="list" size={18} />
        </span>
        <h2 className={styles.cardTitle}>Sales Overview</h2>
        <div className={styles.toggles}>
          <div className={styles.segmented} role="group" aria-label="Chart metric">
            <button
              type="button"
              aria-pressed={metric === 'value'}
              className={metric === 'value' ? styles.on : ''}
              onClick={() => setMetric('value')}
            >
              Value (₱)
            </button>
            <button
              type="button"
              aria-pressed={metric === 'count'}
              className={metric === 'count' ? styles.on : ''}
              onClick={() => setMetric('count')}
            >
              Count
            </button>
          </div>
          <div className={styles.segmented} aria-label="Chart granularity">
            <button
              type="button"
              aria-pressed={granularity === 'month'}
              className={granularity === 'month' ? styles.on : ''}
              onClick={() => setGranularity('month')}
            >
              Monthly
            </button>
            <button
              type="button"
              aria-pressed={granularity === 'year'}
              className={granularity === 'year' ? styles.on : ''}
              onClick={() => setGranularity('year')}
            >
              Yearly
            </button>
          </div>
        </div>
      </div>

      <div className={styles.kpis}>
        {kpis.map((kpi) => (
          <div key={kpi.label} className={styles.kpi}>
            <span className={styles.kpiValue}>{kpi.value}</span>
            <span className={styles.kpiLabel}>{kpi.label}</span>
          </div>
        ))}
      </div>

      <div className={styles.chartBox}>
        {isPending ? (
          <div className={styles.chartState} role="status" aria-live="polite" aria-busy="true">
            <Spinner size="sm" /> Loading trend…
          </div>
        ) : isError ? (
          <div className={styles.chartState}>
            <ErrorState error={error} onRetry={() => void refetch()} />
          </div>
        ) : !hasData ? (
          <EmptyState
            title="No qualifying sales yet"
            description="Qualifying sales will appear here once sales in your authorized scope are fully paid and activated."
          />
        ) : (
          <div className={styles.chartArea}>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="afhomesSalesTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-primary)" stopOpacity={0.28} />
                    <stop offset="100%" stopColor="var(--color-brand-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--color-border-subtle)"
                />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-border-default)' }}
                  interval="preserveStartEnd"
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    metric === 'value' ? abbreviateMoney(v) : String(v)
                  }
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  width={metric === 'value' ? 56 : 32}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--color-border-strong)' }}
                  contentStyle={{
                    borderRadius: 'var(--radius-sm)',
                    border: '1px solid var(--color-border-default)',
                    fontSize: 12,
                  }}
                  labelFormatter={(label) => String(label)}
                  formatter={(value, _name, item) => {
                    const point = item as
                      { payload?: { total?: string; count?: number } } | undefined;
                    if (point?.payload?.total !== undefined) {
                      return [formatMoney(point.payload.total), 'Sales value'];
                    }
                    return [String(value), 'Sales'];
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="plot"
                  stroke="none"
                  fill="url(#afhomesSalesTrendFill)"
                  activeDot={false}
                />
                <Line
                  type="monotone"
                  dataKey="plot"
                  stroke="var(--color-brand-primary)"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 4, fill: 'var(--color-brand-primary)' }}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </section>
  );
}

export function TrendChartSkeleton() {
  return (
    <div className={styles.chartCard}>
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name="list" size={18} />
        </span>
      </div>
      <div className={styles.chartBox}>
        <div className={styles.chartState} role="status" aria-live="polite" aria-busy="true">
          <Spinner size="sm" /> Loading trend…
        </div>
      </div>
    </div>
  );
}
