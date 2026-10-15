import { useState, lazy, Suspense } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AnalyticsOverview, AnalyticsPeriod } from '@afhomes/contracts';
import { paymentSchemeLabel } from '@afhomes/contracts';
import { compareMoney, formatCount, formatMoney } from '@afhomes/shared';
import { formatDate } from '../../lib/format';
import {
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
import { TrendChartSkeleton } from './AfHomesTrendChartSkeleton';
import { getAnalyticsOverview } from './services';
import { canViewModule } from '../../app/navigation';
import { useSession } from '../../lib/session';
import { SaleTeamAccreditationCard } from './SaleTeamAccreditationCard';
import styles from './AfHomesDashboardPage.module.css';

const PERIODS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
] as const;
type Metric = [label: string, value: string | number];

/**
 * Plain-language name for each analytics scope.
 *
 * The raw enum is a developer token; the operator needs to know whose numbers
 * they are looking at. The server is still authoritative about which scope
 * applies - this only labels the one it returned.
 */
const SCOPE_LABEL: Record<AnalyticsOverview['scope']['kind'], string> = {
  global: 'Whole company',
  finance: 'Finance',
  organization: 'Organization',
  team: 'Your team',
  self: 'Your own records',
  redemption: 'Redemption operations',
};

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
  // Headline cards are fixed: every operational scope reads the same four
  // server-scoped figures (organization and redemption keep their own sets —
  // they have no customer/sale headline to show).
  return [
    ['Total Customers', data.headline.totalCustomers],
    ['New Applications', data.headline.newCustomers],
    ['Card Sales', data.headline.periodSales],
    ['Total Sales', formatMoney(data.headline.grossFrozenSaleValue)],
  ];
}

/**
 * Headline labels that require `sales.card_sales` view. Staff without Sales
 * access keep the customer cards (and the organization/redemption sets, which
 * never contain these labels); only the sales figures are stripped. The
 * server remains the security boundary - this is display gating only, matching
 * the Sales nav group which is keyed on the same module.
 */
const SALES_HEADLINE_LABELS: ReadonlySet<string> = new Set(['Card Sales', 'Total Sales']);

export function filterSalesMetrics(values: Metric[], canViewSales: boolean): Metric[] {
  if (canViewSales) return values;
  return values.filter(([label]) => !SALES_HEADLINE_LABELS.has(label));
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
  Customers: { icon: 'users', description: '' },
  'My customers': { icon: 'users', description: 'Customers attributed to you' },
  'Total Customers': { icon: 'users', description: 'Customers in your authorized scope' },
  'New Applications': { icon: 'user-plus', description: 'New in the selected period' },
  'Card Sales': { icon: 'file-text', description: 'Sales in the selected period' },
  'Total Sales': { icon: 'wallet', description: 'Frozen sale value in the selected period' },
  'Card sales': { icon: 'file-text', description: '' },
  'My sales': { icon: 'file-text', description: 'Sales you recorded in period' },
  'Frozen sale value': { icon: 'wallet', description: '' },
  'New customers': { icon: 'user-plus', description: '' },
  'Direct reports': { icon: 'users', description: 'Your first-level team' },
  Descendants: { icon: 'users', description: 'Everyone below you' },
  'Active sellers': { icon: 'user-check', description: 'Sellers able to transact' },
  'Inactive sellers': { icon: 'user-x', description: 'Sellers unable to transact' },
};

/**
 * Titled panel with an icon, so every block on the dashboard shares one shape.
 *
 * Presentation only. The heading is real and the icon is decorative, so the
 * section is still reachable by its name.
 */
