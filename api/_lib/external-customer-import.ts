import { addMoney, compareMoney, subtractMoney } from '@afhomes/shared';
import type { WorkbookPaymentClaim } from '@afhomes/contracts';

/** Payment rows, rather than the status label or cached Excel totals, determine routing. */
export function externalImportSummary(
  fields: Record<string, string>,
  payments: WorkbookPaymentClaim[],
) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fields.contract_date ?? ''))
    throw new Error('Contract date is required for externally verified history.');
  const total = fields.stated_total ?? '';
  if (!/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(total) || compareMoney(total, '0.00') <= 0)
    throw new Error('A positive contract total is required.');
  const paid = payments.reduce((sum, payment) => addMoney(sum, payment.amount), '0.00');
  if (compareMoney(paid, total) > 0) throw new Error('Payment history exceeds the contract total.');
  const status = fields.stated_status;
  const stage =
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
  return { stage, paid, balance: subtractMoney(total, paid), total };
}
