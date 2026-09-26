import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { SalesPage } from './SalesPage';

describe('SalesPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<SalesPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Sales')).toBeInTheDocument();
    expect(screen.getByText('All sales submissions and their status')).toBeInTheDocument();
  });

  it('renders sales table with data', async () => {
    renderWithProviders(<SalesPage />, { user: MOCK_ADMIN });
    await screen.findAllByText('250 SQM Farm Lot with Hotspring');
    expect(
      screen.getAllByText('Prisma Residences - Celeste Building Condo').length,
    ).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Juan Dela Cruz').length).toBeGreaterThanOrEqual(1);
    // Customer column removed; seller id no longer shown under the name.
    expect(screen.queryByText('Ramon Reyes')).not.toBeInTheDocument();
  });

  it('shows formatted currency values', async () => {
    renderWithProviders(<SalesPage />, { user: MOCK_ADMIN });
    await screen.findAllByText('250 SQM Farm Lot with Hotspring');
    expect(screen.getAllByText('₱1,200,000.00').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('₱8,600,000.00').length).toBeGreaterThanOrEqual(1);
  });

  it('shows status chips', async () => {
    renderWithProviders(<SalesPage />, { user: MOCK_ADMIN });
    await screen.findAllByText('250 SQM Farm Lot with Hotspring');
    expect(screen.getAllByText('Submitted').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Admin Approved').length).toBeGreaterThanOrEqual(1);
  });
});
