import { afterEach, describe, expect, it, vi } from 'vitest';

import { transitionSale } from './sales';

const BASE_SALE = {
  id: 'sal-001',
  status: 'SUBMITTED',
  propertyId: 'igp-250-sqm-farm-lot',
  propertyName: '250 SQM Farm Lot with Hotspring',
  propertyValue: '1200000.00',
  customerId: 'cust-001',
  customerName: 'Ramon Reyes',
  sellerId: 'mem-001',
  sellerName: 'Juan Dela Cruz',
  submittedAt: '2026-08-18T09:00:00.000Z',
  resubmissionCount: 0,
};

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('transitionSale', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('PATCHes the new status and returns the validated sale', async () => {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      expect(String(url)).toContain('/admin/sales/sal-001');
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(String(init?.body))).toEqual({ status: 'ADMIN_APPROVED' });
      return jsonResponse({ ...BASE_SALE, status: 'ADMIN_APPROVED' }, 200);
    });
    vi.stubGlobal('fetch', fetchMock);
    const updated = await transitionSale('sal-001', { status: 'ADMIN_APPROVED' });
    expect(updated.status).toBe('ADMIN_APPROVED');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the rejection reason for REJECTED transitions', async () => {
    const fetchMock = vi.fn(async (..._args) =>
      jsonResponse({ ...BASE_SALE, status: 'REJECTED', rejectionReason: 'Duplicate entry' }, 200),
    );
    vi.stubGlobal('fetch', fetchMock);
    const updated = await transitionSale('sal-001', {
      status: 'REJECTED',
      rejectionReason: 'Duplicate entry',
    });
    expect(updated.status).toBe('REJECTED');
    expect(updated.rejectionReason).toBe('Duplicate entry');
  });

  it('throws the server message on illegal transitions (409)', async () => {
    const fetchMock = vi.fn(async (..._args) =>
      jsonResponse(
        {
          error: {
            code: 'CONFLICT',
            message: 'Cannot transition sale from QUALIFYING_SALE to ADMIN_APPROVED.',
            timestamp: new Date().toISOString(),
          },
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    await expect(transitionSale('sal-004', { status: 'ADMIN_APPROVED' })).rejects.toThrow(
      'Cannot transition sale from QUALIFYING_SALE to ADMIN_APPROVED.',
    );
  });
});
