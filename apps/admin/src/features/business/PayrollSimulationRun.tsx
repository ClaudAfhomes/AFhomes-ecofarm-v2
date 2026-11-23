import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PayrollLine } from '@afhomes/contracts';
import {
  Alert,
  Button,
  ErrorState,
  Skeleton,
  StatusChip,
  TextField,
  notifySuccess,
} from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { formatMoney } from './format';
import { PayrollDisbursementDialog } from './PayrollDisbursementDialog';
import { PayrollLinesTable } from './PayrollLinesTable';
import { BATCH_STATUS_LABEL, BATCH_STATUS_TONE } from './payroll-status';
import { REASON_MIN, errorMessage, payrollMonthLabel } from './payroll-utils';
import {
  approvePayrollBatch,
  closePayrollBatch,
  getPayrollBatch,
  payrollKeys,
  returnPayrollBatch,
  submitPayrollBatch,
} from './services-payroll';
import styles from './IstPayrollPage.module.css';

interface Props {
  batchId: string;
  userId: string | undefined;
  canSubmit: boolean;
  canApprove: boolean;
  canClose: boolean;
  canPay: boolean;
}

/**
 * One simulation batch and its single next step. Every control here acts on
 * the isolated simulation records; nothing reaches real finance totals.
 */
export function PayrollSimulationRun({
  batchId,
  userId,
  canSubmit,
  canApprove,
  canClose,
  canPay,
}: Props) {
  const client = useQueryClient();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState<PayrollLine | null>(null);

  const detail = useQuery({
    queryKey: payrollKeys.batch(batchId),
    queryFn: () => getPayrollBatch(batchId),
  });

  const act = useBusinessMutation({
    mutationFn: async (kind: 'submit' | 'approve' | 'return' | 'close') => {
      if (kind === 'submit') return submitPayrollBatch(batchId);
      if (kind === 'approve') return approvePayrollBatch(batchId);
      if (kind === 'close') return closePayrollBatch(batchId);
      return returnPayrollBatch(batchId, reason.trim());
    },
    onSuccess: async () => {
      setReturning(false);
      setReason('');
      setError(null);
      notifySuccess({ title: 'Simulation updated' });
      await client.invalidateQueries({ queryKey: payrollKeys.all });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  if (detail.isPending) return <Skeleton style={{ height: 160 }} />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={detail.refetch} />;

  const b = detail.data;
  const mine = Boolean(b.submittedBy && b.submittedBy === userId);

  const next = () => {
    if (b.status === 'draft' || b.status === 'returned') {
      if (!canSubmit) return null;
      const block =
        b.blockedLineCount > 0
          ? `${b.blockedLineCount} ${b.blockedLineCount === 1 ? 'line needs' : 'lines need'} configuration`
          : b.lineCount === 0
            ? 'There are no staff lines.'
            : null;
      return (
        <div className={styles.actions}>
          <Button
            loading={act.isPending}
            disabled={block !== null}
            onClick={() => act.mutate('submit')}
          >
            Submit simulation
          </Button>
          {block ? <span className={styles.muted}>{block}</span> : null}
        </div>
      );
    }
    if (b.status === 'submitted') {
      if (!canApprove) return <p className={styles.waiting}>Waiting for approval</p>;
      return (
        <div className={styles.actions}>
          <Button loading={act.isPending} disabled={mine} onClick={() => act.mutate('approve')}>
            Approve simulation
          </Button>
          <Button variant="secondary" disabled={mine} onClick={() => setReturning(true)}>
            Return
          </Button>
          {mine ? <span className={styles.muted}>You submitted this batch.</span> : null}
        </div>
      );
    }
    if (b.status === 'approved') {
      if (!canClose) return null;
      return (
        <div className={styles.actions}>
          <Button loading={act.isPending} disabled={mine} onClick={() => act.mutate('close')}>
            Close simulation
          </Button>
          {mine ? <span className={styles.muted}>The submitter cannot close.</span> : null}
        </div>
      );
    }
    return null;
  };

  return (
    <div className={styles.form}>
      <h3 className={styles.heading}>
        Simulation — {payrollMonthLabel(b.period)} <StatusChip label="SIMULATION" tone="warning" />{' '}
        <StatusChip label={BATCH_STATUS_LABEL[b.status]} tone={BATCH_STATUS_TONE[b.status]} />
      </h3>
      <p className={styles.muted}>
        Simulated net total {formatMoney(b.simulationTotalNet)} · {b.blockedLineCount} needing
        configuration. No real money or records are affected.
      </p>

      {next()}

      {returning ? (
        <div className={styles.actions}>
          <TextField
            id="sim-return-reason"
            name="reason"
            label="Reason"
            value={reason}
            onChange={setReason}
            hint={`At least ${REASON_MIN} characters.`}
          />
          <Button
            loading={act.isPending}
            disabled={reason.trim().length < REASON_MIN}
            onClick={() => act.mutate('return')}
          >
            Confirm return
          </Button>
          <Button variant="secondary" onClick={() => setReturning(false)}>
            Cancel
          </Button>
        </div>
      ) : null}

      {error && !paying ? (
        <Alert variant="danger" title="Not done">
          {error}
        </Alert>
      ) : null}

      <PayrollLinesTable
        lines={b.lines}
        onDisburse={
          b.status === 'approved' && canPay
            ? (line) => {
                setError(null);
                setPaying(line);
              }
            : undefined
        }
        payoutLabel="Record simulated payout"
      />

      {paying ? (
        <PayrollDisbursementDialog
          simulated
          line={paying}
          onClose={() => setPaying(null)}
          onDone={async () => {
            setPaying(null);
            notifySuccess({ title: 'Simulated payout recorded' });
            await client.invalidateQueries({ queryKey: payrollKeys.all });
          }}
        />
      ) : null}
    </div>
  );
}
