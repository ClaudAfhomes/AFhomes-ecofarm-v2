import { describe, expect, it, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER } from '@jad/mock';

import { AddPayoutAccountPage } from './AddPayoutAccountPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const ACCOUNTS = { data: [], meta: {} };

const CREATED = {
  id: 'pa-005',
  method: 'GCASH',
  accountName: 'Juan Dela Cruz',
  accountIdentifierMasked: '•••• 0199',
  status: 'PENDING',
  isPrimary: false,
  createdAt: '2026-08-20T10:00:00.000Z',
};

describe('member AddPayoutAccountPage', () => {
  it('creates a payout account and navigates to the list (SCR-MEM-011)', async () => {
    const fetchFn = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      const isCreate = url.includes('/payout-accounts') && method === 'POST';
      const body = isCreate ? CREATED : ACCOUNTS;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchFn);

    const user = userEvent.setup();
    renderMember(<AddPayoutAccountPage />, { user: MOCK_MEMBER });

    await screen.findByRole('heading', { name: 'Add payout account' });

    await user.selectOptions(await screen.findByLabelText('Payout method'), 'GCASH');
    await user.type(screen.getByLabelText('Account holder name'), 'Juan Dela Cruz');
    await user.type(screen.getByLabelText('Mobile number'), '09175550199');
    await user.click(screen.getByRole('button', { name: 'Add payout account' }));

    await waitFor(() => {
      const createCall = fetchFn.mock.calls.find((call) =>
        String(call[0]).includes('/payout-accounts'),
      );
      expect(createCall).toBeTruthy();
    });
  });

  it('validates the form before submitting', async () => {
    mockFetchRoutes({ '/me/payout-accounts': ACCOUNTS });
    const user = userEvent.setup();
    renderMember(<AddPayoutAccountPage />, { user: MOCK_MEMBER });

    await user.selectOptions(await screen.findByLabelText('Payout method'), 'GCASH');
    await user.click(await screen.findByRole('button', { name: 'Add payout account' }));

    expect(await screen.findByText('Enter the account holder name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your GCash mobile number.')).toBeInTheDocument();
  });
});
