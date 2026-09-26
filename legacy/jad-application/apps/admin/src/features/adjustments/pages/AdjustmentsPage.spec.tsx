import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { AdjustmentsPage } from './AdjustmentsPage';

describe('AdjustmentsPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<AdjustmentsPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Adjustments')).toBeInTheDocument();
    expect(screen.getByText(/manual ledger adjustments/i)).toBeInTheDocument();
  });

  it('renders adjustments table with data', async () => {
    renderWithProviders(<AdjustmentsPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('Liza Lopez')).toBeInTheDocument();
  });

  it('shows formatted currency values', async () => {
    renderWithProviders(<AdjustmentsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');
    expect(screen.getByText('₱250.00')).toBeInTheDocument();
    expect(screen.getByText('₱150.00')).toBeInTheDocument();
  });

  it('shows direction indicators', async () => {
    renderWithProviders(<AdjustmentsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');
    expect(screen.getAllByText('CREDIT').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('DEBIT')).toBeInTheDocument();
  });
});
