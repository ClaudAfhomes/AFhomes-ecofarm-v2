import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PayrollLine } from '@afhomes/contracts';
import { Button, DetailField, DetailFieldGrid, Dialog, ErrorState, StatusChip } from '@afhomes/ui';
import { addMoney } from '@afhomes/shared';
import { formatMoney, formatRate } from './format';
import { formatDateTime } from '../../lib/format';
import { getPayrollLineCalculation, payrollKeys } from './services-payroll';
import { plainReason } from './PayrollLinesTable';
import styles from './IstPayrollPage.module.css';

export function PayrollLineDetailDialog({
  line,
  action,
  onClose,
}: {
  line: PayrollLine;
  action?: ReactNode;
  onClose: () => void;
}) {
  const saved = useQuery({
    queryKey: [...payrollKeys.all, 'calculation', line.id],
    queryFn: () => getPayrollLineCalculation(line.id),
  });
  const input = saved.data?.inputs;
  const result = saved.data?.result;
  const policy = input?.policySnapshot;
  const total = (key: 'kpi' | 'collection') =>
    input?.qp && input.ep ? formatMoney(addMoney(input.qp[key], input.ep[key])) : 'Not captured';
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Payroll - ${line.staffName ?? 'Staff'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          {action}
        </>
      }
    >
      <div className={styles.form}>
        {saved.data?.mode === 'simulation' ? (
          <StatusChip label="SIMULATION - not payable" tone="warning" />
        ) : null}
        <DetailFieldGrid>
          <DetailField label="Position">{line.rank}</DetailField>
          <DetailField label="Basic allowance">{formatMoney(line.ba)}</DetailField>
          <DetailField label="Performance allowance">{formatMoney(line.pa)}</DetailField>
          <DetailField label="Performance bonus">{formatMoney(line.pb)}</DetailField>
          <DetailField label="Withheld">{formatMoney(line.withheld)}</DetailField>
          <DetailField label="Authorized adjustments">{formatMoney(line.adjustments)}</DetailField>
          <DetailField label="Net payroll">{formatMoney(line.net)}</DetailField>
        </DetailFieldGrid>
        {line.blockedReason ? <p role="note">{plainReason(line.blockedReason)}</p> : null}
        {saved.isPending ? (
          <p role="status">Loading saved calculation...</p>
        ) : saved.isError ? (
          <ErrorState error={saved.error} onRetry={saved.refetch} />
        ) : (
          <>
            <h3>Engagement and qualifying period</h3>
            <DetailFieldGrid>
              <DetailField label="Engagement reference">
                {input?.engagementId ?? 'Not captured'}
              </DetailField>
              <DetailField label="Start date">{input?.contractStart ?? 'Not captured'}</DetailField>
              <DetailField label="End date">
                {input?.contractEnd ?? 'No recorded end date'}
              </DetailField>
              <DetailField label="Qualifying period ends">
                {input?.qualifyingPeriodEnd ?? 'Not captured'}
              </DetailField>
              <DetailField label="QP eligible days">
                {result?.qp?.days ?? 'Not captured'}
              </DetailField>
              <DetailField label="EP eligible days">
                {result?.ep?.days ?? 'Not captured'}
              </DetailField>
              <DetailField label="Days in month">
                {result?.daysInMonth ?? 'Not captured'}
              </DetailField>
              <DetailField label="QP basic allowance decision">
                {input?.qpBaApproved === true
                  ? 'Approved'
                  : input?.qpBaApproved === false
                    ? 'Withheld'
                    : 'Not recorded'}
              </DetailField>
            </DetailFieldGrid>
            <h3>Calculation basis</h3>
            <p className={styles.muted}>
              These are saved inputs and results for this line. Current sales or policy edits do not
              recalculate approved payroll.
            </p>
            <DetailFieldGrid>
              <DetailField label="Production KPI">{total('kpi')}</DetailField>
              <DetailField label="Eligible collections">{total('collection')}</DetailField>
              <DetailField label="Policy reference">
                {line.policyId ?? result?.policyVersion ?? 'Not recorded'}
              </DetailField>
              <DetailField label="Performance rule version">
                {input?.ruleVersion ?? 'Not recorded'}
              </DetailField>
              <DetailField label="QP equivalent TCP">
                {formatMoney(result?.qp?.equivalentTcp)}
              </DetailField>
              <DetailField label="EP equivalent TCP">
                {formatMoney(result?.ep?.equivalentTcp)}
              </DetailField>
            </DetailFieldGrid>
            {policy ? (
              <DetailFieldGrid>
                <DetailField label="Monthly BA / target">
                  {formatMoney(policy.monthlyBa)} / {formatMoney(policy.baTarget)}
                </DetailField>
                <DetailField label="Monthly PA / target">
                  {formatMoney(policy.monthlyPa)} / {formatMoney(policy.paTarget)}
                </DetailField>
                <DetailField label="PB rate / target">
                  {formatRate(policy.pbRate)} / {formatMoney(policy.pbTarget)}
                </DetailField>
                <DetailField label="Collection gate">
                  {formatRate(policy.collectionGate)}
                </DetailField>
              </DetailFieldGrid>
            ) : (
              <p className={styles.muted}>
                Policy parameters were not captured on this older calculation. The saved amounts
                remain authoritative.
              </p>
            )}
            <p className={styles.muted}>
              BA and PA use their approved day factors and qualification gates. PB uses qualified
              equivalent TCP without a second proration.
            </p>
            <h3>Source evidence</h3>
            {input?.performanceEvidence ? (
              <>
                <p>
                  {input.performanceEvidence.items.length} payment records captured when this line
                  was calculated.
                </p>
                <div className="table-scroll">
                  <table className={styles.evidenceTable}>
                    <thead>
                      <tr>
                        <th>Payment</th>
                        <th>Amount</th>
                        <th>Count date</th>
                        <th>Eligible TCP</th>
                        <th>Eligibility</th>
                      </tr>
                    </thead>
                    <tbody>
                      {input.performanceEvidence.items.map((item) => (
                        <tr key={item.paymentId}>
                          <td>{item.paymentNumber ?? item.paymentId}</td>
                          <td>{formatMoney(item.amount)}</td>
                          <td>{item.countDate ?? 'Not counted'}</td>
                          <td>
                            {formatMoney(
                              item.eligibility === 'ELIGIBLE' && item.isClosingPayment
                                ? item.contractPriceSnapshot
                                : '0.00',
                            )}
                          </td>
                          <td>
                            {item.eligibility}
                            {item.reasonCode ? ` - ${plainReason(item.reasonCode)}` : ''}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p className={styles.muted}>No payment-level snapshot was captured for this line.</p>
            )}
          </>
        )}
        <h3>Review and payment history</h3>
        <p>
          {line.reviewedAt
            ? `Reviewed ${formatDateTime(line.reviewedAt)} by ${line.reviewedByName ?? line.reviewedBy ?? 'authorized reviewer'}: ${line.reviewNote ?? ''}`
            : 'No review note recorded.'}
        </p>
        {line.disbursement ? (
          <DetailFieldGrid>
            <DetailField label="Actual payment">
              {formatMoney(line.disbursement.amount)}
            </DetailField>
            <DetailField label="Payment date">{line.disbursement.paidOn}</DetailField>
            <DetailField label="Method">{line.disbursement.method}</DetailField>
            <DetailField label="External reference">{line.disbursement.bankReference}</DetailField>
            <DetailField label="Proof reference">
              {line.disbursement.proofReference ?? 'Not recorded'}
            </DetailField>
            <DetailField label="Reconciliation">
              {line.disbursement.evidenceChanged
                ? line.disbursement.reconciled
                  ? 'Discrepancy reviewed'
                  : 'Evidence discrepancy requires review'
                : 'Matches approved entitlement'}
            </DetailField>
          </DetailFieldGrid>
        ) : (
          <p>No external payment recorded.</p>
        )}
      </div>
    </Dialog>
  );
}
