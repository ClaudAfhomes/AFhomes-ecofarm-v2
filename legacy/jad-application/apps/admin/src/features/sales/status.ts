import type { SaleStatus } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

export const SALE_STATUS_LABEL: Record<SaleStatus, string> = {
  SUBMITTED: 'Submitted',
  ADMIN_APPROVED: 'Admin Approved',
  PAYMENT_VERIFIED: 'Payment Verified',
  QUALIFYING_SALE: 'Qualifying Sale',
  REJECTED: 'Rejected',
  LOCKED: 'Locked',
};

export const SALE_STATUS_TONE: Record<SaleStatus, StatusTone> = {
  SUBMITTED: 'info',
  ADMIN_APPROVED: 'info',
  PAYMENT_VERIFIED: 'info',
  QUALIFYING_SALE: 'success',
  REJECTED: 'danger',
  LOCKED: 'warning',
};
