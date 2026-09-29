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
import { addMoney, formatMoney } from '@jad/shared';
import type { AnalyticsOverview } from '@jad/contracts';
import { EmptyState, Icon, Spinner } from '@jad/ui';

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

/**
 * Axis abbreviation - display geometry only; money math stays string-based.
 * Same treatment as the JAD SalesTrendChart axis.
 */
function abbreviateMoney(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `₱${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `₱${Math.round(value / 1_000)}K`;
  return `₱${value}`;
}

/**
 * Trend bucket label. The server buckets by the selected analytics period:
 * hourly (`2026-09-15T09:00`), daily (`2026-09-15`), or monthly (`2026-09`).
 */
export function trendLabel(period: string): string {
  const hourly = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})/.exec(period);
  if (hourly) return `${hourly[4]}:00`;
  const monthly = /^(\d{4})-(\d{2})$/.exec(period);
  if (monthly) {
    return `${MONTH_LABELS[Number(monthly[2]) - 1] ?? monthly[2]} '${monthly[1]!.slice(2)}`;
  }
  const daily = /^(\d{4})-(\d{2})-(\d{2})/.exec(period);
  if (daily) {
    return `${MONTH_LABELS[Number(daily[2]) - 1] ?? daily[2]} ${Number(daily[3])}`;
  }
  return period;
}

type Metric = 'saleValue' | 'verified' | 'count';

const METRIC_LABEL: Record<Metric, string> = {
  saleValue: 'Sale value (₱)',
  verified: 'Verified (₱)',
  count: 'Count',
};

/**
 * Activity trend: JAD SalesTrendChart grammar (line + area, KPI strip,
 * segmented metric toggle, tooltip, axes) over AF Homes role-scoped trend
 * buckets. Calculations are untouched - the server owns every figure; only
 * exact-decimal strings are converted to Number for SVG geometry.
 */
export function AfHomesTrendChart({ data }: { data: AnalyticsOverview }) {
  const [metric, setMetric] = useState<Metric>('saleValue');

  if (!data.trends.length) {
    return (
      <EmptyState
        title="No activity in this period"
        description="This chart will populate from real activity inside your authorized scope."
      />
    );
  }

  const series = data.trends.map((point) => ({
    key: point.period,
    label: trendLabel(point.period),
    count: point.sales,
    saleValue: point.saleValue,
    verified: point.verifiedPayments,
    plot:
      metric === 'saleValue'
        ? Number(point.saleValue)
        : metric === 'verified'
          ? Number(point.verifiedPayments)
          : point.sales,
  }));

  const current = data.trends.at(-1);
  const previous = data.trends.at(-2);
  const currentValue =
    metric === 'saleValue'
      ? formatMoney(current?.saleValue ?? '0.00')
      : metric === 'verified'
        ? formatMoney(current?.verifiedPayments ?? '0.00')
        : String(current?.sales ?? 0);
  const previousValue =
    metric === 'saleValue'
      ? formatMoney(previous?.saleValue ?? '0.00')
      : metric === 'verified'
        ? formatMoney(previous?.verifiedPayments ?? '0.00')
        : String(previous?.sales ?? 0);
  let periodSaleValue = '0.00';
  let periodVerified = '0.00';
  let periodCount = 0;
  for (const point of data.trends) {
    periodSaleValue = addMoney(periodSaleValue, point.saleValue);
    periodVerified = addMoney(periodVerified, point.verifiedPayments);
    periodCount += point.sales;
  }
  const kpis = [
    { label: 'Current bucket', value: currentValue },
    { label: 'Previous bucket', value: previousValue },
    {
      label: 'Period total',
      value:
        metric === 'count'
          ? `${periodCount} sales`
          : `${formatMoney(periodSaleValue)} sales · ${formatMoney(periodVerified)} verified`,
    },
  ];

  const isMoney = metric !== 'count';

  return (
    <section className={styles.chartCard} aria-label="Activity trend">
      <div className={styles.cardHead}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name="list" size={18} />
        </span>
        <h2 className={styles.cardTitle}>Activity trend</h2>
        <div className={styles.toggles}>
          <div className={styles.segmented} role="group" aria-label="Chart metric">
            {(Object.keys(METRIC_LABEL) as Metric[]).map((key) => (
              <button
                key={key}
                type="button"
                className={metric === key ? styles.on : ''}
                onClick={() => setMetric(key)}
              >
                {METRIC_LABEL[key]}
              </button>
            ))}
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
        <div className={styles.chartArea}>
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={series} margin={{ top: 8, right: 12, bottom: 0, left: 8 }}>
              <defs>
                <linearGradient id="afhomesTrendFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand-primary)" stopOpacity={0.28} />
                  <stop offset="100%" stopColor="var(--color-brand-primary)" stopOpacity={0.02} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border-subtle)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={{ stroke: 'var(--color-border-default)' }}
                interval="preserveStartEnd"
                minTickGap={24}
              />
              <YAxis
                tickFormatter={(v: number) => (isMoney ? abbreviateMoney(v) : String(v))}
                tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                tickLine={false}
                axisLine={false}
                width={isMoney ? 56 : 32}
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
                    | { payload?: { saleValue?: string; verified?: string; count?: number } }
                    | undefined;
                  if (metric === 'saleValue' && point?.payload?.saleValue !== undefined) {
                    return [formatMoney(point.payload.saleValue), 'Sale value'];
                  }
                  if (metric === 'verified' && point?.payload?.verified !== undefined) {
                    return [formatMoney(point.payload.verified), 'Verified payments'];
                  }
                  return [String(value), 'Sales'];
                }}
              />
              <Area
                type="monotone"
                dataKey="plot"
                stroke="none"
                fill="url(#afhomesTrendFill)"
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
