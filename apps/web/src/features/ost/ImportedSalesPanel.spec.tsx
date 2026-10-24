import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/utils';
import { ImportedSalesPanel } from './ImportedSalesPanel';
const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./services', () => ({ getImportedSales: mocks.get }));
it('shows recorded involvement and settled treatment with bounded pagination', async () => {
  mocks.get.mockImplementation(async (page: number) => ({
    data:
      page === 1
        ? [
            {
              id: 'source',
              reference: '26011500841G1C01S',
              customerName: 'Patricia Delos Reyes',
              customerNumber: '2025-0786',
              tier: 'GOLD',
              status: 'active',
              roles: ['VIP Recommender'],
              amount: '312000.00',
              commissionPolicy: 'settled_before_system',
            },
          ]
        : [],
    meta: { page, pageSize: 25, total: 26 },
  }));
  renderWithProviders(<ImportedSalesPanel />);
  expect(await screen.findByText('Settled before system')).toBeInTheDocument();
  expect(screen.getByText('VIP Recommender')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('No imported customer records')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled();
  expect(mocks.get).toHaveBeenLastCalledWith(2, expect.any(AbortSignal));
});
it('offers retry when imported records fail to load', async () => {
  mocks.get.mockRejectedValue(new Error('Unavailable'));
  renderWithProviders(<ImportedSalesPanel />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load imported records');
});
