import { z } from 'zod';

import { saleSchema, type Sale } from '@jad/contracts';

import { request, requestList } from '../../../lib/api/client';

/**
 * Sales repository - REST over api/v1 (Phase B3 cutover).
 * Status transitions are validated server-side; ID/submittedAt immutable.
 */
export async function getSales(): Promise<Sale[]> {
  return requestList('/admin/sales', saleSchema);
}

export async function getSaleById(id: string): Promise<Sale | undefined> {
  try {
    return await request(`/admin/sales/${id}`, saleSchema);
  } catch {
    return undefined;
  }
}

export interface CreateSaleInput {
  propertyId: string;
  propertyName: string;
  propertyValue: string;
  customerId?: string;
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  sellerId: string;
  sellerName: string;
  referrerName?: string;
  referrerId?: string;
}

export async function createSale(input: CreateSaleInput): Promise<Sale> {
  return request('/admin/sales', saleSchema, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function updateSale(
  id: string,
  patch: Partial<Omit<Sale, 'id' | 'submittedAt'>>,
): Promise<Sale> {
  return request(`/admin/sales/${id}`, saleSchema, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
}

export async function deleteSale(id: string): Promise<void> {
  await request(`/admin/sales/${id}`, z.object({ id: z.string() }), { method: 'DELETE' });
}
