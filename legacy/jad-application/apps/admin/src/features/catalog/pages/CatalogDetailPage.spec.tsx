import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { CatalogDetailPage } from './CatalogDetailPage';

// Mock useProperty to return a known property
vi.mock('../hooks/useProperty', () => ({
  useProperty: () => ({
    data: {
      id: 'igp-250-sqm-farm-lot',
      name: '250 SQM Farm Lot with Hotspring',
      categoryId: 'income-generating-properties',
      price: '1200000.00',
      status: 'ACTIVE',
    },
    isPending: false,
    isError: false,
    error: null,
  }),
}));

vi.mock('../hooks/useDeleteProperty', () => ({
  useDeleteProperty: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
}));

describe('CatalogDetailPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders property name and detail fields', async () => {
    renderWithProviders(<CatalogDetailPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('250 SQM Farm Lot with Hotspring')).toBeInTheDocument();
    expect(screen.getByText('Property ID')).toBeInTheDocument();
    expect(screen.getByText('igp-250-sqm-farm-lot')).toBeInTheDocument();
    expect(screen.getByText('Category')).toBeInTheDocument();
    expect(screen.getAllByText('Price').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Status')).toBeInTheDocument();
  });

  it('shows back link to properties list', async () => {
    renderWithProviders(<CatalogDetailPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Back to properties')).toBeInTheDocument();
  });

  it('shows Edit and Delete buttons', async () => {
    renderWithProviders(<CatalogDetailPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Edit')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('shows key facts section from CMS data', async () => {
    renderWithProviders(<CatalogDetailPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Key Facts')).toBeInTheDocument();
    expect(screen.getByText('Lot area')).toBeInTheDocument();
    expect(screen.getAllByText('250 m²').length).toBeGreaterThanOrEqual(1);
  });

  it('shows highlights section from CMS data', async () => {
    renderWithProviders(<CatalogDetailPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Highlights')).toBeInTheDocument();
    expect(screen.getByText('Natural hot spring property')).toBeInTheDocument();
  });

  it('shows location and area from CMS data', async () => {
    renderWithProviders(<CatalogDetailPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Laguna')).toBeInTheDocument();
    expect(screen.getByText('Area')).toBeInTheDocument();
  });
});
