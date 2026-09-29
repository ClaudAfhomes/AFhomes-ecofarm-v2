import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CardCategory, CardProduct, Customer } from '@jad/contracts';

import { renderWithProviders } from '../../test/utils';
import { BusinessCustomersPage } from './BusinessCustomersPage';
import { BusinessProductsPage } from './BusinessProductsPage';
import {
  createCardCategory,
  createCardProduct,
  getCardCategories,
  getCardProducts,
  updateCardCategory,
  updateCardProduct,
} from './services';

vi.mock('./services', () => ({
  getCardProducts: vi.fn(),
  getCardProduct: vi.fn(),
  createCardProduct: vi.fn(),
  updateCardProduct: vi.fn(),
  getCardCategories: vi.fn(),
  createCardCategory: vi.fn(),
  updateCardCategory: vi.fn(),
  getCustomers: vi.fn(),
  createCustomer: vi.fn(),
  createSale: vi.fn(),
}));

const mockedGetCardProducts = vi.mocked(getCardProducts);
const mockedCreateCardProduct = vi.mocked(createCardProduct);
const mockedUpdateCardProduct = vi.mocked(updateCardProduct);
const mockedGetCardCategories = vi.mocked(getCardCategories);
const mockedCreateCardCategory = vi.mocked(createCardCategory);
const mockedUpdateCardCategory = vi.mocked(updateCardCategory);

const MEMBERSHIP_CATEGORY_ID = '99999999-9999-4999-8999-999999999999';