function Panel({
  icon,
  title,
  hint,
  aside,
  children,
}: {
  icon: IconName;
  title: string;
  hint?: string;
  /** Trailing control for the panel head, e.g. the period selector. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.panel} aria-label={title}>
      <div className={styles.panelHead}>
        <span className={styles.cardIcon} aria-hidden="true">
          <Icon name={icon} size={18} />
        </span>
        <h2 className={styles.panelTitle}>{title}</h2>
        {hint ? <p className={styles.panelHint}>{hint}</p> : null}
        {aside ? <div className={styles.panelAside}>{aside}</div> : null}
      </div>
      {children}
    </section>
  );
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
    <ul className={styles.metrics}>
      {values.map(([label, value]) => {
        const presentation = METRIC_PRESENTATION[label] ?? {
          icon: 'grid' as IconName,
          description: '',
        };
        // Whole counts render grouped (`8000` → `8,000`); money strings arrive
        // pre-formatted from `dashboardMetrics` and pass through untouched.
        const display = typeof value === 'number' ? formatCount(value) : value;
        return (
          <li key={label}>
            <MetricCard
              label={label}
              value={display}
              icon={presentation.icon}
              description={presentation.description || undefined}
            />
          </li>
        );
      })}
    </ul>
  );
}

function MetricCardSkeletons({ count = 4 }: { count?: number }) {
  return (
    <ul className={styles.metrics} aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <li key={index}>
          <Skeleton className={styles.cardSkeleton} />
        </li>
      ))}
    </ul>
  );
}

/**
 * How many metrics earn a headline card.
 *
 * Four is what fits one clean row across the staff console, and a dashboard
 * that shows everything shows nothing. The rest of the server-computed set is
 * not reshuffled onto the page: it stays available through the reports and
 * queues rather than competing with the headline figures here.
 */
const HEADLINE_METRICS = 4;

/** Join class names, skipping any that resolved to nothing. */
const cls = (...names: (string | undefined)[]) => names.filter(Boolean).join(' ');

/**
 * Semantic colour for a payment scheme.
 *
 * The scheme is a frozen property of the sale, so its colour is stable and
 * meaningful across every table and report rather than decorative: Spot Cash is
 * the paid-in-full track, the moves are the instalment escalations. An unknown
 * scheme still renders, in neutral grey, rather than disappearing.
 */
const SCHEME_TONE: Record<string, string> = {
  spot_cash: 'toneSuccess',
  move_a: 'toneInfo',
  installment_4_month: 'toneTeal',
  move_b1: 'toneWarning',
  move_b2: 'toneAccent',
};

/**
 * Metallic accent for a card plan, matched by name.
 *
 * The breakdown returns a plan NAME, not its tier code, so the tier is read from
 * the published name. Unmatched plans stay neutral instead of being guessed at.
 */
const planTone = (name: string): string => {
  const upper = name.toUpperCase();
  if (upper.includes('GOLD')) return 'toneGold';
  if (upper.includes('SILVER')) return 'toneSilver';
  if (upper.includes('BRONZE')) return 'toneBronze';
  return 'toneNeutral';
};

/**
 * Width of a row's share bar, as a percentage of the largest row.
 *
 * `Number` is used ONLY to derive this CSS geometry - it never produces, stores
 * or compares a monetary figure. Every displayed amount still comes from the
 * exact-decimal string via `formatMoney`, so no float ever reaches the user.
 */
const sharePercent = (value: string, largest: string): number => {
  const ratio = Number(value) / Number(largest);
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  return Math.max(3, Math.min(100, Math.round(ratio * 100)));
};

/**
 * Numeric cell with a share bar behind the figure.
 *
 * The bar is decorative (`aria-hidden`) and never the only carrier of meaning:
 * the exact formatted amount sits on top of it and stays selectable.
 */
function ShareCell({
  value,
  largest,
  label,
  tone,
}: {
  value: string;
  largest: string;
  label: string;
  tone?: string;
}) {
  return (
    <TableCell label={label} align="right" className={cls(styles.shareCell, tone)}>
      <span
        aria-hidden="true"
        className={styles.shareBar}
        style={{ width: `${sharePercent(value, largest)}%` }}
      />
      <span className={styles.shareText}>{formatMoney(value)}</span>
    </TableCell>
  );
}

function Trend() {
  return (
    <Suspense fallback={<TrendChartSkeleton />}>
      <AfHomesTrendChart />
    </Suspense>
  );
}

// The charting library is the heaviest dependency on this screen, so it loads
// on demand behind the same skeleton the pending state uses.
const AfHomesTrendChart = lazy(() =>
  import('./AfHomesTrendChart').then((m) => ({ default: m.AfHomesTrendChart })),
);

export function AfHomesDashboardPage() {
  const [period, setPeriod] = useState<AnalyticsPeriod>('month');
  const { status: sessionStatus, user } = useSession();
  // UX-only gate (the server re-checks everything): without
  // `sales.card_sales` view the sales sections stay off the dashboard, matching
  // the hidden Sales nav group. While the session is still resolving, assume
  // visible so the loading skeleton does not flicker.
  const canViewSales =
    sessionStatus === 'loading'
      ? true
      : canViewModule(user?.afHomesPermissions, 'sales.card_sales');
  const query = useQuery({
    queryKey: ['analytics', 'overview', period],
    queryFn: () => getAnalyticsOverview(period),
  });
  // The dashboard is deliberately four cards, one graph and two tables. The
  // server-computed set is capped rather than reordered or hand-picked: the
  // first four, in the order `dashboardMetrics` already ranks them.
  const metrics = query.data?.scope
    ? filterSalesMetrics(dashboardMetrics(query.data), canViewSales).slice(0, HEADLINE_METRICS)
    : [];
  // Share bars are drawn relative to the biggest row in each table, so each
  // breakdown reads as a proportion rather than a list of absolute totals.
  const largestSchemeValue =
    query.data?.salesByScheme.reduce(
      (best, entry) => (compareMoney(entry.value, best) > 0 ? entry.value : best),
      '0.00',
    ) ?? '0.00';
  const largestPlanValue =
    query.data?.salesByPlan.reduce(
      (best, plan) => (compareMoney(plan.value, best) > 0 ? plan.value : best),
      '0.00',
    ) ?? '0.00';
  return (
    <section className={styles.page}>
      <div className={styles.hero}>
        {query.isPending ? (
          <div className={styles.heroSkeleton} aria-hidden="true">
            <Skeleton style={{ height: 14, width: 160 }} />
            <Skeleton style={{ height: 36, width: 280 }} />
          </div>
        ) : (
          <div className={styles.heroText}>
            <p className={styles.eyebrow}>AFHomes · Staff console</p>
            <PageHeader title="Operations Overview" />
          </div>
        )}
        {!query.isPending && !query.isError && query.data ? (
          <div className={styles.heroMeta}>
            <span className={styles.heroScope}>
              <Icon name="user" size={14} aria-hidden="true" />
              {SCOPE_LABEL[query.data.scope.kind]}
            </span>
            <span className={styles.heroWindow}>
              {formatDate(query.data.window.from)} → {formatDate(query.data.window.to)}
            </span>
          </div>
        ) : null}
      </div>
      {['vice_director', 'senior_sales_manager', 'sales_manager', 'ost'].includes(
        user?.roleSlug ?? '',
      ) ? (
        <SaleTeamAccreditationCard kind={user?.roleSlug === 'ost' ? 'OST' : 'IST'} />
      ) : null}
      {query.isPending ? (
        <div role="status" aria-label="Loading dashboard" className={styles.loadingShell}>
          <div className={styles.scopeBar} aria-hidden="true">
            <Skeleton style={{ height: 22, width: 180 }} />
            <Skeleton style={{ height: 22, width: 220 }} />
          </div>
          <div className={styles.panel} aria-hidden="true">
            <Skeleton style={{ height: 22, width: 140 }} />
            <MetricCardSkeletons />
          </div>
          {canViewSales ? (
            <div className={styles.chartCard} aria-hidden="true">
              <Skeleton className={styles.chartBox} />
            </div>
          ) : null}
          {canViewSales ? (
            <div className={styles.breakdownGrid} aria-hidden="true">
              {['Payment Schemes', 'Card Plans'].map((title) => (
                <div key={title} className={styles.panel} aria-hidden="true">
                  <Skeleton style={{ height: 22, width: 160 }} />
                  <div className={styles.skeletonRows}>
                    {[0, 1, 2].map((index) => (
                      <Skeleton key={index} className={styles.skeletonRow} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {/* Scope first: every number below is bounded by it. */}
          <div className={styles.scopeBar} role="group" aria-label="Data scope">
            <span className={`${styles.scopeChip} ${styles.scopeChipStrong}`}>
              <Icon name="user" size={14} aria-hidden="true" />
              {SCOPE_LABEL[query.data.scope.kind]}
            </span>
            <span className={styles.scopeDivider} aria-hidden="true" />
            <span className={styles.scopeChip}>
              {formatDate(query.data.window.from)} to {formatDate(query.data.window.to)}
            </span>
            <span className={styles.scopeDivider} aria-hidden="true" />
            <span className={styles.scopeChip}>As of today</span>
          </div>

          {/* Exactly four headline cards, then the graph, then two tables. */}
          <Panel
            icon="grid"
            title="Key metrics"
            aside={
              <Select
                aria-label="Analytics period"
                value={period}
                onChange={(event) => setPeriod(event.target.value as AnalyticsPeriod)}
                options={[...PERIODS]}
              />
            }
          >
            <MetricCards values={metrics} />
          </Panel>

          {canViewSales && query.data.scope.kind === 'organization' ? (
            <h2 className={styles.sectionTitle}>Sales Overview</h2>
          ) : null}
          {canViewSales && query.data.scope.kind !== 'organization' ? <Trend /> : null}

          <div className={styles.breakdownGrid}>
            {canViewSales && query.data.salesByScheme.length ? (
              <Panel icon="wallet" title="Payment Schemes">
                <div className="table-scroll">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Scheme</TableHeaderCell>
                        <TableHeaderCell align="right">Sales</TableHeaderCell>
                        <TableHeaderCell align="right">Frozen value</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {query.data.salesByScheme.map((entry) => (
                        <TableRow
                          key={entry.scheme}
                          className={cls(styles[SCHEME_TONE[entry.scheme] ?? 'toneNeutral'])}
                        >
                          <TableCell label="Scheme" className={styles.rowTitle}>
                            <span className={styles.tag}>
                              <span className={styles.tagDot} aria-hidden="true" />
                              {paymentSchemeLabel(entry.scheme)}
                            </span>
                          </TableCell>
                          <TableCell label="Sales" align="right" className={styles.numeric}>
                            {formatCount(entry.count)}
                          </TableCell>
                          <ShareCell
                            label="Frozen value"
                            value={entry.value}
                            largest={largestSchemeValue}
                            tone={styles[SCHEME_TONE[entry.scheme] ?? 'toneNeutral']}
                          />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            ) : null}

            {canViewSales && query.data.salesByPlan.length ? (
              <Panel icon="file-text" title="Card Plans">
                <div className="table-scroll">
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
                        <TableRow
                          key={plan.planId}
                          className={cls(styles[planTone(plan.planName)])}
                        >
                          <TableCell label="Plan" className={styles.rowTitle}>
                            <span className={styles.tag}>
                              <span className={styles.tagDot} aria-hidden="true" />
                              {plan.planName}
                            </span>
                          </TableCell>
                          <TableCell label="Sales" align="right" className={styles.numeric}>
                            {formatCount(plan.count)}
                          </TableCell>
                          <ShareCell
                            label="Frozen value"
                            value={plan.value}
                            largest={largestPlanValue}
                            tone={styles[planTone(plan.planName)]}
                          />
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </Panel>
            ) : null}
          </div>

          {query.data.networkContext?.upperline ? (
            <aside className={styles.notice}>
              <span className={styles.noticeBody}>
                <span className={styles.noticeIcon}>
                  <Icon name="users" size={16} />
                </span>
                <span>
                  <strong>Current upperline:</strong> {query.data.networkContext.upperline.name} ·{' '}
                  {query.data.networkContext.upperline.role}
                </span>
              </span>
            </aside>
          ) : null}
          {query.data.scope.unattributedLegacySaleCount > 0 ? (
            <aside className={styles.notice}>
              <span className={styles.noticeBody}>
                <span className={styles.noticeIcon}>
                  <Icon name="alert" size={16} />
                </span>
                <span>
                  <strong>Historical sales awaiting attribution:</strong>{' '}
                  {formatCount(query.data.scope.unattributedLegacySaleCount)} sale(s),{' '}
                  {formatMoney(query.data.scope.unattributedLegacySaleValue)}. They are excluded
                  from team totals.
                </span>
              </span>
            </aside>
          ) : null}
        </>
      )}
    </section>
  );
}
