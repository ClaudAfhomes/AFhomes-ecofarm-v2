import type { VoucherStatus } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

export const VOUCHER_STATUS_LABEL: Record<VoucherStatus, string> = {
  ACTIVE: 'Active',
  FULLY_REDEEMED: 'Fully redeemed',
};

export const VOUCHER_STATUS_TONE: Record<VoucherStatus, StatusTone> = {
  ACTIVE: 'success',
  FULLY_REDEEMED: 'neutral',
};
