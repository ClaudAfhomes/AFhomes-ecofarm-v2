import { fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AfHomesPermission } from '@afhomes/contracts';

import { renderWithProviders } from '../../test/utils';
import type { SessionUser } from '../../lib/session';
import { BusinessCustomersPage } from './BusinessCustomersPage';
import { BusinessProductsPage } from './BusinessProductsPage';
import { CustomerApplicationsPage, ReservationAgreementsPage } from './OfficialFormsPages';
import {
  getCardCategories,
  getCardProducts,
  getCustomerApplicationsPage,
  getCustomersPage,
  getReservationAgreementsPage,
} from './services';

vi.mock('./services', () => ({
  createCardCategory: vi.fn(),
  createCardProduct: vi.fn(),
  createCustomer: vi.fn(),
  createCustomerApplication: vi.fn(),
  createReservationAgreement: vi.fn(),
  deactivateCustomer: vi.fn(),
  decideCustomerApplication: vi.fn(),
  decideReservationAgreement: vi.fn(),
  deleteCustomer: vi.fn(),
  exportCustomerApplication: vi.fn(),
  exportReservationAgreement: vi.fn(),
  getCardCategories: vi.fn(),
  getCardProduct: vi.fn(),
  getCardProducts: vi.fn(),
  getCustomerApplication: vi.fn(),
  getCustomerApplications: vi.fn(),
  getCustomerApplicationsPage: vi.fn(),
  getCustomerById: vi.fn(),
  getCustomers: vi.fn(),
  getCustomersPage: vi.fn(),
  getOfficialFormTemplate: vi.fn(),
  getReservationAgreement: vi.fn(),
  getReservationAgreements: vi.fn(),
  getReservationAgreementsPage: vi.fn(),
  getSaleSummary: vi.fn(),
  getSales: vi.fn(),
  issueCustomerAccountActivation: vi.fn(),
  previewOfficialFormImport: vi.fn(),
  reopenCustomerApplication: vi.fn(),
  reopenReservationAgreement: vi.fn(),
  submitCustomerApplication: vi.fn(),
  submitReservationAgreement: vi.fn(),
  updateCardCategory: vi.fn(),
  updateCardProduct: vi.fn(),
  updateCustomerApplication: vi.fn(),
  updateReservationAgreement: vi.fn(),
}));

vi.mock('../../lib/api/client', () => ({
  requestList: vi.fn().mockResolvedValue([]),
  setApiAccessTokenForTests: vi.fn(),
}));

const grant = (moduleKey: AfHomesPermission['moduleKey']): AfHomesPermission => ({
  moduleKey,
  canView: true,
  canCreate: false,
  canUpdate: false,
  canDelete: false,
});

const STAFF: SessionUser = {
  id: 'u-staff',
  name: 'Staff User',
  email: 'staff@afhomes.test',
  roleId: 'r-staff',
  roleSlug: 'admin',
  roleName: 'Admin',
  status: 'active',
  afHomesPermissions: [grant('sales.customers')],
};

/**
 * Mobile card contract: every directory/queue table carries a `data-label`
 * on each body cell matching its column header. The ≤639px stylesheets
 * render those labels as the card rows (`td::before`), so a dropped label
 * silently ships an unlabeled card field on phones.
 */
function expectLabeledCards(table: HTMLElement, headers: string[]) {
  const headCells = within(table).getAllByRole('columnheader').map((th) => th.textContent);
  expect(headCells).toEqual(headers);
  // Directory rows carry role="link" (they navigate on click), so select
  // body rows structurally rather than by the "row" role.
  const bodyRows = Array.from(table.querySelectorAll('tbody > tr'));
  expect(bodyRows.length).toBeGreaterThan(0);
  for (const tr of bodyRows) {
    const cells = Array.from(tr.querySelectorAll(':scope > td'));
    expect(cells.map((td) => td.getAttribute('data-label'))).toEqual(headers);
  }
}

beforeEach(() => {
  vi.mocked(getCardProducts).mockResolvedValue([]);
});

describe('directory tables carry mobile card labels', () => {
  it('customers: Name, Payment Status, VIP Tier, Status, Actions', async () => {
    vi.mocked(getCustomersPage).mockResolvedValue({
      data: [
        {
          id: 'c-1',
          customerNumber: 'CUS-000001',
          fullName: 'MARIA SANTOS',
          status: 'active',
          tier: 'GOLD',
          frozenTotal: '60000.00',
          verifiedPaid: '60000.00',
        },
      ],
      total: 1,
    } as never);
    renderWithProviders(<BusinessCustomersPage />, { user: STAFF });
    const table = await screen.findByRole('table');
    expectLabeledCards(table, ['Name', 'Payment Status', 'VIP Tier', 'Status', 'Actions']);
  });

  it('applications: Application, Applicant, Tier, Seller, Status', async () => {
    vi.mocked(getCustomerApplicationsPage).mockResolvedValue({
      data: [
        {
          id: 'app-1',
          applicationNumber: 'APP-000001',
          applicantName: 'MARIA SANTOS',
          tier: 'GOLD',
          sellerName: 'Sam Seller',
          status: 'submitted',
        },
      ],
      total: 1,
    } as never);
    renderWithProviders(<CustomerApplicationsPage />);
    const table = await screen.findByRole('table');
    expectLabeledCards(table, ['Application', 'Applicant', 'Tier', 'Seller', 'Status']);
  });

  it('reservations: Reservation, Applicant, Tier, Payment scheme, Amount, Payment', async () => {
    vi.mocked(getReservationAgreementsPage).mockResolvedValue({
      data: [
        {
          id: 'res-1',
          reservationNumber: 'RES-000001',
          applicantName: 'QA IST Applicant',
          tier: 'SILVER',
          paymentScheme: 'spot_cash',
          totalPrice: '312000.00',
          hasSecondaryHolder: false,
          status: 'submitted',
          paymentStatus: null,
        },
      ],
      total: 1,
    } as never);
    renderWithProviders(<ReservationAgreementsPage />);
    const table = await screen.findByRole('table');
    expectLabeledCards(table, [
      'Reservation',
      'Applicant',
      'Tier',
      'Payment scheme',
      'Amount',
      'Payment',
    ]);
  });

  it('product categories: Name, Slug, Description, Status, Sort Order, Plans, Actions', async () => {
    vi.mocked(getCardCategories).mockResolvedValue([
      {
        id: '99999999-9999-4999-8999-999999999999',
        slug: 'membership',
        name: 'Membership Cards',
        description: null,
        isActive: true,
        sortOrder: 10,
        planCount: 3,
      },
    ] as never);
    renderWithProviders(<BusinessProductsPage />, { user: STAFF });
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
    const table = await screen.findByRole('table');
    expectLabeledCards(table, [
      'Name',
      'Slug',
      'Description',
      'Status',
      'Sort Order',
      'Plans',
      'Actions',
    ]);
  });
});
