import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { PayoutsPage } from './PayoutsPage';

describe('PayoutsPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<PayoutsPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Payouts')).toBeInTheDocument();
    expect(screen.getByText(/payout accounts/)).toBeInTheDocument();
  });

  it('renders payout accounts table with data', async () => {
    renderWithProviders(<PayoutsPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Juan Dela Cruz')).toBeInTheDocument();
    expect(screen.getByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Pedro Reyes')).toBeInTheDocument();
  });

  it('shows status chips', async () => {
    renderWithProviders(<PayoutsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Juan Dela Cruz');
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Admin Review').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Rejected').length).toBeGreaterThanOrEqual(1);
  });

  it('shows account identifiers unmasked for fund transfers', async () => {
    renderWithProviders(<PayoutsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Juan Dela Cruz');
    expect(screen.getByText('09171234567')).toBeInTheDocument();
    expect(screen.getByText('123456789012')).toBeInTheDocument();
  });

  it('shows the full number in the table and details dialog', async () => {
    const row = {
      id: 'pa-900',
      method: 'GCASH',
      accountName: 'Dialog Case',
      accountIdentifierMasked: '•••• 0199',
      accountIdentifier: '09175550199',
      status: 'PENDING',
      isPrimary: false,
      createdAt: '2026-08-20T10:00:00.000Z',
    };
    vi.stubGlobal(
      'fetch',
      async () =>
        new Response(JSON.stringify({ data: [row], meta: { page: 1, pageSize: 1, total: 1 } }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    const user = userEvent.setup();
    renderWithProviders(<PayoutsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('09175550199')).toBeInTheDocument();
    expect(screen.queryByText('•••• 0199')).not.toBeInTheDocument();
    await user.click(screen.getByText('09175550199'));
    expect(await screen.findByText('Payout Account Details')).toBeInTheDocument();
    expect(screen.getAllByText('09175550199').length).toBeGreaterThanOrEqual(1);
    vi.unstubAllGlobals();
  });
});
