import type { MemberStatus } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

export const MEMBER_STATUS_LABEL: Record<MemberStatus, string> = {
  PENDING: 'Pending',
  APPROVED_ACTIVE: 'Active',
  REJECTED: 'Rejected',
};

export const MEMBER_STATUS_TONE: Record<MemberStatus, StatusTone> = {
  PENDING: 'warning',
  APPROVED_ACTIVE: 'success',
  REJECTED: 'danger',
};