const GOLD: CardProduct = {
  id: '33333333-3333-4333-8333-333333333333',
  categoryId: MEMBERSHIP_CATEGORY_ID,
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
  yearlyPoints: 60000,
  commissionRate: '0.04',
  isActive: true,
  sortOrder: 10,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

const JADE: CardProduct = {
  ...GOLD,
  id: '44444444-4444-4434-8444-444444444444',
  code: 'JADE',
  name: 'Jade',
  description: 'A fourth plan.',
  cashPrice: '80000.00',
  minimumDownPayment: '25000.00',
  yearlyPoints: 80000,
  sortOrder: 5,
};

const RETIRED: CardProduct = {
  ...GOLD,
  id: '55555555-5555-4535-8555-555555555555',
  code: 'LEGACY',
  name: 'Legacy Card',
  isActive: false,
  sortOrder: 40,
};

const SHELVED: CardProduct = {
  ...GOLD,
  id: '66666666-6666-4636-8666-666666666666',
  code: 'SHELVED',
  name: 'Shelved Gold',
  categoryIsActive: false,
  sortOrder: 15,
};

const MEMBERSHIP: CardCategory = {
  id: MEMBERSHIP_CATEGORY_ID,
  slug: 'membership',
  name: 'Membership Cards',
  description: null,
  isActive: true,
  sortOrder: 10,
  planCount: 3,
};

const VIP: CardCategory = {
  id: '77777777-7777-4737-8777-777777777777',
  slug: 'vip-cards',
  name: 'VIP Cards',
  description: 'Premium tier.',
  isActive: true,
  sortOrder: 5,
  planCount: 0,
};

const CUSTOMER: Customer = {
  id: 'aaaaaaaa-0000-4000-8000-000000000001',
  customerNumber: 'CUS-000001',
  fullName: 'Ada Customer',
  email: 'ada@example.com',
  phone: '09170000001',
  dateOfBirth: '1990-01-01',
  gender: null,
  address: null,
  governmentIdType: null,
  governmentIdMasked: null,
  status: 'prospect',
  createdBy: null,
  createdAt: '2026-09-28T00:00:00.000Z',
  updatedAt: '2026-09-28T00:00:00.000Z',
};

async function openApplicationDialog() {
  const { getCustomers } = await import('./services');
  vi.mocked(getCustomers).mockResolvedValue([CUSTOMER]);
  renderWithProviders(<BusinessCustomersPage />);
  fireEvent.click(await screen.findByRole('button', { name: 'New application' }));
}

afterEach(() => vi.clearAllMocks());

beforeEach(() => {
  mockedGetCardCategories.mockResolvedValue([]);
});

describe('Card Plans states', () => {
  it('shows loading while the API request is pending', () => {
    mockedGetCardProducts.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<BusinessProductsPage />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading card plans');
  });

  it('shows the empty state after an empty response', async () => {
    mockedGetCardProducts.mockResolvedValue([]);
    renderWithProviders(<BusinessProductsPage />);
    expect(await screen.findByText('No card plans')).toBeInTheDocument();
  });

  it('renders every required column for a populated plan', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP]);
    renderWithProviders(<BusinessProductsPage />);
    expect(await screen.findByText('GOLD')).toBeInTheDocument();
    for (const heading of [
      'Name',
      'Code',
      'Category',
      'Spot Cash',
      'Installment',
      'Reservation',
      'Validity',
      'Moves',
      'Yearly Points',
      'Commission',
      'Status',
      'Display Order',
      'Actions',
    ]) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText('Membership Cards')).toBeInTheDocument();
    expect(screen.getByText('₱312,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱390,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱10,000.00')).toBeInTheDocument();
    expect(screen.getByText('22 years')).toBeInTheDocument();
    expect(screen.getByText('A · B1 · B2')).toBeInTheDocument();
    expect(screen.queryByText('₱20,000.00')).not.toBeInTheDocument();
    expect(screen.getByText('60,000')).toBeInTheDocument();
    expect(screen.getByText('4.00%')).toBeInTheDocument();
    expect(screen.getAllByText('Active')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add Card Plan' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View/Edit' })).toBeInTheDocument();
  });

  it('replaces loading with a retryable API error state', async () => {
    mockedGetCardProducts.mockRejectedValue(new Error('Plans service unavailable'));
    renderWithProviders(<BusinessProductsPage />);
    await waitFor(() => expect(screen.queryByText('Loading card plans…')).not.toBeInTheDocument());
    expect(screen.getByRole('alert')).toHaveTextContent('Plans service unavailable');
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('offers search and active/inactive filters', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    renderWithProviders(<BusinessProductsPage />);
    await screen.findByText('GOLD');
    expect(screen.getByRole('searchbox', { name: 'Search card plans' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter by status' })).toBeInTheDocument();
  });

  it('creates a plan and refreshes the list', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP]);
    mockedCreateCardProduct.mockResolvedValue(JADE);
    renderWithProviders(<BusinessProductsPage />);
    await screen.findByText('GOLD');

    fireEvent.click(screen.getByRole('button', { name: 'Add Card Plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Jade' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'JADE' } });
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: MEMBERSHIP_CATEGORY_ID },
    });
    fireEvent.change(screen.getByLabelText('Spot cash price'), { target: { value: '80000.00' } });
    fireEvent.change(screen.getByLabelText('4-month installment price'), {
      target: { value: '100000.00' },
    });
    fireEvent.change(screen.getByLabelText('Yearly points'), { target: { value: '80000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create plan' }));

    await waitFor(() => expect(mockedCreateCardProduct).toHaveBeenCalled());
    expect(mockedCreateCardProduct.mock.calls[0]![0]).toMatchObject({
      name: 'Jade',
      code: 'JADE',
      categoryId: MEMBERSHIP_CATEGORY_ID,
      cashPrice: '80000.00',
    });
  });

  it('blocks an invalid create with an understandable error', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP]);
    renderWithProviders(<BusinessProductsPage />);
    await screen.findByText('GOLD');

    fireEvent.click(screen.getByRole('button', { name: 'Add Card Plan' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('Code'), { target: { value: 'BAD' } });
    fireEvent.change(screen.getByLabelText('Category'), {
      target: { value: MEMBERSHIP_CATEGORY_ID },
    });
    fireEvent.change(screen.getByLabelText('Spot cash price'), { target: { value: '5000.00' } });
    fireEvent.change(screen.getByLabelText('4-month installment price'), {
      target: { value: '12000.00' },
    });
    fireEvent.change(screen.getByLabelText('Yearly points'), { target: { value: '80000' } });
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Reservation fee cannot exceed the spot cash price',
    );
    expect(mockedCreateCardProduct).not.toHaveBeenCalled();
  });

  it('deactivates a plan through the row action', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    mockedUpdateCardProduct.mockResolvedValue({ ...GOLD, isActive: false });
    renderWithProviders(<BusinessProductsPage />);
    await screen.findByText('GOLD');

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(mockedUpdateCardProduct).toHaveBeenCalledWith(GOLD.id, {
      isActive: false,
    }));
  });
});

