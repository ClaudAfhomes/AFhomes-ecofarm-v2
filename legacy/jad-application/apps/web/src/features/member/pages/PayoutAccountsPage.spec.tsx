import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER } from '@jad/mock';

import { PayoutAccountsPage } from './PayoutAccountsPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const ACCOUNTS = {
  data: [
    {
      id: 'pa-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '•••• 7890',
      status: 'CONFIRMED',
      isPrimary: true,
      createdAt: '2026-07-20T10:00:00.000Z',
    },
    {
      id: 'pa-002',
      method: 'DIGITAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '•••• 3210',
      status: 'CONFIRMED',
      isPrimary: false,
      createdAt: '2026-07-25T10:00:00.000Z',
    },
    {
      id: 'pa-003',
      method: 'GCASH',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '•••• 0199',
      status: 'PENDING',
      isPrimary: false,
      createdAt: '2026-08-17T10:00:00.000Z',
    },
  ],
  meta: {},
};

const PROMOTED = {
  data: [
    { ...ACCOUNTS.data[0]!, isPrimary: false },
    { ...ACCOUNTS.data[1]!, isPrimary: true },
    ACCOUNTS.data[2],
  ],
  meta: {},
};

describe('member PayoutAccountsPage', () => {
  it('renders accounts with masked identifiers, lifecycle status, and Primary badge', async () => {
    mockFetchRoutes({ '/me/payout-accounts': ACCOUNTS });
    renderMember(<PayoutAccountsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Traditional bank')).toBeInTheDocument();
    expect(screen.getByText('Digital bank')).toBeInTheDocument();
    expect(screen.getByText(/•••• 7890/)).toBeInTheDocument();
    expect(screen.getByText('Primary')).toBeInTheDocument();
    expect(screen.getAllByText('Pending').length).toBeGreaterThanOrEqual(1);
  });

  it('promotes another confirmed account to Primary and refreshes (BR-PAY-006)', async () => {
    let calls = 0;
    const fetchFn = (input: RequestInfo | URL) => {
      const url = String(input);
      calls += 1;
      const isPatch = url.includes('/payout-accounts/pa-002');
      return Promise.resolve(
        new Response(
          JSON.stringify(isPatch ? { data: [ACCOUNTS.data[1]!] } : calls > 1 ? PROMOTED : ACCOUNTS),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        ),
      );
    };
    vi.stubGlobal('fetch', fetchFn);
    const user = userEvent.setup();
    renderMember(<PayoutAccountsPage />, { user: MOCK_MEMBER });

    const buttons = await screen.findAllByRole('button', { name: 'Set as primary' });
    await user.click(buttons[0]!);

    await waitFor(() => expect(screen.getByText('Primary')).toBeInTheDocument());
    expect(screen.getAllByText('Primary')).toHaveLength(1);
    expect(screen.queryByText('Payout account details')).not.toBeInTheDocument();
  });

  it('shows the full account number in the list and details dialog', async () => {
    mockFetchRoutes({
      '/me/payout-accounts': {
        data: [
          {
            id: 'pa-001',
            method: 'GCASH',
            accountName: 'Juan Dela Cruz',
            accountIdentifierMasked: '•••• 0199',
            accountIdentifier: '09175550199',
            status: 'CONFIRMED',
            isPrimary: true,
            createdAt: '2026-07-20T10:00:00.000Z',
          },
        ],
        meta: {},
      },
    });
    const user = userEvent.setup();
    renderMember(<PayoutAccountsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/09175550199/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
    await user.click(screen.getByText(/09175550199/));
    expect(await screen.findByText('Payout account details')).toBeInTheDocument();
    expect(screen.getAllByText(/09175550199/).length).toBeGreaterThanOrEqual(1);
  });

  it('shows an empty state and links to add the first account', async () => {
    mockFetchRoutes({ '/me/payout-accounts': { data: [], meta: {} } });
    renderMember(<PayoutAccountsPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No payout accounts yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a payout account' })).toHaveAttribute(
      'href',
      '/member/payouts/new',
    );
  });
});
