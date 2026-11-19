import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  Select,
  StatusChip,
  TextAreaField,
  TextField,
  type StatusTone,
} from '@afhomes/ui';
import type {
  Commission,
  CommissionPayout,
  CommissionRecoveryCase,
  CommissionRecoveryTrigger,
} from '@afhomes/contracts';
import { formatMoneyOrDash } from '@afhomes/shared';

import { formatDate } from '../../lib/format';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { useSession } from '../../lib/session';
import { ExternalEvidencePanel } from './ExternalEvidencePanel';
import { businessKeys } from './queryKeys';
import {
  dismissCommissionRecovery,
  getCommissionPayouts,
  getCommissionRecoveries,
  proposeCommissionRecovery,
  reconcileCommissionPayout,
  recordCommissionPayoutFailure,
  setCommissionHold,
} from './services-commission-ops';
import styles from './BusinessCommissionsPage.module.css';

const TRIGGER_LABEL: Record<CommissionRecoveryTrigger, string> = {
  sale_cancellation: 'Sale was cancelled',
  rescission: 'Sale was rescinded',
  downgrade: 'Card was downgraded',
  payment_default: 'Customer defaulted on payments',
  returned_check: 'Payment check was returned',
};

const PAYOUT_LABEL: Record<CommissionPayout['status'], string> = {
  paid: 'Paid',
  failed: 'Transfer failed',
  reconciled: 'Confirmed with bank',
};
const PAYOUT_TONE: Record<CommissionPayout['status'], StatusTone> = {
  paid: 'info',
  failed: 'danger',
  reconciled: 'success',
};

/** Today's calendar date in Asia/Manila (UTC+8, no DST). */
const manilaToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
const MONEY = /^\d+(\.\d{1,2})?$/;

type Props = {
  commission: Commission;
  /** Hold reason known to this session (the commission contract carries no hold field). */
  heldReason: string | null;
  onHeldChange: (reason: string | null) => void;
  onClose: () => void;
};

/**
 * Commission operations for one commission: hold, payout records, and
 * proposed recoveries. Nothing here deducts or moves money.
 */
