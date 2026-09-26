import { saleSchema, type Sale } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/** Fetch all sales. */
export function getSales(): Promise<Sale[]> {
  return requestList('/admin/sales', saleSchema);
}

/** Fetch a single sale by ID. */
export function getSale(id: string): Promise<Sale> {
  return request(`/admin/sales/${id}`, saleSchema);
}

/**
 * Staff status transition - `PATCH /admin/sales/:id` (super_admin, admin).
 * Legal moves are enforced server-side (SUBMITTED → ADMIN_APPROVED/REJECTED,
 * ADMIN_APPROVED → PAYMENT_VERIFIED/REJECTED, PAYMENT_VERIFIED →
 * QUALIFYING_SALE/REJECTED); rejection requires a reason (BR-SAL-005).
 */
export function transitionSale(
  id: string,
  input: { status: Sale['status']; rejectionReason?: string },
): Promise<Sale> {
  return request(`/admin/sales/${id}`, saleSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}