describe('New Card Application plan options', () => {
  it('lists active plans dynamically from the backend, with no hardcoded set', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD, JADE]);
    await openApplicationDialog();
    expect(await screen.findByText('Jade — JADE')).toBeInTheDocument();
    expect(screen.getByText('Gold — GOLD')).toBeInTheDocument();
  });

  it('excludes inactive plans from the application options', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD, RETIRED]);
    await openApplicationDialog();
    expect(await screen.findByText('Gold — GOLD')).toBeInTheDocument();
    expect(screen.queryByText('Legacy Card — LEGACY')).not.toBeInTheDocument();
  });

  it('shows a plans loading state inside the dialog', async () => {
    mockedGetCardProducts.mockReturnValue(new Promise(() => {}));
    await openApplicationDialog();
    expect(await screen.findByText('Loading card plans…')).toBeInTheDocument();
  });

  it('shows an empty state when no active plan exists', async () => {
    mockedGetCardProducts.mockResolvedValue([RETIRED]);
    await openApplicationDialog();
    expect(await screen.findByText('No active card plans available.')).toBeInTheDocument();
  });

  it('excludes an active plan shelved under an inactive category', async () => {
    mockedGetCardProducts.mockResolvedValue([GOLD, SHELVED]);
    await openApplicationDialog();
    expect(await screen.findByText('Gold — GOLD')).toBeInTheDocument();
    expect(screen.queryByText('Shelved Gold — SHELVED')).not.toBeInTheDocument();
  });
});

describe('Categories tab', () => {
  async function openCategoriesTab() {
    mockedGetCardProducts.mockResolvedValue([GOLD]);
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP, VIP]);
    renderWithProviders(<BusinessProductsPage />);
    await screen.findByText('GOLD');
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
  }

  it('lists categories with plan counts', async () => {
    await openCategoriesTab();
    expect(await screen.findByText('vip-cards')).toBeInTheDocument();
    for (const heading of ['Name', 'Slug', 'Description', 'Status', 'Sort Order', 'Plans']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument();
    }
    expect(screen.getByText('Premium tier.')).toBeInTheDocument();
  });

  it('shows loading, empty and error states', async () => {
    mockedGetCardProducts.mockResolvedValue([]);
    mockedGetCardCategories.mockReturnValue(new Promise(() => {}));
    renderWithProviders(<BusinessProductsPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Categories' }));
    expect(await screen.findByText('Loading categories…')).toBeInTheDocument();
  });

  it('creates a category and refreshes the list', async () => {
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP]);
    mockedCreateCardCategory.mockResolvedValue(VIP);
    mockedGetCardProducts.mockResolvedValue([]);
    renderWithProviders(<BusinessProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Categories' }));
    await screen.findByText('membership');

    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'VIP Cards' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'vip-cards' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create category' }));

    await waitFor(() => expect(mockedCreateCardCategory).toHaveBeenCalled());
    expect(mockedCreateCardCategory.mock.calls[0]![0]).toMatchObject({
      name: 'VIP Cards',
      slug: 'vip-cards',
    });
  });

  it('blocks an invalid slug with an understandable error', async () => {
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP]);
    mockedGetCardProducts.mockResolvedValue([]);
    renderWithProviders(<BusinessProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Categories' }));
    await screen.findByText('membership');

    fireEvent.click(screen.getByRole('button', { name: 'Add Category' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Bad' } });
    fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'not a slug!' } });
    expect(screen.getByRole('alert')).toHaveTextContent('Slug must start with a letter');
    expect(mockedCreateCardCategory).not.toHaveBeenCalled();
  });

  it('deactivates a category through the row action', async () => {
    mockedGetCardCategories.mockResolvedValue([MEMBERSHIP]);
    mockedUpdateCardCategory.mockResolvedValue({ ...MEMBERSHIP, isActive: false });
    mockedGetCardProducts.mockResolvedValue([]);
    renderWithProviders(<BusinessProductsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Categories' }));
    await screen.findByText('membership');

    fireEvent.click(screen.getByRole('button', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(mockedUpdateCardCategory).toHaveBeenCalledWith(MEMBERSHIP_CATEGORY_ID, {
        isActive: false,
      }),
    );
  });
});
