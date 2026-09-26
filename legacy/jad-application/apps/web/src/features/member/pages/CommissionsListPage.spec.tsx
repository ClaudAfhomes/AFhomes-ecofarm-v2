import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { CommissionsListPage } from './CommissionsListPage';
import { renderMember } from '../test/utils';
import { mockFetchNetworkError, mockFetchRoutes } from '../../../test/utils';

const COMMISSIONS = {
  data: [
    {
      id: 'com-001',
      commissionType: 'DIRECT_COMMISSION',
      saleId: 'sal-004',
      salePropertyName: 'Titled Hotspring Lots',
      baseValue: '2000000.00',
      rate: '0.0800',
      amount: '160000.00',
      status: 'AVAILABLE',
      clearedAt: '2026-08-15T10:00:00.000Z',
      createdAt: '2026-08-14T10:00:00.000Z',
    },
    {
      id: 'com-003',
      commissionType: 'DIRECT_REFERRAL',
      saleId: 'sal-007',
      salePropertyName: 'Prisma Residences - Astra Building Condo',
      baseValue: '5300000.00',
      rate: '0.0400',
      amount: '212000.00',
      status: 'PENDING',
      createdAt: '2026-08-20T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member CommissionsListPage', () => {
  it('renders commission records with snapshots and status (SCR-MEM-015)', async () => {
    mockFetchRoutes({ '/me/commissions': COMMISSIONS });
    renderMember(<CommissionsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Direct Commission')).toBeInTheDocument();
    expect(screen.getByText('Direct Referral')).toBeInTheDocument();
    expect(screen.getByText('₱160,000.00')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Titled Hotspring Lots' })).toHaveAttribute(
      'href',
      '/member/sales/sal-004',
    );
  });

  it('shows an empty state when there are no commissions', async () => {
    mockFetchRoutes({ '/me/commissions': { data: [], meta: {} } });
    renderMember(<CommissionsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No commissions yet')).toBeInTheDocument();
  });

  it('renders CANCELLED and REVERSED with lifecycle timestamps and correct tones', async () => {
    const MIXED = {
      data: [
        {
          id: 'com-005',
          commissionType: 'DIRECT_COMMISSION',
          saleId: 'sal-008',
          salePropertyName: 'Levina Place - 2BR Condo',
          baseValue: '5500000.00',
          rate: '0.0800',
          amount: '440000.00',
          status: 'REVERSED',
          clearedAt: '2026-08-10T10:00:00.000Z',
          reversedAt: '2026-08-12T10:00:00.000Z',
          createdAt: '2026-08-09T10:00:00.000Z',
        },
        {
          id: 'com-006',
          commissionType: 'DIRECT_REFERRAL',
          saleId: 'sal-009',
          salePropertyName: 'Mountain View Leisure Community',
          baseValue: '4000000.00',
          rate: '0.0400',
          amount: '160000.00',
          status: 'CANCELLED',
          cancelledAt: '2026-08-11T10:00:00.000Z',
          createdAt: '2026-08-10T10:00:00.000Z',
        },
      ],
      meta: {},
    };
    mockFetchRoutes({ '/me/commissions': MIXED });
    renderMember(<CommissionsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Reversed')).toBeInTheDocument();
    expect(screen.getByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/reversed/)).toBeInTheDocument();
    expect(screen.getByText(/cancelled/)).toBeInTheDocument();
    // Rate formatting via BigInt helper - 8.00% and 4.00% without float
    expect(screen.getByText(/8\.00%/)).toBeInTheDocument();
    expect(screen.getByText(/4\.00%/)).toBeInTheDocument();
  });

  it('shows lifecycle cleared timestamp for AVAILABLE', async () => {
    mockFetchRoutes({ '/me/commissions': COMMISSIONS });
    renderMember(<CommissionsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/cleared/)).toBeInTheDocument();
  });

  it('shows retry and empty CTA links', async () => {
    mockFetchRoutes({ '/me/commissions': { data: [], meta: {} } });
    renderMember(<CommissionsListPage />, { user: MOCK_MEMBER });
    expect(await screen.findByText('View sales')).toHaveAttribute('href', '/member/sales');
    expect(screen.getByText('View eWallet')).toHaveAttribute('href', '/member/ewallet');

    mockFetchNetworkError();
    renderMember(<CommissionsListPage />, { user: MOCK_MEMBER });
    expect(await screen.findByText('Could not load your commissions')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});
