import { useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, StatusChip, TextField, buttonClassName, notifySuccess } from '@afhomes/ui';

import { formatMoney } from '../business/format';
import {
  REASON_MIN,
  errorMessage,
  hasPayrollPermission,
  payrollMonthLabel,
} from '../business/payroll-utils';
import {
  approvePayrollBatch,
  getPayrollApprovals,
  payrollKeys,
  returnPayrollBatch,
} from '../business/services-payroll';
import { useSession } from '../../lib/session';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import styles from './PendingPayrollApprovalsCard.module.css';

/**
 * Super Admin card: submitted payroll batches with one-click Approve / Return.
 * Visible only with `finance.payroll_approval` view (UX only; the server decides).
 */
export function PendingPayrollApprovalsCard() {
  const { user } = useSession();
  const client = useQueryClient();
  const canView = hasPayrollPermission(user, 'finance.payroll_approval', 'canView');
  const canDecide = hasPayrollPermission(user, 'finance.payroll_approval', 'canUpdate');

  const [returningId, setReturningId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const approvals = useQuery({
    queryKey: payrollKeys.approvals,
    queryFn: getPayrollApprovals,
    enabled: canView,
    refetchInterval: 30_000,
  });

  const decide = useBusinessMutation({
    mutationFn: ({ id, kind }: { id: string; kind: 'approve' | 'return' }) =>
      kind === 'approve' ? approvePayrollBatch(id) : returnPayrollBatch(id, reason.trim()),
    onSuccess: async (_d, { kind }) => {
      setReturningId(null);
      setApprovingId(null);
      setReason('');
      setError(null);
      notifySuccess({ title: kind === 'approve' ? 'Batch approved' : 'Batch returned' });
      await client.invalidateQueries({ queryKey: payrollKeys.all });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (!canView) return null;
  const items = approvals.data ?? [];

  return (
    <section className={styles.card} aria-label="Pending payroll approvals">
      <div className={styles.head}>
        <h2 className={styles.title}>Pending payroll approvals</h2>
        <Link to="/admin/finance/payroll" className={buttonClassName('ghost', 'sm')}>
          Open payroll
        </Link>
      </div>
      {approvals.isError ? (
        <p className={styles.muted}>{errorMessage(approvals.error)}</p>
      ) : approvals.isPending ? (
        <p className={styles.muted}>Loading…</p>
      ) : items.length === 0 ? (
        <p className={styles.muted}>Nothing waiting</p>
      ) : (
        <ul className={styles.list}>
          {items.map((b) => {
            const mine = Boolean(b.submittedBy && b.submittedBy === user?.id);
            return (
              <li key={b.batchId} className={styles.item}>
                <div className={styles.row}>
                  <span>
                    <strong>{payrollMonthLabel(b.period)}</strong>{' '}
                    {b.mode === 'simulation' ? (
                      <StatusChip label="SIMULATION" tone="warning" />
                    ) : null}
                    <span className={styles.muted}>
                      {' '}
                      · {b.lineCount} lines ·{' '}
                      {b.mode === 'simulation'
                        ? `Simulated ${formatMoney(b.totalNet)} (not real money)`
                        : formatMoney(b.totalNet)}
                    </span>
                  </span>
                  {canDecide ? (
                    <span className={styles.buttons}>
                      <Button
                        size="sm"
                        disabled={mine}
                        onClick={() => {
                          setError(null);
                          setReturningId(null);
                          setApprovingId(b.batchId);
                        }}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setError(null);
                          setReason('');
                          setApprovingId(null);
                          setReturningId(b.batchId);
                        }}
                      >
                        Return
                      </Button>
                    </span>
                  ) : null}
                </div>
                {mine ? (
                  <span className={styles.muted}>
                    You submitted this batch; another approver must decide.
                  </span>
                ) : null}
                {approvingId === b.batchId ? (
                  <div className={styles.returnRow} role="group" aria-label="Confirm approval">
                    <span>
                      Approve {payrollMonthLabel(b.period)} payroll: {b.lineCount} lines,{' '}
                      {b.mode === 'simulation'
                        ? `simulated ${formatMoney(b.totalNet)}`
                        : formatMoney(b.totalNet)}
                      ?
                    </span>
                    <Button
                      size="sm"
                      loading={decide.isPending}
                      onClick={() => decide.mutate({ id: b.batchId, kind: 'approve' })}
                    >
                      Confirm approval
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setApprovingId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
                {returningId === b.batchId ? (
                  <div className={styles.returnRow}>
                    <TextField
                      id={`return-${b.batchId}`}
                      name="reason"
                      label="Reason"
                      value={reason}
                      onChange={setReason}
                      hint={`At least ${REASON_MIN} characters.`}
                    />
                    <Button
                      size="sm"
                      loading={decide.isPending}
                      disabled={reason.trim().length < REASON_MIN}
                      onClick={() => decide.mutate({ id: b.batchId, kind: 'return' })}
                    >
                      Confirm return
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setReturningId(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? (
        <Alert variant="danger" title="Not done">
          {error}
        </Alert>
      ) : null}
    </section>
  );
}
