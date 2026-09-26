import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { MOCK_MEMBER, MOCK_MEMBER_NOT_QUALIFIED } from '@jad/mock';

import { SaleDetailPage } from './SaleDetailPage';
import { renderMember } from '../test/utils';
import { mockFetchNetworkError, mockFetchRoutes } from '../../../test/utils';

const CUSTOMERS = {
  data: [{ id: 'cus-001', fullName: 'Ramon Reyes', phone: '+63 917 555 0111' }],
  meta: {},
};

const SALE = {
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
};

const LOCKED_SALE = {
  id: 'sal-006',
  status: 'LOCKED',
  propertyId: 'prisma-celeste-building',
  propertyName: 'Prisma Residences - Celeste Building Condo',
  propertyValue: '8300000.00',
  customerId: 'cus-001',
  customerName: 'Celine Cruz',
  sellerId: 'mem-001',
  sellerName: 'Juan Dela Cruz',
  resubmissionCount: 3,
  submittedAt: '2026-08-10T10:00:00.000Z',
  lockedAt: '2026-08-18T10:00:00.000Z',
  rejectionReason: 'The submitted payment reference was invalid after multiple resubmissions.',
};

describe('member SaleDetailPage (SCR-MEM-007)', () => {
  function renderSale(saleId: string) {
    return renderMember(
      <Routes>
        <Route path="/member/sales/:saleId" element={<SaleDetailPage />} />
      </Routes>,
      { route: `/member/sales/${saleId}`, user: MOCK_MEMBER },
    );
  }

  it('renders the server snapshot for one of the member\u2019s sales', async () => {
    mockFetchRoutes({
      '/sales/sal-001': SALE,
      '/customers': CUSTOMERS,
    });
    renderSale('sal-001');

    expect(await screen.findByText('2-Storey House')).toBeInTheDocument();
    expect(screen.getByText('₱3,200,000.00')).toBeInTheDocument();
    expect(screen.getByText('Celine Cruz')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to sales' })).toHaveAttribute(
      'href',
      '/member/sales',
    );
  });

  it('renders the commission estimate from the configured rates (BR-CFG-001)', async () => {
    mockFetchRoutes({
      '/sales/sal-001': {
        ...SALE,
        commissionRates: { direct: '0.0800', referral: '0.0400' },
      },
      '/customers': CUSTOMERS,
    });
    renderSale('sal-001');

    // 3,200,000.00 × 0.0800 = 256,000.00 · × 0.0400 = 128,000.00.
    expect(await screen.findByLabelText('Estimated commission preview')).toBeInTheDocument();
    expect(screen.getByText('₱256,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱128,000.00')).toBeInTheDocument();
    expect(screen.getByText(/\(estimated, 8\.00%\/4\.00%\)/)).toBeInTheDocument();
  });

  it('renders the referrer snapshot when present', async () => {
    mockFetchRoutes({
      '/sales/sal-001': { ...SALE, referrerName: 'Maria Santos' },
      '/customers': CUSTOMERS,
    });
    renderSale('sal-001');

    expect(await screen.findByText('Referrer')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
  });

  it('requests staff review for a LOCKED sale (FR-SAL-007)', async () => {
    mockFetchRoutes({
      '/sales/sal-006': LOCKED_SALE,
      '/customers': CUSTOMERS,
      '/me/sales/sal-006/reopen-request': { saleId: 'sal-006', requested: true },
    });
    const user = userEvent.setup();
    renderSale('sal-006');

    const reopenButton = await screen.findByRole('button', { name: 'Request reopen' });
    await user.click(reopenButton);

    expect(await screen.findByText('Request recorded')).toBeInTheDocument();
    expect(await screen.findByText('JA&D staff will review the locked sale.')).toBeInTheDocument();
  });

  it('surfaces an error state when the sale endpoint fails', async () => {
    mockFetchRoutes({
      '/customers': CUSTOMERS,
      '/sales/sal-999': {
        body: { error: { code: 'NOT_FOUND', message: 'Not found' } },
        status: 404,
      },
    });
    renderSale('sal-999');

    expect(await screen.findByText('Could not load this sale')).toBeInTheDocument();
  });

  it('shows a network error state', async () => {
    mockFetchNetworkError();
    renderSale('sal-001');

    expect(await screen.findByText('Could not load this sale')).toBeInTheDocument();
  });

  it('renders read-only for the selected referrer (no seller actions)', async () => {
    const referredRejected = {
      ...SALE,
      id: 'sal-010',
      status: 'REJECTED',
      resubmissionCount: 1,
      referrerId: 'mem-002',
      referrerName: 'Maria Santos',
      rejectionReason: 'Phone number could not be verified.',
    };
    mockFetchRoutes({
      '/sales/sal-010': referredRejected,
      '/customers': CUSTOMERS,
    });
    renderMember(
      <Routes>
        <Route path="/member/sales/:saleId" element={<SaleDetailPage />} />
      </Routes>,
      { route: '/member/sales/sal-010', user: MOCK_MEMBER_NOT_QUALIFIED },
    );

    expect(await screen.findByText('Referred sale')).toBeInTheDocument();
    expect(screen.getByText(/viewing this sale as its selected referrer/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resubmit sale' })).not.toBeInTheDocument();
    expect(screen.queryByText('Resubmit sale', { selector: 'h2' })).not.toBeInTheDocument();
  });
});
