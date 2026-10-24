import { addMoney, compareMoney, subtractMoney, splitStayPoints } from '@afhomes/shared';
import type { WorkbookPaymentClaim } from '@afhomes/contracts';

/** Called only after permission-gated historical certification; cached Excel formulas are never trusted. */
export function externalImportSummary(
  fields: Record<string, string>,
  payments: WorkbookPaymentClaim[],
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.contract_date ?? ''))
    throw new Error('Contract date is required for externally verified history.');
  const total = fields.stated_total ?? '';
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(total) || compareMoney(total, '0.00') <= 0)
    throw new Error('A positive contract total is required.');
  const status = fields.stated_status;
  const inactive = ['Inactive', 'Expired', 'Suspended', 'Cancelled'].includes(status ?? '') || ['Inactive', 'Expired', 'Suspended', 'Cancelled'].includes(fields.existing_card_activation_status ?? '');
  const activeClaim = status === 'Active VIP' || fields.existing_card_activation_status === 'Active';
  if (activeClaim && (['Pending', 'Reservation Paid', 'Down Payment', 'Partially Paid'].includes(status ?? '') || fields.existing_card_activation_status === 'Pending Activation')) throw new Error('Customer status disagrees with card activation history.');
  const settled = status === 'Fully Paid' || activeClaim || inactive;
  const settlement = !payments.length && settled ? 'certified' as const : 'receipts' as const;
  const paid = settlement === 'certified' ? addMoney(total, '0.00') : payments.reduce((sum, payment) => addMoney(sum, payment.amount), '0.00');
  if (compareMoney(paid, total) > 0) throw new Error('Payment history exceeds the contract total.');
  const rawPoints = fields.existing_stay_points_total?.trim() ?? '';
  if (rawPoints && (!/^(0|[1-9]\d*)$/.test(rawPoints) || Number(rawPoints) > 1_000_000_000))
    throw new Error('Existing Stay Points must be whole non-negative points up to 1000000000.');
  const existingPoints = rawPoints === '' ? null : Number(rawPoints);
  const split = existingPoints === null ? null : splitStayPoints(existingPoints);
  const stage = inactive && compareMoney(paid, total) === 0 ? 'inactive'
    : activeClaim && compareMoney(paid, total) === 0 ? 'active'
    :
    status === 'Pending' && paid === '0.00'
      ? 'application'
      : status === 'Reservation Paid' &&
          compareMoney(paid, fields.stated_rf || '0.00') === 0 &&
          paid !== '0.00'
        ? 'reservation'
        : ['Partially Paid', 'Down Payment'].includes(status ?? '') &&
            paid !== '0.00' &&
            compareMoney(paid, total) < 0
          ? 'finance'
          : status === 'Fully Paid' && compareMoney(paid, total) === 0
            ? 'activation'
            : null;
  if (!stage)
    throw new Error(
      'Customer status disagrees with payment history, or needs membership lifecycle dates that this workbook does not contain.',
    );
  return { stage, paid, balance: subtractMoney(total, paid), total, settlement, existingPoints, weekdayPoints: split?.weekday ?? null, weekendPoints: split?.weekend ?? null };
}
