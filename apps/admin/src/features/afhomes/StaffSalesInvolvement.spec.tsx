import { beforeEach, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/utils';
import { StaffSalesInvolvement } from './StaffSalesInvolvement';
import { getStaffSalesInvolvement } from './services';
vi.mock('./services', () => ({ getStaffSalesInvolvement: vi.fn() }));
const purchase = {
  id: 'import:one',
  customerId: '00000000-0000-4000-8000-000000000001',
  customerName: 'Synthetic Customer',
  customerNumber: 'AF-CUS-2026-900001',
  saleId: null,
  applicationId: null,
  reference: 'Synthetic purchase',
  tier: 'GOLD',
  status: 'imported_pending_review',
  createdAt: '2026-10-19T00:00:00Z',
  roles: ['VIP Recommender', 'Recommender SM'],
};
beforeEach(() => vi.mocked(getStaffSalesInvolvement).mockReset());
it('shows general purchase details, attribution and the customer link without payment verification actions', async () => {
  vi.mocked(getStaffSalesInvolvement).mockResolvedValue([purchase]);
  renderWithProviders(<StaffSalesInvolvement staffId="staff-one" />);
  expect(await screen.findByRole('link', { name: 'Synthetic Customer' })).toHaveAttribute(
    'href',
    `/admin/customers/${purchase.customerId}`,
  );
  expect(screen.getByText(/AF-CUS-2026-900001.*GOLD.*Synthetic purchase/)).toBeInTheDocument();
  expect(
    screen.getByText(/VIP Recommender, Recommender SM.*imported pending review/),
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /verify/i })).not.toBeInTheDocument();
});
it('paginates and shows an empty page', async () => {
  vi.mocked(getStaffSalesInvolvement)
    .mockResolvedValueOnce(Array.from({ length: 25 }, (_, i) => ({ ...purchase, id: String(i) })))
    .mockResolvedValue([]);
  renderWithProviders(<StaffSalesInvolvement staffId="staff-one" />);
  await screen.findAllByRole('link', { name: 'Synthetic Customer' });
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('No recorded involvement on this page.')).toBeInTheDocument();
  expect(getStaffSalesInvolvement).toHaveBeenLastCalledWith('staff-one', 25);
});
it('offers retry after a failed read', async () => {
  vi.mocked(getStaffSalesInvolvement)
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue([]);
  renderWithProviders(<StaffSalesInvolvement staffId="staff-one" />);
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('No recorded involvement on this page.')).toBeInTheDocument();
});
