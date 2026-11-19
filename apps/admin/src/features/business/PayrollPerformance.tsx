import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { IstPerformanceStaff } from '@afhomes/contracts';
import {
  Alert,
  Button,
  Dialog,
  ErrorState,
  Skeleton,
  StatusChip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from '@afhomes/ui';

import { formatDate } from '../../lib/format';
import { formatMoney } from './format';
import { performanceBlockerLabel, payrollMonthLabel } from './payroll-utils';
import { getIstPerformance, getIstStaffEvidence, payrollKeys } from './services-payroll';
import styles from './IstPayrollPage.module.css';

const POLL_MS = 30_000;

const ELIGIBILITY_LABEL = {
  ELIGIBLE: 'Eligible',
  INELIGIBLE: 'Not eligible',
  UNDETERMINED: 'Undetermined',
} as const;
const ELIGIBILITY_TONE = {
  ELIGIBLE: 'success',
  INELIGIBLE: 'neutral',
  UNDETERMINED: 'warning',
} as const;

const BlockerList = ({ codes }: { codes: string[] }) => (
  <ul className={styles.blockers}>
    {codes.map((c) => (
      <li key={c}>{performanceBlockerLabel(c)}</li>
    ))}
  </ul>
);

/** Per-staff verified performance for the month (read only). Blocked rows carry no money. */
export function PayrollPerformance({ period }: { period: string }) {
  const [open, setOpen] = useState<{ staff: IstPerformanceStaff; name: string } | null>(null);
  const perf = useQuery({
    queryKey: payrollKeys.performance(period),
    queryFn: () => getIstPerformance(period),
    refetchInterval: POLL_MS,
  });

  if (perf.isPending) return <Skeleton style={{ height: 120 }} />;
  if (perf.isError) return <ErrorState error={perf.error} onRetry={perf.refetch} />;
  const d = perf.data;
  const nameOf = (id: string) => d.staffNames?.[id] ?? null;

  return (
    <div className={styles.form}>
      <h2 className={styles.heading}>Performance evidence — {payrollMonthLabel(period)}</h2>
      {d.ruleBlocker ? (
        <Alert variant="warning" title="Performance rule blocks this month">
          {performanceBlockerLabel(d.ruleBlocker)}
        </Alert>
      ) : d.ruleVersion ? (
        <p className={styles.muted}>Using performance rule v{d.ruleVersion}.</p>
      ) : null}
      {d.unattributed && d.unattributed.count > 0 ? (
        <p className={styles.muted}>
          Unattributed: {d.unattributed.count} {d.unattributed.count === 1 ? 'payment' : 'payments'}{' '}
          totalling {formatMoney(d.unattributed.total)} have no staff seller of record.
        </p>
      ) : null}
      {d.offRoster && d.offRoster.count > 0 ? (
        <p className={styles.muted}>
          Not on the IST roster: {d.offRoster.count}{' '}
          {d.offRoster.count === 1 ? 'payment' : 'payments'} totalling{' '}
          {formatMoney(d.offRoster.total)} belong to a seller who is not an active SM, SSM or SVD,
          so they count for no one.
        </p>
      ) : null}
      {d.staff.length === 0 ? (
        <p className={styles.muted}>No IST performance for this month.</p>
      ) : (
        <div className="table-scroll">
          <Table>
            <TableHead>
              <TableRow>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell>Rank</TableHeaderCell>
                <TableHeaderCell align="right">KPI</TableHeaderCell>
                <TableHeaderCell align="right">Collection</TableHeaderCell>
                <TableHeaderCell align="right">Verified cash</TableHeaderCell>
                <TableHeaderCell align="right">Assumed credit</TableHeaderCell>
                <TableHeaderCell align="right">Adjustments (reported)</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Evidence</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {d.staff.map((s) => {
                const name = nameOf(s.staffId) ?? 'Unnamed staff';
                const blocked = s.status === 'BLOCKED';
                return (
                  <TableRow key={s.staffId}>
                    <TableCell label="Name">{name}</TableCell>
                    <TableCell label="Rank">{s.rank}</TableCell>
                    <TableCell label="KPI" align="right">
                      {formatMoney(s.kpi)}
                    </TableCell>
                    <TableCell label="Collection" align="right">
                      {formatMoney(s.collection)}
                    </TableCell>
                    <TableCell label="Verified cash" align="right">
                      {formatMoney(s.verifiedCash)}
                    </TableCell>
                    <TableCell label="Assumed credit" align="right">
                      {formatMoney(s.assumedCredit)}
                    </TableCell>
                    <TableCell label="Adjustments (reported)" align="right">
                      <div className={styles.stack}>
                        <span>Approved {formatMoney(s.approvedAdjustmentsTotal)}</span>
                        <span className={styles.muted}>
                          Proposed {formatMoney(s.proposedAdjustmentsTotal)}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell label="Status">
                      <div className={styles.stack}>
                        <StatusChip
                          label={blocked ? 'Blocked' : 'Calculable'}
                          tone={blocked ? 'warning' : 'success'}
                        />
                        {blocked ? <BlockerList codes={s.blockers} /> : null}
                      </div>
                    </TableCell>
                    <TableCell label="Evidence">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setOpen({ staff: s, name })}
                      >
                        View evidence ({s.evidenceCount})
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
      {open ? (
        <EvidenceDialog
          period={period}
          staff={open.staff}
          name={open.name}
          onClose={() => setOpen(null)}
        />
      ) : null}
    </div>
  );
}

function EvidenceDialog({
  period,
  staff,
  name,
  onClose,
}: {
  period: string;
  staff: IstPerformanceStaff;
  name: string;
  onClose: () => void;
}) {
  const evidence = useQuery({
    queryKey: payrollKeys.evidence(period, staff.staffId),
    queryFn: () => getIstStaffEvidence(period, staff.staffId),
    refetchInterval: POLL_MS,
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Evidence — ${name}`}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        {evidence.isPending ? (
          <Skeleton style={{ height: 120 }} />
        ) : evidence.isError ? (
          <ErrorState error={evidence.error} onRetry={evidence.refetch} />
        ) : (
          <>
            <p className={styles.muted}>
              {payrollMonthLabel(period)} · {evidence.data.items.length}{' '}
              {evidence.data.items.length === 1 ? 'payment' : 'payments'}
            </p>
            {evidence.data.summary?.status === 'BLOCKED' ? (
              <BlockerList codes={evidence.data.summary.blockers} />
            ) : null}
            {evidence.data.items.length === 0 ? (
              <p className={styles.muted}>No verified payments touch this month.</p>
            ) : (
              <div className="table-scroll">
                <Table>
                  <TableHead>
                    <TableRow>
                      <TableHeaderCell>Sale</TableHeaderCell>
                      <TableHeaderCell>Payment</TableHeaderCell>
                      <TableHeaderCell align="right">Amount</TableHeaderCell>
                      <TableHeaderCell align="right">Eligible TCP contribution</TableHeaderCell>
                      <TableHeaderCell>Paid on</TableHeaderCell>
                      <TableHeaderCell>Verified</TableHeaderCell>
                      <TableHeaderCell>Purpose</TableHeaderCell>
                      <TableHeaderCell>Eligibility</TableHeaderCell>
                      <TableHeaderCell>Count date</TableHeaderCell>
                      <TableHeaderCell>Closing payment</TableHeaderCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {evidence.data.items.map((i) => (
                      <TableRow key={i.paymentId}>
                        <TableCell label="Sale">{i.saleNumber ?? i.reservationNumber ?? i.saleId ?? i.reservationId ?? '—'}</TableCell>
                        <TableCell label="Payment">{i.paymentNumber ?? i.paymentId}</TableCell>
                        <TableCell label="Amount" align="right">
                          {formatMoney(i.amount)}
                        </TableCell>
                        <TableCell label="Eligible TCP contribution" align="right">
                          {formatMoney(i.eligibility === 'ELIGIBLE' && i.isClosingPayment ? i.contractPriceSnapshot : '0.00')}
                        </TableCell>
                        <TableCell label="Paid on">
                          {i.paidOn ? formatDate(i.paidOn) : '—'}
                        </TableCell>
                        <TableCell label="Verified">
                          {i.verifiedAt ? formatDate(i.verifiedAt) : '—'}
                        </TableCell>
                        <TableCell label="Purpose">
                          {i.paymentPurpose ? i.paymentPurpose.replace(/_/g, ' ') : '—'}
                        </TableCell>
                        <TableCell label="Eligibility">
                          <div className={styles.stack}>
                            <StatusChip
                              label={ELIGIBILITY_LABEL[i.eligibility]}
                              tone={ELIGIBILITY_TONE[i.eligibility]}
                            />
                            {i.reasonCode ? (
                              <span className={styles.muted}>
                                {performanceBlockerLabel(i.reasonCode)}
                              </span>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell label="Count date">
                          {i.countDate ? formatDate(i.countDate) : '—'}
                        </TableCell>
                        <TableCell label="Closing payment">
                          {i.isClosingPayment ? 'Yes' : 'No'}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}
