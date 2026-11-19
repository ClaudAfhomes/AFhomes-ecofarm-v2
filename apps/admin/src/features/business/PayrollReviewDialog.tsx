import { useState } from 'react';
import type { PayrollLine } from '@afhomes/contracts';
import { Alert, Button, Dialog, TextAreaField, TextField } from '@afhomes/ui';

import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { errorMessage, reviewFlagLabel } from './payroll-utils';
import { reconcilePayrollDisbursement, reviewPayrollLine } from './services-payroll';
import styles from './IstPayrollPage.module.css';

/** Finance note that clears a flagged line so the batch can be submitted. */
export function PayrollReviewDialog({
  line,
  onClose,
  onDone,
  reconciliation = false,
}: {
  line: PayrollLine;
  onClose: () => void;
  onDone: () => Promise<void>;
  reconciliation?: boolean;
}) {
  const [note, setNote] = useState('');
  const [evidenceReference, setEvidenceReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const run = useBusinessMutation({
    mutationFn: () => reconciliation
      ? reconcilePayrollDisbursement(line.disbursement!.id, { note: note.trim(), evidenceReference: evidenceReference.trim() })
      : reviewPayrollLine(line.id, { note: note.trim() }),
    onSuccess: onDone,
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Review ${line.staffName ?? 'line'}`}
      footer={
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={run.isPending}
            disabled={note.trim().length < 5 || (reconciliation && evidenceReference.trim().length < 10)}
            onClick={() => run.mutate()}
          >
            Record review
          </Button>
        </div>
      }
    >
      <div className={styles.form}>
        <p className={styles.muted}>{reconciliation
          ? 'Review the external payment and the evidence discrepancy. The approved entitlement stays recorded at its original amount.'
          : line.reviewFlags.map(reviewFlagLabel).join('; ')}</p>
        {reconciliation ? (
          <TextField id="payroll-reconciliation-evidence" name="evidenceReference" label="Reconciliation evidence reference" value={evidenceReference} onChange={setEvidenceReference} />
        ) : null}
        <TextAreaField
          id="payroll-review-note"
          name="note"
          label="Review note"
          value={note}
          onChange={setNote}
          hint="At least 5 characters."
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
