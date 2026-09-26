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
