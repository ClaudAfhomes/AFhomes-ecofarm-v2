import { useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
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

interface PlotPoint {
  key: string;
  label: string;
  count: number;
  total: string;
  /** Numeric geometry for the active metric; `null` breaks the line (axis padding only). */
  plot: number | null;
  /** True for synthetic past/future axis padding — never a server fact. */
  isProjection: boolean;
}

/** `2026-09` -> next `2026-10`; rolls the year over December. Presentation only. */
function nextMonthKey(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() + 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function prevMonthKey(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const d = new Date(Date.UTC(year, month - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/**
 * Center the latest real point on the axis.
 *
 * A time series naturally pins its newest point to the right edge. The
 * dashboard instead keeps the latest reading in the middle of the chart by
 * extending the domain with synthetic, non-plotted axis slots:
 * - 2+ real points: append `n - 1` future slots, so the latest real index
 *   `(n - 1)` sits at the middle of `(2n - 1)` slots.
 * - 1 real point: sandwich it with one past + one future slot.
 *
 * Placeholders carry `plot: null` so the line/area stop at the latest real
 * reading — the shaded "upcoming" zone is breathing room, never fake data.
 * KPIs, totals and the API payload are untouched; this only affects SVG geometry.
 */
export function buildCenteredSeries(
  points: { key: string; count: number; total: string }[],
  metric: Metric,
  granularity: SalesTrendGranularity,
): { display: PlotPoint[]; latestIndex: number } {
  const real: PlotPoint[] = points.map((period) => ({
    key: period.key,
    label: periodLabel(period.key),
    count: period.count,
    total: period.total,
    plot: metric === 'value' ? Number(period.total) : period.count,
    isProjection: false,
  }));
  if (real.length === 0) return { display: [], latestIndex: -1 };
  if (real.length === 1) {
    const only = real[0] as PlotPoint;
    const prevKey =
      granularity === 'month' ? prevMonthKey(only.key) : String(Number(only.key) - 1);
    const nextKey =
      granularity === 'month' ? nextMonthKey(only.key) : String(Number(only.key) + 1);
    return {
      display: [
        {
          key: `pad-prev-${prevKey}`,
          label: periodLabel(prevKey),
          count: 0,
          total: '0.00',
          plot: null,
          isProjection: true,
        },
        only,
        {
          key: `pad-next-${nextKey}`,
          label: periodLabel(nextKey),
          count: 0,
          total: '0.00',
          plot: null,
          isProjection: true,
        },
      ],
      latestIndex: 1,
    };
  }
  const trailing = Math.min(12, real.length - 1);
  const lastKey = (real[real.length - 1] as PlotPoint).key;
  const future: PlotPoint[] = [];
  let cursor = lastKey;
  for (let i = 0; i < trailing; i += 1) {
    cursor = granularity === 'month' ? nextMonthKey(cursor) : String(Number(cursor) + 1);
    future.push({
      key: `pad-next-${cursor}-${i}`,
      label: periodLabel(cursor),
      count: 0,
      total: '0.00',
      plot: null,
      isProjection: true,
    });
  }
  return { display: [...real, ...future], latestIndex: real.length - 1 };
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

  const periods = data?.periods ?? null;
  const points = periods ?? [];
  const { display: series, latestIndex } = useMemo(
    () => buildCenteredSeries(periods ?? [], metric, granularity),
    [periods, metric, granularity],
  );
  const latest = latestIndex >= 0 ? series[latestIndex] : undefined;

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
      <div className={styles.chartHero}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name="list" size={18} />
        </span>
        <div className={styles.chartTitleWrap}>
          <h2 className={styles.cardTitle}>Sales Overview</h2>
          <p className={styles.chartSubtitle}>
            Qualifying activated sales · latest reading pinned to the center
          </p>
        </div>
        {latest ? (
          <span className={styles.latestBadge}>
            <span className={styles.latestDot} aria-hidden="true" />
            Latest · {latest.label}
          </span>
        ) : null}
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
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={series} margin={{ top: 12, right: 16, bottom: 0, left: 8 }}>
                <defs>
                  <linearGradient id="afhomesSalesTrendFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-brand-primary)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--color-brand-primary)" stopOpacity={0.03} />
                  </linearGradient>
                  <linearGradient id="afhomesSalesTrendLine" x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor="var(--color-brand-secondary)" />
                    <stop offset="100%" stopColor="var(--color-brand-primary)" />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="var(--color-border-subtle)"
                />
                <XAxis
                  dataKey="label"
                  tick={(props: unknown) => {
                    const tick = props as {
                      x?: string | number;
                      y?: string | number;
                      payload?: { value?: string; index?: number };
                    };
                    const idx =
                      typeof tick.payload?.index === 'number'
                        ? tick.payload.index
                        : series.findIndex((s) => s.label === tick.payload?.value);
                    const isFuture = idx > latestIndex;
                    const isLatest = idx === latestIndex;
                    return (
                      <text
                        x={Number(tick.x ?? 0)}
                        y={Number(tick.y ?? 0) + 14}
                        textAnchor="middle"
                        fontSize={isLatest ? 12 : 11}
                        fontWeight={isLatest ? 700 : 400}
                        fill={
                          isLatest
                            ? 'var(--color-brand-primary)'
                            : 'var(--color-text-muted)'
                        }
                        opacity={isFuture ? 0.55 : 1}
                      >
                        {tick.payload?.value}
                      </text>
                    );
                  }}
                  tickLine={false}
                  axisLine={{ stroke: 'var(--color-border-default)' }}
                  interval="preserveStartEnd"
                  minTickGap={20}
                />
                <YAxis
                  tickFormatter={(v: number) =>
                    metric === 'value' ? abbreviateMoney(v) : String(v)
                  }
                  tick={{ fontSize: 11, fill: 'var(--color-text-muted)' }}
                  tickLine={false}
                  axisLine={false}
                  width={metric === 'value' ? 60 : 36}
                  allowDecimals={false}
                />
                <Tooltip
                  cursor={{ stroke: 'var(--color-border-strong)' }}
                  contentStyle={{
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--color-border-default)',
                    fontSize: 12,
                    boxShadow: 'var(--shadow-md)',
                  }}
                  labelFormatter={(label) => String(label)}
                  formatter={(value, _name, item) => {
                    const point = item as
                      | {
                          payload?: {
                            total?: string;
                            count?: number;
                            isProjection?: boolean;
                          };
                        }
                      | undefined;
                    if (point?.payload?.isProjection) return [null, ''];
                    if (point?.payload?.total !== undefined) {
                      return [
                        `${formatMoney(point.payload.total)} · ${point.payload.count} sale(s)`,
                        'Sales value',
                      ];
                    }
                    return [String(value), 'Sales'];
                  }}
                />
                {latest && latestIndex < series.length - 1 && series.length > 0 ? (
                  <ReferenceArea
                    x1={latest.label}
                    x2={(series[series.length - 1] as PlotPoint).label}
                    fill="var(--color-brand-soft)"
                    fillOpacity={0.45}
                    stroke="none"
                    label={{
                      value: 'upcoming',
                      position: 'insideTopRight',
                      fontSize: 10,
                      fill: 'var(--color-text-muted)',
                    }}
                  />
                ) : null}
                <Area
                  type="monotone"
                  dataKey="plot"
                  stroke="none"
                  fill="url(#afhomesSalesTrendFill)"
                  activeDot={false}
                  connectNulls={false}
                />
                <Line
                  type="monotone"
                  dataKey="plot"
                  stroke="url(#afhomesSalesTrendLine)"
                  strokeWidth={3}
                  strokeLinecap="round"
                  dot={false}
                  activeDot={{
                    r: 5,
                    fill: 'var(--color-brand-primary)',
                    stroke: '#fff',
                    strokeWidth: 2,
                  }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
                {latest && typeof latest.plot === 'number' ? (
                  <ReferenceDot
                    x={latest.label}
                    y={latest.plot}
                    r={6}
                    fill="var(--color-brand-primary)"
                    stroke="#fff"
                    strokeWidth={2.5}
                  />
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
            <p className={styles.chartFootnote}>
              <span className={styles.latestDot} aria-hidden="true" />
              Latest ({latest?.label ?? ''}) sits in the middle — the shaded run-off is empty
              axis space, not forecast data.
            </p>
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
