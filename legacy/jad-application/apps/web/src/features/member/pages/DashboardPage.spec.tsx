import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER, MOCK_MEMBER_NOT_QUALIFIED } from '@jad/mock';

import { DashboardPage } from './DashboardPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const WALLET = {
  availableBalance: '1280000.00',
  pendingAmount: '960000.00',
  pendingCommission: '424000.00',
};

const QUALIFIED = {
  status: 'APPROVED_ACTIVE',
  isQualified: true,
  requirements: [
    { key: 'MIN_AGE', label: 'Minimum age', met: true },
    { key: 'EMAIL_VERIFIED', label: 'Email verified', met: true },
    { key: 'ID_VERIFIED', label: 'Government ID verified', met: true },
    { key: 'ADMIN_APPROVAL', label: 'Admin approval', met: true },
    { key: 'QUALIFICATION', label: 'Qualification requirements satisfied', met: true },
  ],
};

const NOT_QUALIFIED = {
  ...QUALIFIED,
  isQualified: false,
  requirements: QUALIFIED.requirements.map((requirement) =>
    requirement.key === 'QUALIFICATION' ? { ...requirement, met: false } : requirement,
  ),
};

const SALES = {
  data: [
    {
      id: 'sal-001',
      status: 'SUBMITTED',
      propertyId: 'igp-250-sqm-farm-lot',
      propertyName: '250 SQM Farm Lot with Hotspring',
      propertyValue: '1200000.00',
      customerId: 'cus-001',
      customerName: 'Ramon Reyes',
      sellerId: 'mem-001',
      sellerName: 'Juan Dela Cruz',
      resubmissionCount: 0,
      submittedAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'sal-004',
      status: 'QUALIFYING_SALE',
      propertyId: 'igp-titled-hotspring-lots',
      propertyName: 'Titled Hotspring Lots',
      propertyValue: '2000000.00',
      customerId: 'cus-002',
      customerName: 'Celine Cruz',
      sellerId: 'mem-001',
      sellerName: 'Juan Dela Cruz',
      resubmissionCount: 0,
      submittedAt: '2026-08-15T10:00:00.000Z',
      approvedAt: '2026-08-15T10:00:00.000Z',
      paymentVerifiedAt: '2026-08-16T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member DashboardPage', () => {
  it('shows the signed-in account summary from server data', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/qualification': QUALIFIED,
      '/sales': SALES,
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER });

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getByText('Welcome back, Juan Dela Cruz.')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Qualified')).toBeInTheDocument();
    expect(await screen.findByText('₱1,280,000.00')).toBeInTheDocument();
    expect(await screen.findByText('250 SQM Farm Lot with Hotspring')).toBeInTheDocument();
  });

  it('displays property values in the recent sales list', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/qualification': QUALIFIED,
      '/sales': SALES,
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/₱1,200,000\.00/)).toBeInTheDocument();
    expect(screen.getByText(/₱2,000,000\.00/)).toBeInTheDocument();
  });

  it('shows View all link for sales when data is present', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/qualification': QUALIFIED,
      '/sales': SALES,
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER });

    const viewAll = await screen.findByText('View all');
    expect(viewAll).toHaveAttribute('href', '/member/sales');
  });

  it('reflects ineligibility from the server (BR-QUAL-001)', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/qualification': NOT_QUALIFIED,
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER_NOT_QUALIFIED });

    expect((await screen.findAllByText('Not qualified')).length).toBeGreaterThan(0);
    expect(
      await screen.findByText(
        'Complete the qualification requirements to submit qualifying sales.',
      ),
    ).toBeInTheDocument();
  });

  it('shows Submit sale CTA for qualified members', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/qualification': QUALIFIED,
      '/sales': { data: [], meta: {} },
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER });

    const cta = await screen.findByText('Submit sale');
    expect(cta).toHaveAttribute('href', '/member/sales/new');
  });

  it('hides Submit sale CTA for non-qualified members', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/qualification': NOT_QUALIFIED,
      '/sales': { data: [], meta: {} },
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER_NOT_QUALIFIED });

    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.queryByText('Submit sale')).not.toBeInTheDocument();
  });

  it('shows the server-computed pipeline pending estimate, not PENDING commissions', async () => {
    mockFetchRoutes({
      '/me/wallet': {
        availableBalance: '1280000.00',
        pendingAmount: '960000.00',
        pendingCommission: '1224000.00',
      },
      '/me/qualification': QUALIFIED,
      '/sales': { data: [], meta: {} },
    });
    renderMember(<DashboardPage />, { user: MOCK_MEMBER });

    // Pending is the wallet.pendingCommission (pipeline), not commissions.
    await screen.findByText('₱1,224,000.00');
    expect(screen.queryByText('₱960,000.00')).not.toBeInTheDocument();
  });
});
