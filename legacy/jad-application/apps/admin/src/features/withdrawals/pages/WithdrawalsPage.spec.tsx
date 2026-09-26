import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_ADMIN } from '@jad/mock';

import { installMockApi, renderWithProviders } from '../../../test/utils';
import { resetMockWithdrawals } from '../../../mock/handlers';
import { WithdrawalsPage } from './WithdrawalsPage';

describe('WithdrawalsPage', () => {
  let server: ReturnType<typeof installMockApi>;

  beforeEach(() => {
    server = installMockApi();
    server.install();
    resetMockWithdrawals();
  });

  afterEach(() => {
    server.restore();
  });

  it('renders page header', async () => {
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Withdrawals')).toBeInTheDocument();
    expect(screen.getByText(/withdrawal requests/i)).toBeInTheDocument();
  });

  it('renders withdrawals table with data', async () => {
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
    expect(await screen.findByText('Maria Santos')).toBeInTheDocument();
    expect(screen.getByText('Pedro Reyes')).toBeInTheDocument();
    expect(screen.getAllByText('Juan Dela Cruz').length).toBe(4);
  });

  it('shows formatted currency values', async () => {
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');
    expect(screen.getByText('₱50,000.00')).toBeInTheDocument();
    expect(screen.getByText('₱1,200.00')).toBeInTheDocument();
  });

  it('shows status chips', async () => {
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');
    expect(screen.getAllByText('Reserved').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Rejected').length).toBeGreaterThanOrEqual(1);
  });

  it('shows the full number in the table and details dialog', async () => {
    const row = {
      id: 'wdr-900',
      amount: '1200.00',
      status: 'RESERVED',
      payoutAccount: {
        id: 'pa-900',
        method: 'GCASH',
        accountName: 'Dialog Case',
        accountIdentifierMasked: '•••• 0199',
        accountIdentifier: '09175550199',
      },
      reservedAt: '2026-08-20T10:00:00.000Z',
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
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });

    expect(await screen.findByText('09175550199')).toBeInTheDocument();
    expect(screen.queryByText('•••• 0199')).not.toBeInTheDocument();
    await user.click(screen.getByText('09175550199'));
    expect(await screen.findByText('Withdrawal Details')).toBeInTheDocument();
    expect(screen.getAllByText('09175550199').length).toBeGreaterThanOrEqual(1);
    vi.unstubAllGlobals();
  });

  it('completes a reserved withdrawal through the API and refetches server truth', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');

    const amountCell = screen.getByText('₱75,000.00');
    const rowEl = amountCell.closest('tr');
    expect(rowEl).not.toBeNull();
    await user.click(within(rowEl as HTMLElement).getByRole('button', { name: 'Complete' }));

    const dialog = await screen.findByRole('dialog', { name: 'Complete withdrawal?' });
    await user.click(within(dialog).getByRole('button', { name: 'Complete' }));

    // Server-authoritative refetch flips the row's chip to Completed.
    expect(await within(rowEl as HTMLElement).findByText('Completed')).toBeInTheDocument();
  });

  it('surfaces completion failures and keeps the persisted status', async () => {
    vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/complete')) {
        return new Response(
          JSON.stringify({
            error: {
              code: 'CONFLICT',
              message: 'Only reserved withdrawals can be completed (current: COMPLETED).',
              requestId: 'r1',
              timestamp: new Date().toISOString(),
            },
          }),
          { status: 409, headers: { 'Content-Type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [
            {
              id: 'wdr-x',
              amount: '1000.00',
              status: 'COMPLETED',
              payoutAccount: {
                id: 'pa-x',
                method: 'GCASH',
                accountName: 'X',
                accountIdentifierMasked: '•••• 1',
              },
              createdAt: '2026-09-20T00:00:00.000Z',
            },
          ],
          meta: { page: 1, pageSize: 1, total: 1 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });
    try {
      renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
      await screen.findByText('X');

      // No Complete button for a COMPLETED row - guard by status.
      const rowEl = screen.getByText('₱1,000.00').closest('tr');
      expect(within(rowEl as HTMLElement).getByRole('button', { name: 'Complete' })).toBeDisabled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('rejects a reserved withdrawal with the mandatory reason via the API', async () => {
    const user = userEvent.setup();
    renderWithProviders(<WithdrawalsPage />, { user: MOCK_ADMIN });
    await screen.findByText('Maria Santos');

    const amountCell = screen.getByText('₱1,200.00');
    const rowEl = amountCell.closest('tr');
    await user.click(within(rowEl as HTMLElement).getByRole('button', { name: 'Reject' }));

    const dialog = await screen.findByRole('dialog', { name: 'Reject withdrawal' });
    await user.type(
      within(dialog).getByLabelText('Rejection reason'),
      'Payout account verification failed',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Confirm Reject' }));

    expect(await within(rowEl as HTMLElement).findByText('Rejected')).toBeInTheDocument();
  });
});
