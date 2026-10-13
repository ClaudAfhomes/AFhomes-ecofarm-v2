import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useBusinessMutation } from '../../lib/useBusinessMutation';
import { addMoney, formatMoneyOrDash, subtractMoney } from '@afhomes/shared';
import { Button, Dialog, ErrorState, Skeleton, TextAreaField, TextField, notifyConfirm, notifySuccess } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import {
  cancelPointPurchase,
  listPointRefunds,
  refundPurchasePoints,
  type PurchaseRow,
} from './points-services';
import { earningKeys } from './queryKeys';

export function PointRefundReview({ purchase }: { purchase: PurchaseRow }) {
  const permissions = useSession().user?.afHomesPermissions ?? [];
  const mayReview = permissions.some(
    (permission) => permission.moduleKey === 'operations.payments' && permission.canUpdate,
  );
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const confirming = useRef(false);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const reference = useRef<string | null>(null);
  const client = useQueryClient();
  const refunds = useQuery({
    queryKey: earningKeys.pointRefunds(purchase.id),
    queryFn: () => listPointRefunds(purchase.id),
    enabled: open,
  });
  const originalValue = subtractMoney(purchase.grossAmount, purchase.tierDiscountAmount ?? '0.00');
  const refundedValue = (refunds.data ?? []).reduce(
    (sum, refund) => addMoney(sum, refund.serviceValue),
    '0.00',
  );
  const remainingValue = subtractMoney(originalValue, refundedValue);
  const save = useBusinessMutation({
    mutationFn: async () => {
      if (purchase.status === 'draft') return cancelPointPurchase(purchase.id, reason.trim());
      reference.current ??= crypto.randomUUID();
      return refundPurchasePoints(purchase.id, {
        serviceValue: value,
        reference: reference.current,
        reason: reason.trim(),
        serviceReviewConfirmed: true,
      });
    },
    retry: false,
    onSuccess: () => {
      notifySuccess({
        title: purchase.status === 'draft' ? 'Reservation released' : 'Point refund recorded',
      });
      void client.invalidateQueries({ queryKey: earningKeys.all });
      setOpen(false);
      setValue('');
      setReason('');
      setReviewed(false);
      reference.current = null;
    },
  });
  if (!mayReview || (purchase.status !== 'draft' && purchase.pointsDiscountAmount === '0.00'))
    return null;
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {purchase.status === 'draft' ? 'Cancel purchase reservation' : 'Review point refund'}
      </Button>
      {open && (
        <Dialog
          open
          title={'Finance review: ' + purchase.purchaseNumber}
          onClose={() => {
            if (!save.isPending) setOpen(false);
          }}
        >
          <p>
            Review service delivery and cancellation/refund eligibility. This restores points only;
            it does not pay cash or alter recorded receipts.
          </p>
          {purchase.status !== 'draft' && (
            <>
              {refunds.isLoading && (
                <div role="status" aria-label="Loading point refund history">
                  <Skeleton />
                </div>
              )}
              {refunds.isError && (
                <ErrorState
                  title="Refund history unavailable"
                  message="Existing refunds must be checked before another restoration."
                  onRetry={refunds.refetch}
                />
              )}
              <p>
                Original service value before points: {formatMoneyOrDash(originalValue)}. Remaining
                attributable value: {formatMoneyOrDash(remainingValue)}.
              </p>
              <TextField
                id={'point-refund-value-' + purchase.id}
                name="refundValue"
                label="Service value being refunded, before the points discount"
                optional
                inputMode="decimal"
                value={value}
                onChange={(next) => {
                  setValue(next);
                  reference.current = null;
                }}
                disabled={save.isPending || confirmationOpen}
              />
              {refunds.data?.map((refund) => (
                <p key={refund.id}>
                  {refund.reviewedAt.slice(0, 10)}: {formatMoneyOrDash(refund.serviceValue)},{' '}
                  {refund.pointsRestored.toLocaleString('en-PH')} points restored. {refund.reason}
                </p>
              ))}
            </>
          )}
          <TextAreaField
            id={'point-refund-reason-' + purchase.id}
            name="refundReason"
            label="Finance review and reason"
            optional
            value={reason}
            onChange={(value) => {
              setReason(value);
              reference.current = null;
            }}
            disabled={save.isPending || confirmationOpen}
          />
          <label>
            <input
              type="checkbox"
              checked={reviewed}
              onChange={(event) => setReviewed(event.target.checked)}
              disabled={save.isPending || confirmationOpen}
            />
            I reviewed service delivery, refund eligibility and the attributable service value.
          </label>
          {save.isError && (
            <ErrorState
              title="Not recorded"
              message="The review could not be recorded. Check existing history before retrying."
            />
          )}
          <Button
            loading={save.isPending}
            loadingLabel="Recording…"
            disabled={
              !reviewed ||
              reason.trim().length < 3 ||
              save.isPending ||
              confirmationOpen ||
              (purchase.status !== 'draft' &&
                (!/^(0|[1-9][0-9]*)([.][0-9]{1,2})?$/.test(value) ||
                  refunds.isError ||
                  refunds.isLoading))
            }
            onClick={async () => {
              if (confirming.current || save.isPending) return;
              confirming.current = true;
              setConfirmationOpen(true);
              try {
                if (
                  await notifyConfirm({
                    title: 'Record this Finance decision?',
                    message:
                      purchase.status === 'draft'
                        ? 'Cancel this purchase and release its point reservation. No points are debited.'
                        : 'Restore only the server-calculated points attributable to this refund. History remains unchanged.',
                    confirmButtonText: 'Record review',
                  })
                )
                  save.mutate();
              } finally {
                confirming.current = false;
                setConfirmationOpen(false);
              }
            }}
          >
            Record Finance review
          </Button>
        </Dialog>
      )}
    </>
  );
}
