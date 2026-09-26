import { addMoney, formatMoney } from '@jad/shared';
import type {
  Commission,
  CommissionStatus,
  CommissionType,
  ContentKind,
  LedgerEntryType,
  MemberStatus,
  PayoutAccountStatus,
  PayoutMethod,
  SaleStatus,
  VoucherStatus,
  WithdrawalStatus,
} from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

/**
 * Presentation-only mappers for member/sale statuses and dates. Status
 * vocabulary comes from the contracts - the UI never invents labels. Dates are
 * formatted for display only (ISO-8601 strings from the API).
 */

export function memberStatusLabel(status: MemberStatus): string {
  switch (status) {
    case 'APPROVED_ACTIVE':
      return 'Active';
    case 'PENDING':
      return 'Pending';
    case 'REJECTED':
      return 'Rejected';
  }
}

export const MEMBER_STATUS_TONE: Record<MemberStatus, StatusTone> = {
  APPROVED_ACTIVE: 'success',
  PENDING: 'warning',
  REJECTED: 'danger',
};

export function saleStatusLabel(status: SaleStatus): string {
  switch (status) {
    case 'SUBMITTED':
      return 'Submitted';
    case 'ADMIN_APPROVED':
      return 'Admin Approved';
    case 'PAYMENT_VERIFIED':
      return 'Payment Verified';
    case 'QUALIFYING_SALE':
      return 'Qualifying Sale';
    case 'REJECTED':
      return 'Rejected';
    case 'LOCKED':
      return 'Locked';
  }
}

export const SALE_STATUS_TONE: Record<SaleStatus, StatusTone> = {
  SUBMITTED: 'info',
  ADMIN_APPROVED: 'info',
  PAYMENT_VERIFIED: 'info',
  QUALIFYING_SALE: 'success',
  REJECTED: 'danger',
  LOCKED: 'warning',
};

export function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Clock time for chat meta - e.g. `10:15 AM`. */
export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
}

export function commissionStatusLabel(status: CommissionStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'AVAILABLE':
      return 'Available';
    case 'CANCELLED':
      return 'Cancelled';
    case 'REVERSED':
      return 'Reversed';
  }
}

export const COMMISSION_STATUS_TONE: Record<CommissionStatus, StatusTone> = {
  PENDING: 'warning',
  AVAILABLE: 'success',
  CANCELLED: 'neutral',
  REVERSED: 'danger',
};

export function commissionTypeLabel(type: CommissionType): string {
  switch (type) {
    case 'DIRECT_COMMISSION':
      return 'Direct Commission';
    case 'DIRECT_REFERRAL':
      return 'Direct Referral';
    case 'GROUP_INCENTIVE':
      return 'Group Incentive';
  }
}

export function payoutAccountStatusLabel(status: PayoutAccountStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'ADMIN_REVIEW':
      return 'Admin Review';
    case 'CONFIRMED':
      return 'Confirmed';
    case 'REJECTED':
      return 'Rejected';
  }
}

export const PAYOUT_ACCOUNT_STATUS_TONE: Record<PayoutAccountStatus, StatusTone> = {
  PENDING: 'warning',
  ADMIN_REVIEW: 'info',
  CONFIRMED: 'success',
  REJECTED: 'danger',
};

export function payoutMethodLabel(method: PayoutMethod): string {
  switch (method) {
    case 'TRADITIONAL_BANK':
      return 'Traditional bank';
    case 'DIGITAL_BANK':
      return 'Digital bank';
    case 'GCASH':
      return 'GCash';
    case 'OTHER':
      return 'Other';
  }
}

export const PAYOUT_METHOD_OPTIONS: { value: PayoutMethod; label: string }[] = [
  { value: 'TRADITIONAL_BANK', label: payoutMethodLabel('TRADITIONAL_BANK') },
  { value: 'DIGITAL_BANK', label: payoutMethodLabel('DIGITAL_BANK') },
  { value: 'GCASH', label: payoutMethodLabel('GCASH') },
  { value: 'OTHER', label: payoutMethodLabel('OTHER') },
];

export function withdrawalStatusLabel(status: WithdrawalStatus): string {
  switch (status) {
    case 'REQUESTED':
      return 'Requested';
    case 'RESERVED':
      return 'Reserved';
    case 'COMPLETED':
      return 'Completed';
    case 'REJECTED':
      return 'Rejected';
  }
}

export const WITHDRAWAL_STATUS_TONE: Record<WithdrawalStatus, StatusTone> = {
  REQUESTED: 'warning',
  RESERVED: 'info',
  COMPLETED: 'success',
  REJECTED: 'danger',
};

export function ledgerEntryTypeLabel(type: LedgerEntryType): string {
  switch (type) {
    case 'DIRECT_COMMISSION':
      return 'Direct Commission';
    case 'DIRECT_REFERRAL':
      return 'Direct Referral';
    case 'GROUP_INCENTIVE':
      return 'Group Incentive';
    case 'WITHDRAWAL':
      return 'Withdrawal';
    case 'WITHDRAWAL_RESERVATION':
      return 'Withdrawal Reservation';
    case 'WITHDRAWAL_COMPLETION':
      return 'Withdrawal Completion';
    case 'WITHDRAWAL_REVERSAL':
      return 'Withdrawal Reversal';
    case 'COMMISSION_REVERSAL':
      return 'Commission Reversal';
    case 'FINANCIAL_ADJUSTMENT':
      return 'Financial Adjustment';
  }
}

export function ledgerDirectionLabel(direction: 'CREDIT' | 'DEBIT'): string {
  return direction === 'CREDIT' ? 'Credit' : 'Debit';
}

/** Signed money display - presentation only, no arithmetic (CREDIT `+`, DEBIT `−`). */
export function formatSignedMoney(amount: string, direction: 'CREDIT' | 'DEBIT'): string {
  const sign = direction === 'CREDIT' ? '+' : '\u2212';
  return `${sign}${formatMoney(amount)}`;
}

export function voucherStatusLabel(status: VoucherStatus): string {
  switch (status) {
    case 'ACTIVE':
      return 'Active';
    case 'FULLY_REDEEMED':
      return 'Fully redeemed';
  }
}

export const VOUCHER_STATUS_TONE: Record<VoucherStatus, StatusTone> = {
  ACTIVE: 'success',
  FULLY_REDEEMED: 'neutral',
};

export function contentKindLabel(kind: ContentKind): string {
  switch (kind) {
    case 'DOCUMENT':
      return 'Document';
    case 'IMAGE':
      return 'Image';
    case 'VIDEO':
      return 'Video';
    case 'PROMO':
      return 'Promo';
  }
}

/**
 * Legacy helper: sums PENDING commissions in clearing. Kept for the commissions
 * list detail; the dashboard/eWallet pending card now uses the server-computed
 * `wallet.pendingCommission` pipeline estimate (open sales x rates), not this.
 */
export function sumPendingCommissions(commissions: readonly Commission[] | undefined): string {
  return (commissions ?? [])
    .filter((c) => c.status === 'PENDING')
    .reduce((sum, c) => addMoney(sum, c.amount), '0.00');
}
