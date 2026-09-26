import { withdrawalSchema } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/** Withdrawal queue - `GET /admin/withdrawals` (super_admin, admin, finance). */
export function getWithdrawals() {
  return requestList('/admin/withdrawals', withdrawalSchema);
}

/** `POST /admin/withdrawals/:id/complete` - confirm external execution. */
export function completeWithdrawal(id: string) {
  return request(`/admin/withdrawals/${id}/complete`, withdrawalSchema, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

/** `POST /admin/withdrawals/:id/reject` - reject with mandatory reason. */
export function rejectWithdrawal(id: string, rejectionReason: string) {
  return request(`/admin/withdrawals/${id}/reject`, withdrawalSchema, {
    method: 'POST',
    body: JSON.stringify({ rejectionReason }),
  });
}
