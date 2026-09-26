import type { PayoutAccountStatus } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

export const PAYOUT_STATUS_LABEL: Record<PayoutAccountStatus, string> = {
  PENDING: 'Pending',
  ADMIN_REVIEW: 'Admin Review',
  CONFIRMED: 'Confirmed',
  REJECTED: 'Rejected',
};

export const PAYOUT_STATUS_TONE: Record<PayoutAccountStatus, StatusTone> = {
  PENDING: 'warning',
  ADMIN_REVIEW: 'info',
  CONFIRMED: 'success',
  REJECTED: 'danger',
};

export const PAYOUT_METHOD_LABEL: Record<string, string> = {
  TRADITIONAL_BANK: 'Traditional bank',
  DIGITAL_BANK: 'Digital bank',
  GCASH: 'GCash',
  OTHER: 'Other',
};
