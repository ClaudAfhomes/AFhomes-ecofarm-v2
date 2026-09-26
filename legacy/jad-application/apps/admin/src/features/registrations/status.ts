import type { MemberStatus } from '@jad/contracts';
import type { StatusTone } from '@jad/ui';

/**
 * Presentational mapping of the documented member/registration status lifecycle
 * (BR-AUTH-002, DATABASE-DESIGN §members). Vocabulary comes from the contract -
 * never invented in the UI.
 */
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
