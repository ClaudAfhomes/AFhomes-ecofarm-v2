import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import {
  isIstRole,
  istPortalQuerySchema,
  istTeamCommissionQuerySchema,
  commissionStatusSchema,
  MEMBER_POSITION_LABELS,
  type IstPortalReport,
  type IstPortalView,
} from '@afhomes/contracts';
import { formatCount, formatMoney } from '@afhomes/shared';
import {
  Button,
  DateField,
  EmptyState,
  ErrorState,
  Forbidden,
  FilterBar,
  MetricCard,
  PageHeader,
  Pagination,
  Select,
  SearchField,
  StatusChip,
  Skeleton,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import { useSession } from '../../lib/session';
import { formatDate } from '../../lib/format';
import { SaleTeamAccreditationCard } from '../afhomes/SaleTeamAccreditationCard';
import { getIstReport, istDateRange } from './services';
import styles from './IstPortalPage.module.css';
import { TeamCommissionSummary } from './TeamCommissionSummary';

const TITLES: Record<IstPortalView, string> = {
  dashboard: 'IST Dashboard',
  'my-sales': 'My Sales',
  'team-sales': 'Team Sales',
  'my-commissions': 'My Commissions',
  'team-commissions': 'Team Commissions',
};
const PRESETS = [
  { value: 'today', label: 'Today' },
  { value: '7', label: 'Past 7 Days' },
  { value: '28', label: 'Past 28 Days' },
  { value: '6months', label: 'Past 6 Months' },
  { value: 'custom', label: 'Custom dates' },
];
const amount = (value: string | null) => (value === null ? '—' : formatMoney(value));
const count = (value: number | null) => (value === null ? '—' : formatCount(value));
const statusLabel = (value: string) =>
  value.replaceAll('_', ' ').replace(/^./, (c) => c.toUpperCase());

function Performance({
  title,
  data,
  team = false,
}: {
  title: string;
  data: IstPortalReport['personal'] | IstPortalReport['ost'];
  team?: boolean;
}) {
  const prefix = team ? 'OST Team' : 'My';
  return (
    <section className={team ? styles.team : styles.section} aria-label={title}>
      <h2>{title}</h2>
      <div className={styles.metrics}>
        <MetricCard
          label={`${prefix} Total Sales`}
          value={amount(data.salesAmount)}
          description={`${count(data.salesCount)} sales`}
        />
        {team && 'withSales' in data ? (
          <>
            <MetricCard label="OST Members With Sales" value={count(data.withSales)} />
            <MetricCard label="OST Members With No Sales" value={count(data.withoutSales)} />
          </>
        ) : (
          <MetricCard
            label="My Qualifying Sales"
            value={count(data.qualifyingSales)}
            description="Active sales"
          />
        )}
        <MetricCard
          label={`${prefix} Commission to Earn`}
          value={amount(data.toEarn)}
          description="Pending qualification; not guaranteed or payable"
        />
        <MetricCard
          label={`${prefix} Commission Earned`}
          value={amount(data.earned)}
          description="Includes paid commissions once"
        />
        <MetricCard
          label={`${prefix} Commission Paid`}
          value={amount(data.paid)}
          description="Already marked paid; included in earned"
        />
      </div>
    </section>
  );
}

export function IstPortalPage({ view = 'dashboard' }: { view?: IstPortalView }) {
  const { user } = useSession();
  const [search, setSearch] = useSearchParams();
  const defaultRange = istDateRange('28');
  const from = search.get('from') ?? defaultRange.from;
  const to = search.get('to') ?? defaultRange.to;
  const page = Number(search.get('page') ?? 1);
  const [custom, setCustom] = useState({ from, to });
  const preset = search.get('period') ?? (search.has('from') ? 'custom' : '28');
  const teamView = view === 'team-commissions';
  const role = search.get('role') || undefined;
  const status = search.get('status') || undefined;
  const appliedSearch = search.get('search') || undefined;
  const [searchText, setSearchText] = useState(appliedSearch ?? '');
  const teamQuery = teamView
    ? istTeamCommissionQuerySchema.safeParse({
        from,
        to,
        page,
        view,
        role,
        status,
        search: appliedSearch,
      })
    : null;
  const valid =
    istPortalQuerySchema.safeParse({ from, to, page, view }).success &&
    (!teamQuery || teamQuery.success);
  const params = teamQuery?.success ? teamQuery.data : { view, from, to, page };
  const report = useQuery({
    queryKey: [
      'ist-portal',
      user?.id,
      view,
      from,
      to,
      page,
      teamView ? role : null,
      teamView ? status : null,
      teamView ? appliedSearch : null,
    ],
    queryFn: ({ signal }) => getIstReport(params, signal),
    enabled: valid && (!user || isIstRole(user.roleSlug)),
  });
  if (user && !isIstRole(user.roleSlug)) return <Forbidden />;
  const setRange = (range: { from: string; to: string }, period: string) => {
    if (!teamView) return setSearch({ ...range, period });
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.set('from', range.from);
      next.set('to', range.to);
      next.set('period', period);
      next.delete('page');
      return next;
    });
  };
  const filterHistory = (values: Record<string, string>) =>
    setSearch((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('page');
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  const data = report.data;
  const isCommissions = view.endsWith('commissions');
  return (
    <div className={view === 'dashboard' ? styles.page : styles.lightPage}>
      <PageHeader
        title={TITLES[view]}
        description={
          view === 'dashboard'
            ? 'Your account, personal performance and authorized OST team.'
            : isCommissions
              ? 'Recorded commission amounts. Qualification and payout remain subject to existing approval rules.'
              : 'Frozen sales attributed to the selected scope.'
        }
      />
      <div className={styles.filters}>
        <label>
          Reporting period
          <Select
            aria-label="Reporting period"
            value={preset}
            options={PRESETS}
            onChange={(e) => {
              const value = e.target.value;
              if (value === 'custom') {
                setCustom({ from, to });
                setRange({ from, to }, value);
              } else setRange(istDateRange(value), value);
            }}
          />
        </label>
        {preset === 'custom' ? (
          <>
            <DateField
              id="ist-from"
              name="from"
              label="Custom Start Date"
              value={custom.from}
              onChange={(value) => setCustom((v) => ({ ...v, from: value }))}
              max={custom.to}
            />
            <DateField
              id="ist-to"
              name="to"
              label="Custom End Date"
              value={custom.to}
              onChange={(value) => setCustom((v) => ({ ...v, to: value }))}
              min={custom.from}
            />
            <Button
              disabled={!istPortalQuerySchema.safeParse({ ...custom, view }).success}
              onClick={() => setRange(custom, 'custom')}
            >
              Apply dates
            </Button>
          </>
        ) : null}
      </div>
      <p className={styles.period}>
        Reporting period: {from} – {to}, inclusive UTC. Sales use sale creation date; commissions
        use commission creation date.
      </p>
      {!valid ? (
        <p role="alert">Choose valid dates, with the start on or before the end.</p>
      ) : report.isPending ? (
        <div role="status" aria-label="Loading IST performance">
          <Skeleton />
          <Skeleton />
        </div>
      ) : report.isError ? (
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      ) : data ? (
        <>
          {view === 'dashboard' ? (
            <>
              <section className={styles.account} aria-label="IST Account">
                <div>
                  <h2>IST Account</h2>
                  <h3>{data.account.name}</h3>
                  <dl className={styles.facts}>
                    <div>
                      <dt>Role</dt>
                      <dd>{data.account.role}</dd>
                    </div>
                    <div>
                      <dt>Staff/IST number</dt>
                      <dd>{data.account.staffNumber ?? 'Not defined'}</dd>
                    </div>
                    <div>
                      <dt>Account status</dt>
                      <dd>{statusLabel(data.account.status)}</dd>
                    </div>
                    <div>
                      <dt>Upline / head</dt>
                      <dd>{data.account.head ?? 'No head assigned'}</dd>
                    </div>
                  </dl>
                </div>
                <SaleTeamAccreditationCard kind="IST" showValidityDates />
              </section>
              <section className={styles.section} aria-label="Team Summary">
                <h2>Team Summary</h2>
                <div className={styles.metrics}>
                  <MetricCard label="Total Authorized Downline" value={count(data.team.total)} />
                  <MetricCard label="Active Members" value={count(data.team.active)} />
                  <MetricCard
                    label="Team Sales"
                    value={amount(data.team.salesAmount)}
                    description={`${count(data.team.salesCount)} sales`}
                  />
                  <MetricCard label="Members With Sales" value={count(data.team.withSales)} />
                  <MetricCard label="Members With No Sales" value={count(data.team.withoutSales)} />
                </div>
              </section>
              <Performance title="Personal Performance" data={data.personal} />
              <Performance title="OST Team Performance" data={data.ost} team />
            </>
          ) : (
            <>
              {teamView ? (
                <TeamCommissionSummary data={data} />
              ) : isCommissions ? (
                <Performance title="Personal Performance" data={data.personal} />
              ) : null}
              {teamView && data.teamCommissionOverview ? (
                <section className={styles.summarySection} aria-label="Team Commission Details">
                  <h2>Team Commission Details</h2>
                  <p className={styles.period}>
                    Read-only history. Filters narrow the table; summary totals cover the full
                    authorized scope for the selected period.
                  </p>
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      filterHistory({ search: searchText.trim() });
                    }}
                  >
                    <FilterBar
                      search={
                        <SearchField
                          label="Search team commissions"
                          value={searchText}
                          onChange={setSearchText}
                          placeholder="Salesperson, commission or sale reference"
                        />
                      }
                      filters={
                        <>
                          <label className={styles.filterLabel}>
                            Salesperson role
                            <Select
                              aria-label="Salesperson role"
                              value={role ?? ''}
                              options={[
                                { value: '', label: 'All authorized roles' },
                                ...data.teamCommissionOverview.availableRoles.map((position) => ({
                                  value: position,
                                  label: MEMBER_POSITION_LABELS[position],
                                })),
                              ]}
                              onChange={(event) => filterHistory({ role: event.target.value })}
                            />
                          </label>
                          <label className={styles.filterLabel}>
                            Commission status
                            <Select
                              aria-label="Commission status"
                              value={status ?? ''}
                              options={[
                                { value: '', label: 'All statuses' },
                                ...commissionStatusSchema.options.map((value) => ({
                                  value,
                                  label: statusLabel(value),
                                })),
                              ]}
                              onChange={(event) => filterHistory({ status: event.target.value })}
                            />
                          </label>
                        </>
                      }
                      actions={
                        <>
                          <Button type="submit">Apply search</Button>
                          <Button
                            type="button"
                            variant="ghost"
                            onClick={() => {
                              setSearchText('');
                              filterHistory({ role: '', status: '', search: '' });
                            }}
                          >
                            Clear filters
                          </Button>
                        </>
                      }
                    />
                  </form>
                </section>
              ) : null}
              {isCommissions ? (
                data.commissions.length ? (
                  <div className={`${styles.table} ${styles.historyTable}`}>
                    <Table>
                      <TableCaption>{TITLES[view]} history</TableCaption>
                      <TableHead>
                        <TableRow>
                          {[
                            'Commission reference',
                            ...(teamView ? ['Salesperson', 'Role'] : []),
                            'Sale reference',
                            'Amount',
                            'Status',
                            ...(teamView ? ['Payment status'] : []),
                            'Created',
                            'Date earned',
                            'Date paid',
                          ].map((h) => (
                            <TableHeaderCell key={h}>{h}</TableHeaderCell>
                          ))}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {data.commissions.map((c) => (
                          <TableRow key={c.id}>
                            <TableCell label="Commission reference">
                              {c.commissionNumber ?? 'Not assigned'}
                            </TableCell>
                            {teamView ? (
                              <>
                                <TableCell label="Salesperson">{c.memberName}</TableCell>
                                <TableCell label="Role">
                                  {c.memberRole ? MEMBER_POSITION_LABELS[c.memberRole] : '—'}
                                </TableCell>
                              </>
                            ) : null}
                            <TableCell label="Sale reference">{c.saleNumber}</TableCell>
                            <TableCell label="Amount">{amount(c.amount)}</TableCell>
                            <TableCell label="Status">
                              {teamView ? (
                                <StatusChip label={statusLabel(c.status)} />
                              ) : (
                                statusLabel(c.status)
                              )}
                            </TableCell>
                            {teamView ? (
                              <TableCell label="Payment status">
                                {c.status === 'paid'
                                  ? 'Marked paid'
                                  : c.status === 'cancelled'
                                    ? 'Not payable'
                                    : 'Not marked paid'}
                              </TableCell>
                            ) : null}
                            <TableCell label="Created">{formatDate(c.createdAt)}</TableCell>
                            <TableCell label="Date earned">{formatDate(c.earnedAt)}</TableCell>
                            <TableCell label="Date paid">{formatDate(c.paidAt)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <EmptyState title="No commissions in this period" />
                )
              ) : data.sales.length ? (
                <div className={`${styles.table} ${styles.historyTable}`}>
                  <Table>
                    <TableCaption>{TITLES[view]} history</TableCaption>
                    <TableHead>
                      <TableRow>
                        {[
                          'Sale reference',
                          'Date',
                          'Customer',
                          'VIP tier',
                          'Sales amount',
                          'Status',
                        ].map((h) => (
                          <TableHeaderCell key={h}>{h}</TableHeaderCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.sales.map((s) => (
                        <TableRow key={s.id}>
                          <TableCell label="Sale reference">{s.saleNumber}</TableCell>
                          <TableCell label="Date">{formatDate(s.createdAt)}</TableCell>
                          <TableCell label="Customer">{s.customerName ?? 'Restricted'}</TableCell>
                          <TableCell label="VIP tier">{s.tier ?? '—'}</TableCell>
                          <TableCell label="Sales amount">{amount(s.amount)}</TableCell>
                          <TableCell label="Status">{statusLabel(s.status)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : (
                <EmptyState title="No sales in this period" />
              )}
              {data.total > data.pageSize ? (
                <Pagination
                  page={page}
                  pageCount={Math.ceil(data.total / data.pageSize)}
                  onChange={(next) => {
                    const params = new URLSearchParams(search);
                    params.set('page', String(next));
                    setSearch(params);
                  }}
                />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}

export function IstAccreditationPage() {
  const { user } = useSession();
  if (!isIstRole(user?.roleSlug)) return <Forbidden />;
  return (
    <div className={styles.page}>
      <PageHeader
        title="Accreditation"
        description="Your existing AA identity and approved validity dates."
      />
      <SaleTeamAccreditationCard kind="IST" showValidityDates />
    </div>
  );
}
