import { compareMoney, subtractMoney } from '@afhomes/shared';

/** Presentation helpers for AF Homes business values. */

/** Format an exact-decimal money string for display. Never parses to a number. */
export function formatMoney(exactDecimal: string | null | undefined): string {
  if (exactDecimal === null || exactDecimal === undefined) return '—';
  const [whole = '0', frac = ''] = exactDecimal.split('.');
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `₱${grouped}.${(frac + '00').slice(0, 2)}`;
}

/**
 * Format an exact-decimal rate as a percentage: "0.04" and "0.0400" both mean
 * 4%, rendered as "4.00%".
 *
 * Done with string surgery on the fraction digits, so no float ever
 * participates. A rate is always `0.` + up to four digits.
 */
export function formatRate(exactRate: string | null | undefined): string {
  if (!exactRate) return '—';
  const frac = exactRate.split('.')[1] ?? '';
  // 4 fraction digits: /10000 of the unit, so /100 gives the percent.
  const hundredths = frac.padEnd(4, '0').replace(/^0+/, '').padStart(3, '0');
  return `${hundredths.slice(0, -2)}.${hundredths.slice(-2)}%`;
}

export const formatPoints = (points: number | null | undefined): string =>
  points === null || points === undefined ? '—' : new Intl.NumberFormat('en-PH').format(points);

/**
 * Settlement label from exact-decimal figures (BigInt cents, never float).
 *
 * Fully Paid if and only if Total equals Paid and Balance is zero; any
 * remaining balance with Paid below Total reads as Unsettled. Anything
 * unprovable (missing or malformed figures, nothing owed) fails closed to
 * Unsettled - the UI never claims money settled without proof. Pair with
 * {@link SETTLEMENT_TONE} so the badge color always matches the words.
 */
export function settlementStatus(
  total: string | null | undefined,
  paid: string | null | undefined,
  balance?: string | null,
): 'Fully Paid' | 'Unsettled' {
  try {
    if (!total || !paid) return 'Unsettled';
    if (compareMoney(total, '0.00') <= 0) return 'Unsettled';
    const remaining = balance ?? subtractMoney(total, paid);
    if (compareMoney(remaining, '0.00') === 0 && compareMoney(paid, total) >= 0)
      return 'Fully Paid';
    return 'Unsettled';
  } catch {
    return 'Unsettled';
  }
}

/** Badge tone per settlement label: green settled, orange owing. */
export const SETTLEMENT_TONE: Record<'Fully Paid' | 'Unsettled', 'success' | 'warning'> = {
  'Fully Paid': 'success',
  Unsettled: 'warning',
};

/** A human label for a derived spot-cash state. */
export const SPOT_CASH_LABEL: Record<string, string> = {
  not_started: 'Not started',
  within_deadline: 'Within 7 days',
  expired: 'Expired',
  fully_paid: 'Settled',
};

export const SPOT_CASH_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  not_started: 'neutral',
  within_deadline: 'success',
  expired: 'danger',
  fully_paid: 'success',
};

/** A human label for a sale status. */
export const SALE_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  payment_pending: 'Awaiting payment',
  payment_in_progress: 'Payment in progress',
  payment_verified: 'Fully paid',
  activation_pending: 'Awaiting activation',
  active: 'Active',
  cancelled: 'Cancelled',
  overdue: 'Overdue',
};

export const SALE_STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  submitted: 'neutral',
  payment_pending: 'warning',
  payment_in_progress: 'warning',
  payment_verified: 'success',
  activation_pending: 'warning',
  active: 'success',
  cancelled: 'neutral',
  overdue: 'danger',
};

/**
 * Humanize a snake_case code: bank_transfer -> Bank Transfer. The method is
 * free text (no enum), so unknown codes pass through the same rule instead
 * of rendering raw; brand spellings the rule gets wrong live in overrides.
 */
export function humanizeCode(
  value: string | null | undefined,
  overrides: Record<string, string> = {},
): string {
  if (!value) return '—';
  if (overrides[value] !== undefined) return overrides[value];
  return value
    .split('_')
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

/** A human label for a payment type. */
export const PAYMENT_TYPE_LABEL: Record<string, string> = {
  down_payment: 'Down payment',
  installment: 'Installment',
  full: 'Full',
};

export const formatPaymentType = (value: string | null | undefined): string =>
  humanizeCode(value, PAYMENT_TYPE_LABEL);

/** A human label for a payment method. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  bank_transfer: 'Bank Transfer',
  gcash: 'GCash',
  maya: 'Maya',
};

export const formatPaymentMethod = (value: string | null | undefined): string =>
  humanizeCode(value, PAYMENT_METHOD_LABEL);
