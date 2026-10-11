import { screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import { breadcrumbItems, canAccessNavTarget, navItemsForPermissions } from '../../app/navigation';
import { PaymentSchemeGuidePage } from './PaymentSchemeGuidePage';
import { getCardProducts } from './services';

vi.mock('./services', () => ({
  getCardProducts: vi.fn(),
}));

const mockedGetCardProducts = vi.mocked(getCardProducts);

const permission = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

const GOLD = {
  id: '33333333-3333-4333-8333-333333333333',
  categoryId: '99999999-9999-4999-8999-999999999999',
  categoryName: 'Membership Cards',
  categoryIsActive: true,
  code: 'GOLD',
  name: 'Gold',
  description: null,
  cashPrice: '312000.00',
  installmentPrice: '390000.00',
  reservationFee: '10000.00',
  spotCashDays: 7,
  standardInstallmentMonths: 4,
  validityYears: 22,
  moveAEnabled: true,
  moveB1Enabled: true,
  moveB2Enabled: true,
  minimumDownPayment: '20000.00',
  yearlyPoints: 25000,
  discountPercent: 25,
  baseValidityYears: 20,
  validityExtensionYears: 2,
  cardholderLimit: 2,
  annualPointsTranches: 20,
  totalLoyaltyValue: '500000.00',
  priorityReservation: true,
  noMonthlyAnnualDues: true,
  commissionRate: '0',
  isActive: true,
  sortOrder: 10,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

afterEach(() => vi.clearAllMocks());

describe('payment scheme guide (internal IST reference)', () => {
  it('renders live tier figures with the internal-use banner', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    renderWithProviders(<PaymentSchemeGuidePage />);
    expect(await screen.findByText('Payment Scheme Guide')).toBeInTheDocument();
    expect(screen.getByText('Internal sales team use only')).toBeInTheDocument();
    expect(screen.getByText(/Do not share this page/i)).toBeInTheDocument();
    expect(await screen.findAllByText('₱312,000.00')).not.toHaveLength(0);
    expect(screen.getAllByText('₱390,000.00')).not.toHaveLength(0);
    expect(screen.getByText('22 years')).toBeInTheDocument();
    expect(screen.getByText(/Never chain Move A into B1 or B2/i)).toBeInTheDocument();
  });

  /**
   * The confidentiality banner must be visible from the FIRST paint. Gating it
   * behind the data it warns about would leave a blank, unlabelled page for the
   * duration of the fetch, with nothing telling the operator the page is
   * confidential.
   */
  it('shows the internal-use banner before the tiers have loaded', async () => {
    mockedGetCardProducts.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<PaymentSchemeGuidePage />);
    expect(screen.getByText('Internal sales team use only')).toBeInTheDocument();
    expect(screen.getByText(/Do not share this page/i)).toBeInTheDocument();
    // And the loading state announces itself, by name, without inventing figures.
    // The banner is itself a polite live region, so the loading region is
    // targeted by its label rather than assumed to be the only status.
    expect(screen.getByRole('status', { name: 'Loading tiers…' })).toBeInTheDocument();
    expect(screen.queryByText('Standard offer')).not.toBeInTheDocument();
  });

  it('structures the guide into numbered sections and a print action', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    renderWithProviders(<PaymentSchemeGuidePage />);
    await screen.findByText('Standard offer');
    const headings = ['Standard offer', 'Internal flow', 'Sample schedules', 'Golden rules'];
    for (const title of headings) {
      expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
      expect(screen.getByRole('region', { name: title })).toBeInTheDocument();
    }
    // Ordered lists carry the reading order the numbers imply.
    expect(screen.getAllByRole('list').map((list) => list.children.length)).toEqual([4, 7]);
    expect(screen.getByRole('button', { name: 'Print guide' })).toBeInTheDocument();
    // Each enabled move is its own pill, so a tier's availability is scannable.
    expect(screen.getByText('Move A')).toBeInTheDocument();
    expect(screen.getByText('Move B1')).toBeInTheDocument();
    expect(screen.getByText('Move B2')).toBeInTheDocument();
  });

  it('is reachable only with the sales grant (never customer, never anonymous)', () => {    const sales = navItemsForPermissions([permission('dashboard.view'), permission('sales.card_sales')]);
    const group = sales.find((item) => item.label === 'Sales');
    expect(group?.dropdown?.map((d) => ('label' in d ? d.label : ''))).toContain(
      'Payment Scheme Guide',
    );
    expect(canAccessNavTarget([permission('dashboard.view')], '/admin/sales/payment-scheme-guide')).toBe(false);
    expect(
      canAccessNavTarget(
        [permission('dashboard.view'), permission('sales.card_sales')],
        '/admin/sales/payment-scheme-guide',
      ),
    ).toBe(true);
    expect(
      breadcrumbItems('/admin/sales/payment-scheme-guide'),
    ).toEqual([
      { label: 'Dashboard', to: '/admin' },
      { label: 'Sales' },
      { label: 'Payment Scheme Guide' },
    ]);
  });
});
