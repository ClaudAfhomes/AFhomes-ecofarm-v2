import { compareMoney, subtractMoney } from '@afhomes/shared';
import {
  ACTIVATION_BLOCKER_LABELS,
  MEMBERSHIP_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  RESERVATION_AGREEMENT_STATUS_LABELS,
  SALE_STATUS_LABELS,
  type ActivationBlocker,
  type MembershipStatus,
  type PaymentStatus,
  type ReservationAgreementStatus,
  type SaleStatus,
} from '@afhomes/contracts';
import type { StatusTone } from '@afhomes/ui';

/** Presentation helpers for AFHomes business values. */

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

/**
 * Percent text ("4", "4.5", "12.25") to the exact 4-decimal rate the API stores
 * ("0.0400"), by integer arithmetic only. Null when it is not 0 to 100 with at
 * most two decimals.
 */
export function percentToRate(percent: string): string | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(percent.trim());
  if (!match) return null;
  // Hundredths of a percent equal ten-thousandths of the rate.
  const units = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0') || 0);
  if (units > 10000) return null;
  return `${Math.floor(units / 10000)}.${String(units % 10000).padStart(4, '0')}`;
}

/** Stored rate ("0.0400") to editable percent text ("4.00"). */
export const rateToPercent = (exactRate: string): string => formatRate(exactRate).replace('%', '');

/** Module-level so every count render reuses one formatter. */
const countFormatter = new Intl.NumberFormat('en-PH', { maximumFractionDigits: 0 });

export const formatPoints = (points: number | null | undefined): string => {
  if (points === null || points === undefined) return '—';
  return countFormatter.format(points);
};

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

/* ------------------------------------------------------------------ */
/* Lifecycle status badges                                             */
/* ------------------------------------------------------------------ */
// Labels come from the contracts lifecycle; only the semantic tone lives
// here. Every map is keyed by the lifecycle enum type, so a new state fails
// typecheck until it has a tone. Sale, payment, reservation, payment
// progress and activation eligibility stay separate vocabularies.

export type StatusBadge = { label: string; tone: StatusTone };

export const SALE_STATUS_TONE: Record<SaleStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'neutral',
  payment_pending: 'warning',
  payment_in_progress: 'info',
  payment_verified: 'success',
  activation_pending: 'warning',
  active: 'success',
  cancelled: 'neutral',
  overdue: 'danger',
};

export const PAYMENT_STATUS_TONE: Record<PaymentStatus, StatusTone> = {
  recorded: 'warning',
  verified: 'success',
  rejected: 'danger',
  voided: 'neutral',
};

export const RESERVATION_AGREEMENT_STATUS_TONE: Record<ReservationAgreementStatus, StatusTone> = {
  draft: 'neutral',
  submitted: 'warning',
  executed: 'success',
  cancelled: 'neutral',
};

export const MEMBERSHIP_STATUS_TONE: Record<MembershipStatus, StatusTone> = {
  active: 'success',
  expired: 'neutral',
  suspended: 'danger',
  cancelled: 'neutral',
};

export const ACTIVATION_BLOCKER_TONE: Record<ActivationBlocker, StatusTone> = {
  already_active: 'info',
  cancelled: 'neutral',
  outstanding_balance: 'warning',
  not_ready: 'neutral',
};

export const saleStatusBadge = (status: SaleStatus): StatusBadge => ({
  label: SALE_STATUS_LABELS[status],
  tone: SALE_STATUS_TONE[status],
});

export const paymentStatusBadge = (status: PaymentStatus): StatusBadge => ({
  label: PAYMENT_STATUS_LABELS[status],
  tone: PAYMENT_STATUS_TONE[status],
});

export const reservationAgreementStatusBadge = (
  status: ReservationAgreementStatus,
): StatusBadge => ({
  label: RESERVATION_AGREEMENT_STATUS_LABELS[status],
  tone: RESERVATION_AGREEMENT_STATUS_TONE[status],
});

export const membershipStatusBadge = (status: MembershipStatus): StatusBadge => ({
  label: MEMBERSHIP_STATUS_LABELS[status],
  tone: MEMBERSHIP_STATUS_TONE[status],
});

/** Activation eligibility from the server's `activationBlocker` (null = eligible). */
export const activationBadge = (blocker: ActivationBlocker | null): StatusBadge =>
  blocker === null
    ? { label: 'Eligible', tone: 'success' }
    : { label: ACTIVATION_BLOCKER_LABELS[blocker], tone: ACTIVATION_BLOCKER_TONE[blocker] };

/**
 * Payment progress: a derived presentation milestone, never a stored state.
 * Compares the verified total with the frozen contract amount in exact
 * cents, using the same `>=` rule the server's `fullyPaid` uses.
 */
export type PaymentProgress = 'none' | 'partial' | 'full';

export const PAYMENT_PROGRESS_LABEL: Record<PaymentProgress, string> = {
  none: 'No Verified Payments',
  partial: 'Partially Paid',
  full: 'Fully Paid',
};

export const PAYMENT_PROGRESS_TONE: Record<PaymentProgress, StatusTone> = {
  none: 'neutral',
  partial: 'warning',
  full: 'success',
};

export function paymentProgress(verifiedTotal: string, frozenTotal: string): PaymentProgress {
  if (compareMoney(verifiedTotal, frozenTotal) >= 0) return 'full';
  return compareMoney(verifiedTotal, '0.00') > 0 ? 'partial' : 'none';
}

export const paymentProgressBadge = (progress: PaymentProgress): StatusBadge => ({
  label: PAYMENT_PROGRESS_LABEL[progress],
  tone: PAYMENT_PROGRESS_TONE[progress],
});

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
