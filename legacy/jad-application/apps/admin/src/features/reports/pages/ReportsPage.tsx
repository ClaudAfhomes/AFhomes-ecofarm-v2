import { useMemo, useState } from 'react';

import {
  Button,
  EmptyState,
  ErrorState,
  Icon,
  PageHeader,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  Tabs,
  notifyError,
} from '@jad/ui';
import type { IconName, StatusTone } from '@jad/ui';
import { formatMoney } from '@jad/shared';
import type {
  CommissionReportRow,
  OperationalSummaryReport,
  SalesReportRow,
  SalesCommissionsReport,
} from '@jad/contracts';

import { formatDate } from '../../../lib/format';
import { SALE_STATUS_LABEL, SALE_STATUS_TONE } from '../../sales/status';
import { useOperationalSummaryReport } from '../hooks/useOperationalSummaryReport';
import { useSalesCommissionsReport } from '../hooks/useSalesCommissionsReport';
import { downloadCsv, toCsv, type CsvColumn } from '../services/csv';
import styles from './ReportsPage.module.css';

type ReportTab = 'sales' | 'summary';

const COMMISSION_STATUS_LABEL: Record<CommissionReportRow['status'], string> = {
  PENDING: 'Pending',
  AVAILABLE: 'Available (cleared)',
  CANCELLED: 'Cancelled',
  REVERSED: 'Reversed',
};

const COMMISSION_STATUS_TONE: Record<CommissionReportRow['status'], StatusTone> = {
  PENDING: 'warning',
  AVAILABLE: 'success',
  CANCELLED: 'neutral',
  REVERSED: 'danger',
};

const COMMISSION_TYPE_LABEL: Record<CommissionReportRow['commissionType'], string> = {
  DIRECT_COMMISSION: 'Direct Commission',
  DIRECT_REFERRAL: 'Direct Referral',
  GROUP_INCENTIVE: 'Group Incentive',
};

/** First day of the current month as YYYY-MM-DD (default report range start). */
function currentMonthStart(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1)).toISOString().slice(0, 10);
}

const SALES_CSV_COLUMNS: CsvColumn<SalesReportRow>[] = [
  { key: 'id', header: 'Sale ID', value: (r) => r.id },
  { key: 'propertyName', header: 'Property', value: (r) => r.propertyName },
  { key: 'sellerName', header: 'Seller', value: (r) => r.sellerName },
  { key: 'status', header: 'Status', value: (r) => SALE_STATUS_LABEL[r.status] },
  { key: 'propertyValue', header: 'Value', value: (r) => r.propertyValue },
  { key: 'referrerName', header: 'Referrer', value: (r) => r.referrerName ?? '' },
  { key: 'submittedAt', header: 'Submitted', value: (r) => r.submittedAt },
];

const COMMISSIONS_CSV_COLUMNS: CsvColumn<CommissionReportRow>[] = [
  { key: 'id', header: 'Commission ID', value: (r) => r.id },
  { key: 'saleId', header: 'Sale ID', value: (r) => r.saleId },
  { key: 'memberName', header: 'Member', value: (r) => r.memberName },
  { key: 'commissionType', header: 'Type', value: (r) => COMMISSION_TYPE_LABEL[r.commissionType] },
  { key: 'amount', header: 'Amount', value: (r) => r.amount },
  { key: 'status', header: 'Status', value: (r) => COMMISSION_STATUS_LABEL[r.status] },
  { key: 'createdAt', header: 'Created', value: (r) => r.createdAt },
  { key: 'clearedAt', header: 'Cleared', value: (r) => r.clearedAt ?? '' },
];

interface SummaryCsvRow {
  section: string;
  metric: string;
  value: string;
}

