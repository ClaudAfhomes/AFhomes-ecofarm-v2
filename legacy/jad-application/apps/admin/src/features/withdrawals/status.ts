import type { WithdrawalStatus } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

export const WITHDRAWAL_STATUS_LABEL: Record<WithdrawalStatus, string> = {
  REQUESTED: 'Requested',
  RESERVED: 'Reserved',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};

export const WITHDRAWAL_STATUS_TONE: Record<WithdrawalStatus, StatusTone> = {
  REQUESTED: 'warning',
  RESERVED: 'info',
  COMPLETED: 'success',
  REJECTED: 'danger',
};
