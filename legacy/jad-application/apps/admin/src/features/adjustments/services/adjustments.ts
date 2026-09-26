import { adjustmentSchema, type Adjustment } from '@jad/contracts';

import { requestList } from '../../../lib/api/client';

/**
 * Staff adjustments - `GET /admin/adjustments` (Phase B5, super_admin only).
 * Non-SUP callers get 403; the hook falls back to mock data for those roles.
 */
export function getAdjustments(): Promise<Adjustment[]> {
  return requestList('/admin/adjustments', adjustmentSchema);
}
