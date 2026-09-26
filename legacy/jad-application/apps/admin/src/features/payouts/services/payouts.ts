import { payoutAccountSchema, type PayoutAccount } from '@jad/contracts';
import { request, requestList } from '../../../lib/api/client';

export function getPayouts(): Promise<PayoutAccount[]> {
  return requestList('/admin/payouts', payoutAccountSchema);
}

/**
 * `PATCH /admin/payouts/:id` - verify (CONFIRMED) or reject (REJECTED +
 * reason) a payout account (Phase B6, finance+).
 */
export function reviewPayoutAccount(
  id: string,
  input: { status: 'CONFIRMED' } | { status: 'REJECTED'; rejectionReason: string },
): Promise<PayoutAccount> {
  return request(`/admin/payouts/${id}`, payoutAccountSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
