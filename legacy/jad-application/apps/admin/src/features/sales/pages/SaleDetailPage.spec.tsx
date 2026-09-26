import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { MOCK_ADMIN } from '@jad/mock';

import { renderWithProviders } from '../../../test/utils';
import { SaleDetailPage } from './SaleDetailPage';

const SUBMITTED_SALE = {
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
  commissionRates: { direct: '0.0800', referral: '0.0400' },
  referrerName: 'Maria Santos',
};

vi.mock('../hooks/useSale', () => ({
  useSale: () => ({
    data: SUBMITTED_SALE,
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const { mockDeleteSaleMutate, mockDeleteSalePending } = vi.hoisted(() => ({
  mockDeleteSaleMutate: vi.fn(),
  mockDeleteSalePending: { value: false },
}));

vi.mock('../hooks/useDeleteSale', () => ({
  useDeleteSale: () => ({
    mutateAsync: (...args: unknown[]) => mockDeleteSaleMutate(...args),
    get isPending() {
      return mockDeleteSalePending.value;
    },
  }),
}));

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderDetail() {
  return renderWithProviders(
    <Routes>
      <Route path="/admin/sales/:id" element={<SaleDetailPage />} />
    </Routes>,
    { route: '/admin/sales/sal-001', user: MOCK_ADMIN },
  );
}

describe('SaleDetailPage transitions', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the commission estimate from the configured rates (BR-CFG-001)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ ...SUBMITTED_SALE }, 200)),
    );
    renderDetail();

    // 1,200,000.00 × 0.0800 = 96,000.00 · × 0.0400 = 48,000.00.
    expect(await screen.findByText('Est. commission')).toBeInTheDocument();
    expect(screen.getByText('₱96,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱48,000.00')).toBeInTheDocument();
    expect(screen.getByText(/\(estimated, 8\.00%\/4\.00%\)/)).toBeInTheDocument();
  });

  it('renders the referrer snapshot when present', async () => {
    renderDetail();

    expect(await screen.findByText('Referrer')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
  });

  it('persists approval through the API instead of local state', async () => {
    const fetchMock = vi.fn(async (..._args) =>
      jsonResponse({ ...SUBMITTED_SALE, status: 'ADMIN_APPROVED' }, 200),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Approve sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
    // SaleFormDialog also fires a properties GET on mount; scope to PATCH.
    const patchCalls = fetchMock.mock.calls.filter(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    );
    expect(patchCalls).toHaveLength(1);
    const [, init] = patchCalls[0] as unknown as [unknown, RequestInit];
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ status: 'ADMIN_APPROVED' });
    // Stepper advances to the persisted status.
    await screen.findByText('Verify payment');
  });

  it('shows the server error and keeps the old status on illegal transitions', async () => {
    const fetchMock = vi.fn(async (..._args) =>
      jsonResponse(
        {
          error: {
            code: 'CONFLICT',
            message: 'Cannot transition sale.',
            timestamp: new Date().toISOString(),
          },
        },
        409,
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Approve sale' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Approve' }));

    await screen.findByText('Cannot transition sale.');
    // Still on the submitted step - nothing advanced locally.
    expect(screen.getByRole('button', { name: 'Approve sale' })).toBeInTheDocument();
  });

  it('locks the delete confirm while a delete is in flight', async () => {
    mockDeleteSalePending.value = true;
    try {
      renderDetail();

      fireEvent.click(screen.getByRole('button', { name: 'Delete sale' }));
      // Pending confirm renders its loading state and stays disabled.
      const confirm = await screen.findByRole('button', { name: /loading/i });
      expect(confirm).toBeDisabled();
      // Cancel is a no-op while the delete is in flight.
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.getByRole('button', { name: /loading/i })).toBeInTheDocument();
    } finally {
      mockDeleteSalePending.value = false;
    }
  });

  it('sends the rejection reason when rejecting', async () => {
    const fetchMock = vi.fn(async (..._args) =>
      jsonResponse({ ...SUBMITTED_SALE, status: 'REJECTED', rejectionReason: 'Duplicate' }, 200),
    );
    vi.stubGlobal('fetch', fetchMock);
    renderDetail();

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }));
    fireEvent.change(screen.getByLabelText(/Rejection reason/i), {
      target: { value: 'Duplicate' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm rejection' }));

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.filter((c) => (c[1] as RequestInit | undefined)?.method === 'PATCH'),
      ).toHaveLength(1);
    });
    const [, init] = fetchMock.mock.calls.find(
      (c) => (c[1] as RequestInit | undefined)?.method === 'PATCH',
    ) as unknown as [unknown, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({
      status: 'REJECTED',
      rejectionReason: 'Duplicate',
    });
  });
});
