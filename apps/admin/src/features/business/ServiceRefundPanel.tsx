import { useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import {
  Alert,
  Button,
  Dialog,
  ErrorState,
  FileField,
  Select,
  Skeleton,
  StatusChip,
  TextAreaField,
  TextField,
  notifyConfirm,
  notifySuccess,
} from '@afhomes/ui';
import { useSession } from '../../lib/session';
import {
  listServiceRefunds,
  requestServiceRefund,
  decideServiceRefund,
  recordServiceRefundRepayment,
  getServiceRefundReceipt,
  reconcileServiceRefundReceipt,
  type PurchaseRow,
} from './points-services';
import { formatMoneyOrDash } from '@afhomes/shared';
import { earningKeys } from './queryKeys';

export function ServiceRefundPanel({ purchase }: { purchase: PurchaseRow }) {
  const mayReview =
    useSession().user?.afHomesPermissions?.some(
      (p) => p.moduleKey === 'operations.payments' && p.canUpdate,
    ) ?? false;
  const [open, setOpen] = useState(false);
  const [serviceValue, setServiceValue] = useState('');
  const [cashAmount, setCashAmount] = useState('');
  const [reason, setReason] = useState('');
  const [reconciliationReason, setReconciliationReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<'cash' | 'bank_transfer' | 'gcash' | 'other'>('cash');
  const [externalReference, setExternalReference] = useState('');
  const [repaidAt, setRepaidAt] = useState('');
  const [receipt, setReceipt] = useState<
    { mimeType: 'image/jpeg' | 'image/png' | 'application/pdf'; dataBase64: string } | undefined
  >();
  const [receiptError, setReceiptError] = useState('');
  const [receiptReading, setReceiptReading] = useState(false);
  const receiptRevision = useRef(0);
  const receiptGrant = useBusinessMutation({
    mutationFn: ({ refundId, repaymentId }: { refundId: string; repaymentId: string }) =>
      getServiceRefundReceipt(purchase.id, refundId, repaymentId),
    retry: false,
  });
  const reference = useRef<string | null>(null);
  const confirming = useRef(false);
  const [confirmingOpen, setConfirmingOpen] = useState(false);
  const client = useQueryClient();
  const history = useQuery({
    queryKey: earningKeys.serviceRefunds(purchase.id),
    queryFn: () => listServiceRefunds(purchase.id),
    enabled: open,
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });
  const save = useBusinessMutation({
    mutationFn: async (action: {
      kind: 'request' | 'approve' | 'reject' | 'cancel' | 'repay';
      id?: string;
    }) => {
      if (action.kind === 'request') {
        reference.current ??= crypto.randomUUID();
        return requestServiceRefund(purchase.id, {
          serviceValue,
          cashAmount,
          reference: reference.current,
          reason,
          serviceReviewConfirmed: true,
        });
      }
      if (!action.id) throw new Error('Choose a refund');
      if (action.kind === 'repay')
        return recordServiceRefundRepayment(purchase.id, action.id, {
          amount,
          method,
          reference: externalReference,
          repaidAt: new Date(repaidAt).toISOString(),
          ...(receipt ? { receipt } : {}),
        });
      return decideServiceRefund(purchase.id, action.id, action.kind);
    },
    retry: false,
    onSuccess: () => {
      reference.current = null;
      void client.invalidateQueries({ queryKey: earningKeys.all });
      setAmount('');
      setExternalReference('');
      setReceipt(undefined);
      notifySuccess({ title: 'Refund history updated' });
    },
  });
  const reconciliation = useBusinessMutation({
    mutationFn: ({ refundId, auditId }: { refundId: string; auditId: string }) =>
      reconcileServiceRefundReceipt(purchase.id, refundId, auditId, reconciliationReason),
    retry: false,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: earningKeys.all });
    },
  });
  const reconcile = async (refundId: string, auditId: string) => {
    if (confirming.current || save.isPending || reconciliation.isPending) return;
    confirming.current = true;
    setConfirmingOpen(true);
    try {
      if (
        await notifyConfirm({
          title: 'Reconcile this receipt attempt?',
          message:
            'A receipt already used by a repayment is preserved. Otherwise only this abandoned upload is removed. This does not record or repay cash.',
          confirmButtonText: 'Reconcile receipt',
        })
      )
        await reconciliation.mutateAsync({ refundId, auditId });
    } catch {
      /* The mutation error is displayed below. */
    } finally {
      confirming.current = false;
      setConfirmingOpen(false);
    }
  };
  const busy = save.isPending || reconciliation.isPending || confirmingOpen;
  const act = async (kind: 'request' | 'approve' | 'reject' | 'cancel' | 'repay', id?: string) => {
    if (confirming.current || save.isPending) return;
    confirming.current = true;
    setConfirmingOpen(true);
    try {
      if (
        await notifyConfirm({
          title:
            kind === 'repay'
              ? 'Record money already repaid externally?'
              : 'Record this Finance refund decision?',
          message:
            kind === 'repay'
              ? 'Record only a repayment actually completed outside this system. No money will be sent.'
              : 'Approval restores eligible points once. Cash remains outstanding until an actual external repayment is recorded.',
          confirmButtonText: 'Record Finance decision',
        })
      )
        await save.mutateAsync({ kind, id });
    } catch {
      /* Mutation error is displayed below. */
    } finally {
      confirming.current = false;
      setConfirmingOpen(false);
    }
  };
  if (!mayReview || !['completed', 'reversed'].includes(purchase.status)) return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Manage refunds: {purchase.purchaseNumber}
      </Button>
      {open && (
        <Dialog
          open
          title={'Finance refunds: ' + purchase.purchaseNumber}
          onClose={() => {
            if (!busy) setOpen(false);
          }}
        >
          <Alert variant="info" title="External repayment only">
            Record a refund request, review it, then record cash actually repaid externally.
            Approval alone does not repay cash.
          </Alert>
          <TextField
            id="refund-service-value"
            name="serviceValue"
            label="Eligible service value"
            optional
            inputMode="decimal"
            value={serviceValue}
            disabled={busy}
            onChange={(value) => {
              setServiceValue(value);
              reference.current = null;
            }}
          />
          <TextField
            id="refund-cash-amount"
            name="cashAmount"
            label="Cash repayment requested"
            optional
            inputMode="decimal"
            value={cashAmount}
            disabled={busy}
            onChange={(value) => {
              setCashAmount(value);
              reference.current = null;
            }}
          />
          <TextAreaField
            id="refund-reason"
            name="refundReason"
            label="Refund reason"
            optional
            value={reason}
            disabled={busy}
            onChange={(value) => {
              setReason(value);
              reference.current = null;
            }}
          />
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              disabled={busy}
              onChange={(e) => setReviewed(e.target.checked)}
            />
            I reviewed service delivery, consumed-service eligibility and attributable refund
            amounts.
          </label>
          <Button
            disabled={busy || !reviewed || !serviceValue || !cashAmount || reason.trim().length < 3}
            loading={save.isPending}
            onClick={() => void act('request')}
          >
            Submit for approval
          </Button>
          {history.isLoading && (
            <div role="status" aria-label="Loading refund history">
              <Skeleton />
              <Skeleton />
            </div>
          )}
          {history.isError && (
            <ErrorState
              error={history.error}
              onRetry={() => void history.refetch()}
              title="Refund history unavailable"
            />
          )}
          {save.isError && <ErrorState error={save.error} title="Refund not recorded" />}
          {history.data?.length === 0 && <p>No refund requests yet.</p>}
          {(history.data ?? []).map((refund) => (
            <section key={refund.id} aria-label={'Refund ' + refund.reference}>
              <h3>
                {refund.reference}: {refund.status.replaceAll('_', ' ')}
              </h3>
              <p>
                <StatusChip label={refund.status} />
              </p>
              <dl>
                <dt>Requested cash</dt>
                <dd>{formatMoneyOrDash(refund.cashAmount)}</dd>
                <dt>Cash repaid</dt>
                <dd>{formatMoneyOrDash(refund.cashRepaid)}</dd>
                <dt>Cash outstanding</dt>
                <dd>{formatMoneyOrDash(refund.cashOutstanding)}</dd>
                <dt>Points restored</dt>
                <dd>{refund.pointsRestored.toLocaleString('en-PH')}</dd>
                <dt>Earned points adjusted</dt>
                <dd>{refund.earnedPointsAdjusted.toLocaleString('en-PH')}</dd>
              </dl>
              {refund.status === 'pending_approval' && (
                <>
                  <Button
                    disabled={busy || !reviewed}
                    onClick={() => void act('approve', refund.id)}
                  >
                    Approve refund
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act('reject', refund.id)}
                  >
                    Reject
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void act('cancel', refund.id)}
                  >
                    Cancel request
                  </Button>
                </>
              )}
              {['approved_pending_repayment', 'partially_repaid'].includes(refund.status) && (
                <>
                  <TextField
                    id="refund-repaid-amount"
                    name="repaidAmount"
                    label="Amount actually repaid"
                    optional
                    inputMode="decimal"
                    value={amount}
                    disabled={busy}
                    onChange={setAmount}
                  />
                  <label>
                    Repayment method
                    <Select
                      value={method}
                      disabled={busy}
                      onChange={(e) => {
                        const next = e.target.value;
                        if (
                          next === 'cash' ||
                          next === 'bank_transfer' ||
                          next === 'gcash' ||
                          next === 'other'
                        )
                          setMethod(next);
                      }}
                      options={[
                        { value: 'cash', label: 'Cash' },
                        { value: 'bank_transfer', label: 'Bank Transfer' },
                        { value: 'gcash', label: 'GCash' },
                        { value: 'other', label: 'Other' },
                      ]}
                    />
                  </label>
                  <TextField
                    id="refund-external-reference"
                    name="externalReference"
                    label="External transaction reference"
                    optional
                    value={externalReference}
                    disabled={busy}
                    onChange={setExternalReference}
                  />
                  <label>
                    Actual repayment date
                    <input
                      type="datetime-local"
                      value={repaidAt}
                      disabled={busy}
                      onChange={(e) => setRepaidAt(e.target.value)}
                    />
                  </label>
                  <FileField
                    id="refund-receipt"
                    name="receipt"
                    label="Supporting receipt"
                    optional
                    accept="image/jpeg,image/png,application/pdf"
                    disabled={busy}
                    onSelect={async (file) => {
                      const revision = ++receiptRevision.current;
                      setReceiptReading(false);
                      setReceipt(undefined);
                      setReceiptError('');
                      if (!file) return;
                      if (
                        file.size > 3 * 1024 * 1024 ||
                        (file.type !== 'image/jpeg' &&
                          file.type !== 'image/png' &&
                          file.type !== 'application/pdf')
                      ) {
                        setReceiptError('Choose a JPEG, PNG or PDF up to 3 MiB.');
                        return;
                      }
                      const mimeType = file.type;
                      setReceiptReading(true);
                      try {
                        const dataBase64 = await new Promise<string>((resolve, reject) => {
                          const reader = new FileReader();
                          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
                          reader.onerror = () => reject(new Error('Receipt could not be read'));
                          reader.readAsDataURL(file);
                        });
                        if (revision === receiptRevision.current)
                          setReceipt({ mimeType, dataBase64 });
                      } catch {
                        if (revision === receiptRevision.current)
                          setReceiptError('Receipt could not be read.');
                      } finally {
                        if (revision === receiptRevision.current) setReceiptReading(false);
                      }
                    }}
                  />
                  {receiptError && <p role="alert">{receiptError}</p>}
                  <Button
                    disabled={
                      busy ||
                      receiptReading ||
                      Boolean(receiptError) ||
                      !amount ||
                      externalReference.trim().length < 3 ||
                      !repaidAt
                    }
                    loading={save.isPending}
                    onClick={() => void act('repay', refund.id)}
                  >
                    Record external repayment
                  </Button>
                </>
              )}
              {Boolean(refund.receiptAttempts?.length) && (
                <>
                  <TextAreaField
                    id="refund-reconciliation-note"
                    name="reconciliationReason"
                    label="Receipt reconciliation review note"
                    optional
                    value={reconciliationReason}
                    disabled={busy}
                    onChange={setReconciliationReason}
                  />
                  {refund.receiptAttempts?.map((attempt) => (
                    <p key={attempt.auditId}>
                      Receipt attempt: {attempt.reference} -{' '}
                      {new Date(attempt.preparedAt).toLocaleString('en-PH')} - {attempt.status}
                      <Button
                        variant="secondary"
                        disabled={busy || reconciliationReason.trim().length < 3}
                        loading={reconciliation.isPending}
                        onClick={() => void reconcile(refund.id, attempt.auditId)}
                      >
                        Reconcile receipt attempt
                      </Button>
                    </p>
                  ))}
                </>
              )}
              {refund.repayments.map((payment) => (
                <p key={payment.id}>
                  {formatMoneyOrDash(payment.amount)} · {payment.method.replaceAll('_', ' ')} ·{' '}
                  {payment.reference} · {new Date(payment.repaidAt).toLocaleString('en-PH')} ·{' '}
                  {payment.recordedBy}
                  {payment.receiptAttached && (
                    <Button
                      variant="secondary"
                      loading={receiptGrant.isPending}
                      onClick={() =>
                        receiptGrant.mutate({ refundId: refund.id, repaymentId: payment.id })
                      }
                    >
                      View supporting receipt
                    </Button>
                  )}
                </p>
              ))}
            </section>
          ))}
          {reconciliation.isError && (
            <ErrorState
              error={reconciliation.error}
              onRetry={() => void history.refetch()}
              title="Receipt reconciliation unavailable"
            />
          )}
          {reconciliation.data && (
            <p role="status">
              {reconciliation.data.status === 'cleanup_pending'
                ? 'The attempt is abandoned; private receipt cleanup is pending. Retry reconciliation.'
                : reconciliation.data.status === 'referenced'
                  ? 'The committed repayment receipt was preserved.'
                  : 'The abandoned receipt was removed.'}
            </p>
          )}
          {receiptGrant.isError && (
            <ErrorState
              error={receiptGrant.error}
              onRetry={() => receiptGrant.reset()}
              title="Receipt unavailable"
            />
          )}
          {receiptGrant.data && (
            <a href={receiptGrant.data.url} target="_blank" rel="noopener noreferrer">
              Open private receipt
            </a>
          )}
        </Dialog>
      )}
    </>
  );
}
