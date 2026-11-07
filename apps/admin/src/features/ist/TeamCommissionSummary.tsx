import { MEMBER_POSITION_LABELS, type IstPortalReport } from '@afhomes/contracts';
import { formatCount, formatMoney } from '@afhomes/shared';
import {
  MetricCard,
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';
import styles from './IstPortalPage.module.css';

const money = (value: string | null) => (value === null ? '—' : formatMoney(value));
const count = (value: number | null) => (value === null ? '—' : formatCount(value));

export function TeamCommissionSummary({ data }: { data: IstPortalReport }) {
  const overview = data.teamCommissionOverview;
  if (!overview) return null;
  const vd = overview.role === 'vice_director';
  const ostCounts = (
    <>
      <MetricCard
        label={vd ? 'Total OST Members With Sales' : 'OST Members With Sales'}
        value={count(data.ost.withSales)}
        icon="users"
      />
      <MetricCard
        label={vd ? 'Total OST Members Without Sales' : 'OST Members Without Sales'}
        value={count(data.ost.withoutSales)}
        icon="users"
      />
    </>
  );
  return (
    <>
      <p className={styles.scope}>{overview.scopeLabel}</p>
      {vd ? (
        <>
          <section
            className={styles.summarySection}
            aria-label="Organization commission performance"
          >
            <h2>Organization Commission Performance</h2>
            <div className={styles.metrics}>
              <MetricCard
                label="Total Team Sales"
                value={money(overview.totals.salesAmount)}
                description={`${count(overview.totals.salesCount)} sales`}
                icon="file-text"
              />
              <MetricCard
                label="Total Team Commission Earned"
                value={money(overview.totals.earned)}
                description="Qualified earnings, including paid once"
                icon="wallet"
              />
              <MetricCard
                label="Total Team Commission Pending"
                value={money(overview.totals.toEarn)}
                description="Not yet guaranteed or payable"
                icon="clock"
              />
              <MetricCard
                label="Total Team Commission Paid"
                value={money(overview.totals.paid)}
                description="Included in earned"
                icon="check"
              />
              {ostCounts}
            </div>
          </section>
          <section className={styles.summarySection} aria-label="Personal commission earnings">
            <h2>My Commissions</h2>
            <dl className={styles.personalStrip}>
              <div>
                <dt>My Total Commission</dt>
                <dd>{money(data.personal.earned)}</dd>
              </div>
              <div>
                <dt>My Commission Pending</dt>
                <dd>{money(data.personal.toEarn)}</dd>
              </div>
              <div>
                <dt>My Commission Paid</dt>
                <dd>{money(data.personal.paid)}</dd>
              </div>
            </dl>
          </section>
        </>
      ) : (
        <>
          <section className={styles.summarySection} aria-label="Personal commission earnings">
            <h2>My Commissions</h2>
            <div className={styles.metrics}>
              <MetricCard
                label="My Total Commission"
                value={money(data.personal.earned)}
                description="Qualified earnings, including paid once"
                icon="wallet"
              />
              <MetricCard
                label="My Commission Pending"
                value={money(data.personal.toEarn)}
                description="Not yet guaranteed or payable"
                icon="clock"
              />
              <MetricCard
                label="My Commission Paid"
                value={money(data.personal.paid)}
                description="Included in earned"
                icon="check"
              />
            </div>
          </section>
          <section className={styles.summarySection} aria-label="OST team commission earnings">
            <h2>OST Team Commissions</h2>
            <div className={styles.metrics}>
              <MetricCard
                label="OST Team Commission Earned"
                value={money(data.ost.earned)}
                description="Belongs to OST beneficiaries; includes paid once"
                icon="wallet"
              />
              <MetricCard
                label="OST Team Commission Pending"
                value={money(data.ost.toEarn)}
                description="Not yet guaranteed or payable"
                icon="clock"
              />
              <MetricCard
                label="OST Team Commission Paid"
                value={money(data.ost.paid)}
                description="Included in OST earned commissions"
                icon="check"
              />
              {ostCounts}
            </div>
          </section>
        </>
      )}
      <p className={styles.period}>
        Earned includes paid commissions once. Pending and cancelled commissions are excluded from
        earned. Organization and OST earnings do not increase your personal entitlement.
      </p>
      {vd ? (
        <section className={styles.summarySection} aria-label="Commission breakdown">
          <h2>Commission Breakdown</h2>
          <div className={styles.historyTable}>
            <Table>
              <TableCaption>Commission breakdown by position</TableCaption>
              <TableHead>
                <TableRow>
                  {['Position', 'Records', 'Pending', 'Earned', 'Paid'].map((label) => (
                    <TableHeaderCell key={label}>{label}</TableHeaderCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {overview.breakdown.map((row) => (
                  <TableRow key={row.role}>
                    <TableCell label="Position">{MEMBER_POSITION_LABELS[row.role]}</TableCell>
                    <TableCell label="Records">{count(row.recordCount)}</TableCell>
                    <TableCell label="Pending">{money(row.toEarn)}</TableCell>
                    <TableCell label="Earned">{money(row.earned)}</TableCell>
                    <TableCell label="Paid">{money(row.paid)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </section>
      ) : null}
    </>
  );
}
