import type { PayrollBatch } from '@afhomes/contracts';
import type { StatusTone } from '@afhomes/ui';

type Status = PayrollBatch['status'];

export const BATCH_STATUS_LABEL: Record<Status, string> = {
  draft: 'Draft',
  submitted: 'Waiting for approval',
  approved: 'Approved',
  returned: 'Returned',
  closed: 'Closed',
};

export const BATCH_STATUS_TONE: Record<Status, StatusTone> = {
  draft: 'neutral',
  submitted: 'warning',
  approved: 'success',
  returned: 'danger',
  closed: 'neutral',
};
