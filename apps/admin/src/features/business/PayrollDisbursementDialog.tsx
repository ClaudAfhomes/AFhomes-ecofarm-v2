import { useState } from 'react';
import type { PayrollLine } from '@afhomes/contracts';
import { Alert, Button, DateField, Dialog, Select, StatusChip, TextField } from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { errorMessage, manilaToday } from './payroll-utils';
import { recordPayrollDisbursement, recordSimulatedPayrollDisbursement } from './services-payroll';
import styles from './IstPayrollPage.module.css';

const METHODS = ['Bank transfer', 'Cheque', 'Cash', 'E-wallet'];

interface Props {
  line: PayrollLine;
  /** A simulation line uses its own route and never touches real records. */
  simulated?: boolean;
  onClose: () => void;
  onDone: () => Promise<void>;
}

/** Amount is pre-filled from the line net pay and read-only. */
export function PayrollDisbursementDialog({ line, simulated = false, onClose, onDone }: Props) {
  const [method, setMethod] = useState(METHODS[0] as string);
  const [bankReference, setBankReference] = useState('');
  const [proofReference, setProofReference] = useState('');
  const [paidOn, setPaidOn] = useState(manilaToday());
  const [error, setError] = useState<string | null>(null);
  const title = simulated ? 'Record simulated payout' : 'Record disbursement';

  const record = useBusinessMutation({
    mutationFn: () =>
      (simulated ? recordSimulatedPayrollDisbursement : recordPayrollDisbursement)(line.id, {
        amount: line.net as string,
        method,
        bankReference: bankReference.trim(),
        ...(!simulated && proofReference.trim() ? { proofReference: proofReference.trim() } : {}),
        paidOn,
      }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });

  return (
    <Dialog
      open
      onClose={() => {
        if (!record.isPending) onClose();
      }}
      title={`${title} — ${line.staffName ?? 'staff'}`}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" disabled={record.isPending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={record.isPending}
            disabled={
              bankReference.trim().length < 3 ||
              !paidOn ||
              paidOn > manilaToday() ||
              paidOn < '2000-01-01' ||
              (!simulated && proofReference.trim().length < 10)
            }
            onClick={() => record.mutate()}
          >
            {title}
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        {simulated ? (
          <div className={styles.badge}>
            <StatusChip label="SIMULATION — not payable" tone="warning" />
          </div>
        ) : null}
        <TextField
          id="disb-amount"
          name="amount"
          label="Amount (from net pay)"
          value={line.net ?? ''}
          onChange={() => undefined}
          readOnly
        />
        <label className={styles.field}>
          Method
          <Select
            aria-label="Method"
            value={method}
            onChange={(event) => setMethod(event.target.value)}
            options={METHODS.map((m) => ({ value: m, label: m }))}
          />
        </label>
        <TextField
          id="disb-ref"
          name="bankReference"
          label="Bank reference"
          value={bankReference}
          onChange={setBankReference}
          hint="At least 3 characters."
        />
        {!simulated ? (
          <TextField
            id="disb-proof"
            name="proofReference"
            label="Payment description"
            value={proofReference}
            onChange={setProofReference}
            hint="What was paid and how, at least 10 characters. A description is not proof: attach a document, transaction reference or OR number with Evidence after recording."
          />
        ) : null}
        <DateField
          id="disb-date"
          name="paidOn"
          label="Paid on"
          value={paidOn}
          max={manilaToday()}
          min="2000-01-01"
          onChange={setPaidOn}
        />
        {error ? (
          <Alert variant="danger" title="Not done">
            {error}
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
