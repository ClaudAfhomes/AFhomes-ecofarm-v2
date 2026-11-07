import { expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/utils';
import { OstSalesPage } from './OstSalesPage';
vi.mock('./services', () => ({
  getOstSales: vi.fn().mockResolvedValue({
    data: [
      {
        id: 'sale',
        saleNumber: '26011500841G1C01S',
        customerName: 'Patricia Delos Reyes',
        customerNumber: '2025-0786',
        status: 'active',
        cashPriceSnapshot: '312000.00',
        createdAt: '2026-10-24T00:00:00Z',
      },
    ],
    meta: { total: 21, limit: 20, offset: 0 },
    summary: { qualifyingSales: 18 },
  }),
}));
it('uses full server totals across pages and shows imports in the ordinary sales table', async () => {
  renderWithProviders(<OstSalesPage />);
  await screen.findByText('Patricia Delos Reyes');
  expect(screen.getByRole('article', { name: 'Total Sales: 21' })).toBeInTheDocument();
  expect(screen.getByRole('article', { name: 'Qualifying Sales: 18' })).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Imported customer records' }),
  ).not.toBeInTheDocument();
});
