import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { addMoney, subtractMoney } from '@afhomes/shared';
import { Button, Dialog, ErrorState, Skeleton, notifyConfirm, notifySuccess } from '@afhomes/ui';
import { useSession } from '../../lib/session';
import {
  cancelPointPurchase,
  listPointRefunds,
  refundPurchasePoints,
  type PurchaseRow,
} from './points-services';
import { formatMoney } from './format';

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
    queryKey: ['earning', 'point-refunds', purchase.id],
    queryFn: () => listPointRefunds(purchase.id),
    enabled: open,
  });
  const originalValue = subtractMoney(purchase.grossAmount, purchase.tierDiscountAmount ?? '0.00');
  const refundedValue = (refunds.data ?? []).reduce(
    (sum, refund) => addMoney(sum, refund.serviceValue),
    '0.00',
  );
  const remainingValue = subtractMoney(originalValue, refundedValue);
  const save = useMutation({
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
      void client.invalidateQueries({ queryKey: ['earning'] });
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
                Original service value before points: {formatMoney(originalValue)}. Remaining
                attributable value: {formatMoney(remainingValue)}.
              </p>
              <label htmlFor={'point-refund-value-' + purchase.id}>
                Service value being refunded, before the points discount
              </label>
              <input
                id={'point-refund-value-' + purchase.id}
                inputMode="decimal"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  reference.current = null;
                }}
                disabled={save.isPending || confirmationOpen}
              />
              {refunds.data?.map((refund) => (
                <p key={refund.id}>
                  {refund.reviewedAt.slice(0, 10)}: {formatMoney(refund.serviceValue)},{' '}
                  {refund.pointsRestored.toLocaleString('en-PH')} points restored. {refund.reason}
                </p>
              ))}
            </>
          )}
          <label htmlFor={'point-refund-reason-' + purchase.id}>Finance review and reason</label>
          <textarea
            id={'point-refund-reason-' + purchase.id}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
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