function summaryCsvRows(report: OperationalSummaryReport): SummaryCsvRow[] {
  const rows: SummaryCsvRow[] = [];
  const push = (section: string, metric: string, value: string | number) =>
    rows.push({ section, metric, value: String(value) });
  push('Members', 'Active', report.members.active);
  push('Members', 'Inactive', report.members.inactive);
  push('Members', 'Archived', report.members.archived);
  push('Registrations', 'Total', report.registrations.total);
  push('Registrations', 'Pending', report.registrations.pending);
  push('Registrations', 'Rejected', report.registrations.rejected);
  push('Sales', 'Total', report.sales.total);
  for (const [status, count] of Object.entries(report.sales.byStatus)) {
    push('Sales', `${SALE_STATUS_LABEL[status as keyof typeof SALE_STATUS_LABEL]} count`, count);
  }
  push('Withdrawals', 'Pending count', report.withdrawals.pendingCount);
  push('Withdrawals', 'Pending total', report.withdrawals.pendingTotal);
  push('Withdrawals', 'Completed count', report.withdrawals.completedCount);
  push('Withdrawals', 'Completed total', report.withdrawals.completedTotal);
  push('Withdrawals', 'Rejected count', report.withdrawals.rejectedCount);
  push('Commissions', 'Pending count', report.commissions.pendingCount);
  push('Commissions', 'Pending total', report.commissions.pendingTotal);
  push('Commissions', 'Available count', report.commissions.availableCount);
  push('Commissions', 'Available total', report.commissions.availableTotal);
  push('Inquiries', 'New', report.inquiries.new);
  return rows;
}

const SUMMARY_CSV_COLUMNS: CsvColumn<SummaryCsvRow>[] = [
  { key: 'section', header: 'Section', value: (r) => r.section },
  { key: 'metric', header: 'Metric', value: (r) => r.metric },
  { key: 'value', header: 'Value', value: (r) => r.value },
];

function csvFileStamp(generatedAt: string): string {
  return generatedAt.slice(0, 10).replace(/-/g, '');
}

/** Metric card in the summary grids (dashboard queue-card visual language). */
function MetricTile({
  label,
  value,
  icon,
  tone = 'brand',
}: {
  label: string;
  value: string;
  icon: IconName;
  tone?: 'brand' | 'success' | 'warning' | 'danger' | 'neutral';
}) {
  const toneClass =
    tone === 'brand'
      ? ''
      : ` ${styles[`tile${tone[0]!.toUpperCase()}${tone.slice(1)}`] ?? ''}`;
  return (
    <div className={`${styles.tile}${toneClass}`}>
      <span className={styles.tileIcon} aria-hidden="true">
        <Icon name={icon} size={18} />
      </span>
      <span className={styles.tileValue}>{value}</span>
      <span className={styles.tileLabel}>{label}</span>
    </div>
  );
}

/**
 * Admin Reports (finance-visible): generate the Sales & Commissions report or
 * the Operational Summary, preview it, and download it as CSV. Report data is
 * always server-derived; the client only renders rows and builds CSV files.
 */
