import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { SalesListPage } from './SalesListPage';
import { renderMember } from '../test/utils';
import { mockFetchNetworkError, mockFetchRoutes } from '../../../test/utils';

const SALES = {
  data: [
    {
      id: 'sal-001',
      status: 'SUBMITTED',
      propertyId: 'prisma-2storey-house',
      propertyName: '2-Storey House',
      propertyValue: '3200000.00',
      customerId: 'cus-001',
      customerName: 'Celine Cruz',
      sellerId: 'mem-001',
      sellerName: 'Juan Dela Cruz',
      resubmissionCount: 0,
      submittedAt: '2026-08-18T10:00:00.000Z',
    },
    {
      id: 'sal-002',
      status: 'REJECTED',
      propertyId: 'igp-250-sqm-farm-lot',
      propertyName: '250 SQM Farm Lot with Hotspring',
      propertyValue: '1200000.00',
      customerId: 'cus-002',
      customerName: 'Ramon Reyes',
      sellerId: 'mem-001',
      sellerName: 'Juan Dela Cruz',
      resubmissionCount: 1,
      submittedAt: '2026-08-17T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member SalesListPage (SCR-MEM-005)', () => {
  it('lists the member\u2019s sales with server snapshots, newest first', async () => {
    mockFetchRoutes({ '/sales': SALES });
    renderMember(<SalesListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('2-Storey House')).toBeInTheDocument();
    expect(screen.getByText('₱3,200,000.00')).toBeInTheDocument();
    expect(screen.getByText('250 SQM Farm Lot with Hotspring')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /2-Storey House/ })).toHaveAttribute(
      'href',
      '/member/sales/sal-001',
    );
    expect(screen.getByRole('link', { name: 'Submit a sale' })).toHaveAttribute(
      'href',
      '/member/sales/new',
    );
  });

  it('renders an empty state when there are no sales', async () => {
    mockFetchRoutes({ '/sales': { data: [], meta: {} } });
    renderMember(<SalesListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No sales yet')).toBeInTheDocument();
  });

  it('surfaces an error state when the sales endpoint fails', async () => {
    mockFetchNetworkError();
    renderMember(<SalesListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Could not load your sales')).toBeInTheDocument();
  });
});