export function CommissionOpsDialog({ commission, heldReason, onHeldChange, onClose }: Props) {
  const { user } = useSession();
  const mayQualify = user?.afHomesPermissions.some((p) => p.moduleKey === 'network.commissions' && p.canUpdate) === true;
  const mayPay = user?.afHomesPermissions.some((p) => p.moduleKey === 'finance.commission_payouts' && p.canUpdate) === true;
  const client = useQueryClient();
  const id = commission.id;
  const invalidate = () => client.invalidateQueries({ queryKey: businessKeys.commissionsScope });
  const showPayouts = commission.status === 'earned' || commission.status === 'paid';

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Commission operations ${commission.commissionNumber ?? ''}`.trim()}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className={styles.formGrid}>
        <p className={styles.formNote}>
          {commission.beneficiaryName} · {commission.saleNumber} ·{' '}
          {formatMoneyOrDash(commission.amount)}
        </p>
        {mayQualify && commission.status === 'earned' ? (
          <HoldSection
            id={id}
            heldReason={heldReason}
            onChanged={async (reason) => {
              onHeldChange(reason);
              await invalidate();
            }}
          />
        ) : null}
        {showPayouts ? (
          <PayoutsSection
            commission={commission}
            canRecordFailure={mayPay && commission.status === 'earned'}
            canReconcile={mayPay}
            invalidate={invalidate}
          />
        ) : null}
        {mayQualify && commission.status === 'paid' ? <RecoverySection id={id} invalidate={invalidate} /> : null}
      </div>
    </Dialog>
  );
}

function SectionTitle({ children }: { children: string }) {
  return <h3 className={`${styles.fullRow} ${styles.primary}`}>{children}</h3>;
}

function ErrorLine({ error }: { error: Error | null }) {
  return error ? (
    <p role="alert" className={styles.formAlert}>
      {error.message}
    </p>
  ) : null;
}

function HoldSection({
  id,
  heldReason,
  onChanged,
}: {
  id: string;
  heldReason: string | null;
  onChanged: (reason: string | null) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const held = heldReason !== null;
  const mutation = useBusinessMutation({
    mutationFn: () => setCommissionHold(id, { withheld: !held, reason: reason.trim() }),
    onSuccess: async () => {
      const next = held ? null : reason.trim();
      setReason('');
      await onChanged(next);
    },
  });
  return (
    <>
      <SectionTitle>Hold</SectionTitle>
      {held ? (
        <p className={styles.formNote}>
          <StatusChip label="On hold" tone="warning" /> {heldReason}. It cannot be paid until the
          hold is released.
        </p>
      ) : null}
      <div className={styles.fullRow}>
        <TextAreaField
          id="commission-hold-reason"
          name="holdReason"
          label={held ? 'Reason for releasing the hold' : 'Reason for the hold'}
          hint="At least 5 characters. Recorded with your identity."
          value={reason}
          onChange={setReason}
        />
      </div>
      <div className={styles.fullRow}>
        <Button
          variant="secondary"
          disabled={reason.trim().length < 5 || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          {held ? 'Release hold' : 'Put on hold'}
        </Button>
      </div>
      <ErrorLine error={mutation.error} />
    </>
  );
}

function PayoutsSection({
  commission,
  canRecordFailure,
  canReconcile,
  invalidate,
}: {
  commission: Commission;
  canRecordFailure: boolean;
  canReconcile: boolean;
  invalidate: () => Promise<void>;
}) {
  const id = commission.id;
  const key = [...businessKeys.commissionsScope, id, 'payouts'];
  const query = useQuery({ queryKey: key, queryFn: () => getCommissionPayouts(id) });
  const refresh = async () => {
    await invalidate();
  };
  return (
    <>
      <SectionTitle>Payout history</SectionTitle>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.isPending ? (
        <p className={styles.formNote}>Loading payouts…</p>
      ) : query.data.length === 0 ? (
        <EmptyState title="No payouts recorded" description="Nothing has been paid yet." />
      ) : (
        <ul className={styles.fullRow}>
          {query.data.map((payout) => (
            <PayoutRow key={payout.id} payout={payout} canReconcile={canReconcile} onDone={refresh} />
          ))}
        </ul>
      )}
      {canRecordFailure ? <FailureForm id={id} onDone={refresh} /> : null}
    </>
  );
}

function PayoutRow({ payout, canReconcile, onDone }: { payout: CommissionPayout; canReconcile: boolean; onDone: () => Promise<void> }) {
  const [paidOn, setPaidOn] = useState(payout.paidOn ?? manilaToday());
  const [reference, setReference] = useState('');
  const [correction, setCorrection] = useState('');
  const needsReference = !payout.bankReference;
  // Changing a recorded payment date is a correction: it needs a reason and is audited.
  const correcting = Boolean(payout.paidOn) && paidOn !== payout.paidOn;
  const evidenceBlocked =
    payout.evidenceStatus === 'EVIDENCE_EXCEPTION' && !payout.evidenceExceptionReviewed;
  const mutation = useBusinessMutation({
    mutationFn: () =>
      reconcileCommissionPayout(payout.id, {
        paidOn,
        ...(reference.trim() ? { bankReference: reference.trim() } : {}),
        ...(correcting ? { dateCorrectionReason: correction.trim() } : {}),
      }),
    onSuccess: onDone,
  });
  const dateOk = /^\d{4}-\d{2}-\d{2}$/.test(paidOn) && paidOn <= manilaToday();
  const valid =
    dateOk &&
    (!needsReference || reference.trim().length >= 3) &&
    (!correcting || correction.trim().length >= 5) &&
    !evidenceBlocked;
  return (
    <li className={styles.formGrid}>
      <span>
        <StatusChip label={PAYOUT_LABEL[payout.status]} tone={PAYOUT_TONE[payout.status]} />{' '}
        <strong>{formatMoneyOrDash(payout.amount)}</strong>
      </span>
      <span className={styles.secondary}>
        Ref {payout.bankReference ?? '—'} · recorded {formatDate(payout.recordedAt)}
        {payout.paidOn ? ` · paid ${formatDate(payout.paidOn)}` : ''}
        {payout.postingPeriod ? ` · posted to ${payout.postingPeriod}` : ''}
        {payout.failureReason ? ` · ${payout.failureReason}` : ''}
      </span>
      {payout.status !== 'failed' ? (
        <ExternalEvidencePanel
          subject="commission_payout"
          id={payout.id}
          canRecord={canReconcile && payout.status === 'paid'}
          canReviewException={canReconcile && payout.status === 'paid'}
          paymentAmount={payout.amount}
          onChanged={onDone}
        />
      ) : null}
      {canReconcile && payout.status === 'paid' ? (
        <>
          <TextField
            id={`payout-paid-on-${payout.id}`}
            name="paidOn"
            label="Date on bank statement"
            hint="YYYY-MM-DD, Manila date. Not in the future."
            value={paidOn}
            onChange={setPaidOn}
          />
          {correcting ? (
            <TextField
              id={`payout-date-correction-${payout.id}`}
              name="dateCorrectionReason"
              label="Reason for changing the recorded date"
              hint={`Recorded date is ${formatDate(payout.paidOn!)}. At least 5 characters; audited.`}
              value={correction}
              onChange={setCorrection}
            />
          ) : null}
          {evidenceBlocked ? (
            <p className={`${styles.fullRow} ${styles.formNote}`}>
              Attach verifiable evidence or record an exception review before confirming.
            </p>
          ) : null}
          {needsReference ? (
            <TextField
              id={`payout-ref-${payout.id}`}
              name="bankReference"
              label="Bank reference"
              value={reference}
              onChange={setReference}
            />
          ) : null}
          <div className={styles.fullRow}>
            <Button
              size="sm"
              disabled={!valid || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              Reconcile Commission Payout
            </Button>
          </div>
          <ErrorLine error={mutation.error} />
        </>
      ) : null}
    </li>
  );
}

function FailureForm({ id, onDone }: { id: string; onDone: () => Promise<void> }) {
  const [reason, setReason] = useState('');
  const [reference, setReference] = useState('');
  const mutation = useBusinessMutation({
    mutationFn: () =>
      recordCommissionPayoutFailure(id, { reason: reason.trim(), bankReference: reference.trim() }),
    onSuccess: async () => {
      setReason('');
      setReference('');
      await onDone();
    },
  });
  return (
    <>
      <SectionTitle>Record failed transfer</SectionTitle>
      <TextField
        id="payout-failure-reference"
        name="failureReference"
        label="Bank reference of the failed transfer"
        value={reference}
        onChange={setReference}
      />
      <TextAreaField
        id="payout-failure-reason"
        name="failureReason"
        label="What went wrong"
        hint="At least 5 characters."
        value={reason}
        onChange={setReason}
      />
      <div className={styles.fullRow}>
        <Button
          variant="secondary"
          disabled={reason.trim().length < 5 || !reference.trim() || mutation.isPending}
          onClick={() => mutation.mutate()}
        >
          Record failed transfer
        </Button>
      </div>
      <ErrorLine error={mutation.error} />
    </>
  );
}

function RecoverySection({ id, invalidate }: { id: string; invalidate: () => Promise<void> }) {
  const key = [...businessKeys.commissionsScope, id, 'recoveries'];
  const query = useQuery({ queryKey: key, queryFn: () => getCommissionRecoveries(id) });
  const [trigger, setTrigger] = useState<CommissionRecoveryTrigger>('sale_cancellation');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const propose = useBusinessMutation({
    mutationFn: () =>
      proposeCommissionRecovery(id, { trigger, amount: amount.trim(), reason: reason.trim() }),
    onSuccess: async () => {
      setAmount('');
      setReason('');
      await invalidate();
    },
  });
  const amountOk = MONEY.test(amount.trim()) && /[1-9]/.test(amount);
  return (
    <>
      <SectionTitle>Recovery</SectionTitle>
      <p className={styles.formNote}>Proposal only — no money is deducted.</p>
      {query.isError ? (
        <ErrorState error={query.error} onRetry={query.refetch} />
      ) : query.data && query.data.length > 0 ? (
        <ul className={styles.fullRow}>
          {query.data.map((item) => (
            <RecoveryRow key={item.id} item={item} onDone={invalidate} />
          ))}
        </ul>
      ) : null}
      <label className={styles.filterLabel}>
        Why
        <Select
          aria-label="Recovery reason type"
          value={trigger}
          onChange={(e) => setTrigger(e.target.value as CommissionRecoveryTrigger)}
          options={Object.entries(TRIGGER_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </label>
      <TextField
        id="recovery-amount"
        name="recoveryAmount"
        label="Proposed amount"
        inputMode="decimal"
        hint="Peso amount, e.g. 1500.00"
        value={amount}
        onChange={setAmount}
      />
      <TextAreaField
        id="recovery-reason"
        name="recoveryReason"
        label="Reason"
        hint="At least 5 characters."
        value={reason}
        onChange={setReason}
      />
      <div className={styles.fullRow}>
        <Button
          variant="secondary"
          disabled={!amountOk || reason.trim().length < 5 || propose.isPending}
          onClick={() => propose.mutate()}
        >
          Propose recovery
        </Button>
      </div>
      <ErrorLine error={propose.error} />
    </>
  );
}

function RecoveryRow({
  item,
  onDone,
}: {
  item: CommissionRecoveryCase;
  onDone: () => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const dismiss = useBusinessMutation({
    mutationFn: () => dismissCommissionRecovery(item.id, { reason: reason.trim() }),
    onSuccess: onDone,
  });
  return (
    <li className={styles.formGrid}>
      <span>
        <StatusChip
          label={item.status === 'proposed' ? 'Proposed' : 'Dismissed'}
          tone={item.status === 'proposed' ? 'warning' : 'info'}
        />{' '}
        <strong>{formatMoneyOrDash(item.proposedAmount)}</strong> · {TRIGGER_LABEL[item.trigger]}
      </span>
      <span className={styles.secondary}>{item.reason}</span>
      {item.status === 'proposed' ? (
        <>
          <TextField
            id={`dismiss-reason-${item.id}`}
            name="dismissReason"
            label="Reason for dismissing"
            value={reason}
            onChange={setReason}
          />
          <div className={styles.fullRow}>
            <Button
              size="sm"
              variant="secondary"
              disabled={reason.trim().length < 5 || dismiss.isPending}
              onClick={() => dismiss.mutate()}
            >
              Dismiss
            </Button>
          </div>
          <ErrorLine error={dismiss.error} />
        </>
      ) : null}
    </li>
  );
}