export function ReportsPage() {
  const [tab, setTab] = useState<ReportTab>('sales');

  const [from, setFrom] = useState(() => currentMonthStart());
  const [to, setTo] = useState('');
  const [runRange, setRunRange] = useState<{ from?: string; to?: string } | null>(null);
  const sales = useSalesCommissionsReport(runRange ?? {}, runRange !== null);

  const [summaryRequested, setSummaryRequested] = useState(false);
  const summary = useOperationalSummaryReport(summaryRequested);

  const summaryRows = useMemo(
    () => (summary.data ? summaryCsvRows(summary.data) : []),
    [summary.data],
  );

  const generateSales = () => {
    setRunRange({ from: from || undefined, to: to || undefined });
  };

  const generateSummary = () => {
    setSummaryRequested(true);
    void summary.refetch();
  };

  const downloadSalesCsv = () => {
    const data = sales.data;
    if (!data) return;
    try {
      downloadCsv(
        `sales-report-${csvFileStamp(data.generatedAt)}.csv`,
        toCsv(SALES_CSV_COLUMNS, data.sales),
      );
      downloadCsv(
        `commissions-report-${csvFileStamp(data.generatedAt)}.csv`,
        toCsv(COMMISSIONS_CSV_COLUMNS, data.commissions),
      );
    } catch (e) {
      notifyError({ title: 'Download failed', message: (e as Error).message });
    }
  };

  const downloadSummaryCsv = () => {
    if (summaryRows.length === 0) return;
    try {
      downloadCsv(
        `operational-summary-${csvFileStamp(summary.data?.generatedAt ?? new Date().toISOString())}.csv`,
        toCsv(SUMMARY_CSV_COLUMNS, summaryRows),
      );
    } catch (e) {
      notifyError({ title: 'Download failed', message: (e as Error).message });
    }
  };

  const report: SalesCommissionsReport | undefined = sales.data;

  return (
    <section>
      <PageHeader
        title="Reports"
        description="Generate financial and operational reports, then export them as CSV."
      />

      <div className={styles.controls}>
        <div className={styles.controlsTop}>
          <Tabs
            ariaLabel="Report type"
            value={tab}
            onChange={(value) => setTab(value as ReportTab)}
            items={[
              { value: 'sales', label: 'Sales & Commissions' },
              { value: 'summary', label: 'Operational Summary' },
            ]}
          />
        </div>

        {tab === 'sales' ? (
          <div className={styles.toolbar}>
            <label className={styles.dateField}>
              <span>From</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-label="Report from date"
              />
            </label>
            <label className={styles.dateField}>
              <span>To</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-label="Report to date"
              />
            </label>
            <Button
              variant="primary"
              onClick={generateSales}
              loading={runRange !== null && sales.isPending}
            >
              Generate
            </Button>
            <p className={styles.toolbarHint}>
              Optional: leave From or To empty to report on all time.
            </p>
          </div>
        ) : (
          <div className={styles.toolbar}>
            <Button
              variant="primary"
              onClick={generateSummary}
              loading={summaryRequested && summary.isPending}
            >
              Generate
            </Button>
          </div>
        )}
      </div>

      {tab === 'sales' ? (
        <>
          {runRange !== null && sales.isPending ? (
            <Skeleton style={{ height: 320 }} />
          ) : sales.isError ? (
            <ErrorState error={sales.error} onRetry={() => void sales.refetch()} />
          ) : report ? (
            <>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>
                  Summary ({report.range.from ?? 'all time'} – {report.range.to ?? 'today'})
                </h2>
                <span className={styles.generatedAt}>
                  Generated {formatDate(report.generatedAt)}
                </span>
              </div>
              <div className={styles.tiles}>
                <MetricTile
                  icon="list"
                  label="Qualifying sales in range"
                  value={String(report.summary.salesCount)}
                />
                <MetricTile
                  icon="wallet"
                  label="Qualifying sales value"
                  value={formatMoney(report.summary.salesValueTotal)}
                />
                {Object.entries(report.summary.commissionsByStatus).map(([status, breakdown]) => (
                  <MetricTile
                    key={status}
                    icon={
                      status === 'AVAILABLE'
                        ? 'check'
                        : status === 'PENDING'
                          ? 'clock'
                          : status === 'REVERSED'
                            ? 'alert'
                            : 'close'
                    }
                    tone={
                      status === 'AVAILABLE'
                        ? 'success'
                        : status === 'PENDING'
                          ? 'warning'
                          : status === 'REVERSED'
                            ? 'danger'
                            : 'neutral'
                    }
                    label={`${COMMISSION_STATUS_LABEL[status as CommissionReportRow['status']]} commissions`}
                    value={`${breakdown.count} · ${formatMoney(breakdown.total)}`}
                  />
                ))}
              </div>

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Sales</h2>
                <Button variant="secondary" onClick={downloadSalesCsv}>
                  <Icon name="download" size={16} aria-hidden="true" /> Download CSV (sales +
                  commissions)
                </Button>
              </div>
              {report.sales.length === 0 ? (
                <EmptyState
                  title="No sales in this range"
                  description="Adjust the date range or clear it to report on all sales."
                />
              ) : (
                <div className="table-scroll">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Property</TableHeaderCell>
                        <TableHeaderCell>Seller</TableHeaderCell>
                        <TableHeaderCell align="right">Value</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell>Referrer</TableHeaderCell>
                        <TableHeaderCell>Submitted</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.sales.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell label="Property">{row.propertyName}</TableCell>
                          <TableCell label="Seller">{row.sellerName}</TableCell>
                          <TableCell label="Value" align="right">
                            {formatMoney(row.propertyValue)}
                          </TableCell>
                          <TableCell label="Status">
                            <StatusChip
                              label={SALE_STATUS_LABEL[row.status]}
                              tone={SALE_STATUS_TONE[row.status]}
                            />
                          </TableCell>
                          <TableCell label="Referrer">{row.referrerName ?? '—'}</TableCell>
                          <TableCell label="Submitted">{formatDate(row.submittedAt)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}

              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>Commissions</h2>
              </div>
              {report.commissions.length === 0 ? (
                <EmptyState
                  title="No commissions in this range"
                  description="Commissions appear once qualifying sales in this range earn them."
                />
              ) : (
                <div className="table-scroll">
                  <Table>
                    <TableHead>
                      <TableRow>
                        <TableHeaderCell>Member</TableHeaderCell>
                        <TableHeaderCell>Type</TableHeaderCell>
                        <TableHeaderCell align="right">Amount</TableHeaderCell>
                        <TableHeaderCell>Status</TableHeaderCell>
                        <TableHeaderCell>Created</TableHeaderCell>
                        <TableHeaderCell>Cleared</TableHeaderCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.commissions.map((row) => (
                        <TableRow key={row.id}>
                          <TableCell label="Member">{row.memberName}</TableCell>
                          <TableCell label="Type">
                            {COMMISSION_TYPE_LABEL[row.commissionType]}
                          </TableCell>
                          <TableCell label="Amount" align="right">
                            {formatMoney(row.amount)}
                          </TableCell>
                          <TableCell label="Status">
                            <StatusChip
                              label={COMMISSION_STATUS_LABEL[row.status]}
                              tone={COMMISSION_STATUS_TONE[row.status]}
                            />
                          </TableCell>
                          <TableCell label="Created">{formatDate(row.createdAt)}</TableCell>
                          <TableCell label="Cleared">
                            {row.clearedAt ? formatDate(row.clearedAt) : '—'}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </>
          ) : (
            <EmptyState
              title="No report yet"
              description="Pick a date range and press Generate to build the report."
            />
          )}
        </>
      ) : (
        <>
          {!summaryRequested ? (
            /* Disabled TanStack queries sit in status 'pending' (fetchStatus
             * 'idle') - gate the skeleton on whether the user asked for a run
             * or it shows forever before Generate. */
            <EmptyState
              title="No report yet"
              description="Press Generate to build the operational snapshot."
            />
          ) : summary.isPending ? (
            <Skeleton style={{ height: 320 }} />
          ) : summary.isError ? (
            <ErrorState error={summary.error} onRetry={() => void summary.refetch()} />
          ) : summary.data ? (
            <>
              <div className={styles.sectionHead}>
                <h2 className={styles.sectionTitle}>
                  Snapshot as of {formatDate(summary.data.generatedAt)}
                </h2>
                <Button variant="secondary" onClick={downloadSummaryCsv}>
                  <Icon name="download" size={16} aria-hidden="true" /> Download CSV
                </Button>
              </div>
              <div className={styles.tiles}>
                <MetricTile
                  icon="users"
                  label="Active members"
                  value={String(summary.data.members.active)}
                />
                <MetricTile
                  icon="user-plus"
                  tone="warning"
                  label="Pending registrations"
                  value={String(summary.data.registrations.pending)}
                />
                <MetricTile
                  icon="list"
                  label="Qualifying sales"
                  value={String(summary.data.sales.total)}
                />
                <MetricTile
                  icon="clock"
                  tone="warning"
                  label="Pending withdrawals"
                  value={String(summary.data.withdrawals.pendingCount)}
                />
                <MetricTile
                  icon="wallet"
                  tone="warning"
                  label="Pending withdrawal money"
                  value={formatMoney(summary.data.withdrawals.pendingTotal)}
                />
                <MetricTile
                  icon="check"
                  tone="success"
                  label="Cleared commissions"
                  value={formatMoney(summary.data.commissions.availableTotal)}
                />
                <MetricTile
                  icon="clock"
                  tone="warning"
                  label="Pending commissions"
                  value={formatMoney(summary.data.commissions.pendingTotal)}
                />
                <MetricTile
                  icon="message"
                  label="New inquiries"
                  value={String(summary.data.inquiries.new)}
                />
              </div>

              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Section</TableHeaderCell>
                      <TableHeaderCell>Metric</TableHeaderCell>
                      <TableHeaderCell align="right">Value</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {summaryRows.map((row, idx) => (
                      <TableRow key={`${row.section}-${row.metric}-${idx}`}>
                        <TableCell label="Section">{row.section}</TableCell>
                        <TableCell label="Metric">{row.metric}</TableCell>
                        <TableCell label="Value" align="right">
                          {row.value}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          ) : (
            <EmptyState
              title="No report yet"
              description="Press Generate to build the operational snapshot."
            />
          )}
        </>
      )}
    </section>
  );
}
