import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { WithdrawalsListPage } from './WithdrawalsListPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const WITHDRAWALS = {
  data: [
    {
      id: 'wdr-003',
      amount: '75000.00',
      status: 'RESERVED',
      payoutAccount: {
        id: 'pa-001',
        method: 'TRADITIONAL_BANK',
        accountName: 'Juan Dela Cruz',
        accountIdentifierMasked: '•••• 7890',
      },
      reservedAt: '2026-08-20T10:00:00.000Z',
      createdAt: '2026-08-20T10:00:00.000Z',
    },
    {
      id: 'wdr-001',
      amount: '50000.00',
      status: 'COMPLETED',
      payoutAccount: {
        id: 'pa-001',
        method: 'TRADITIONAL_BANK',
        accountName: 'Juan Dela Cruz',
        accountIdentifierMasked: '•••• 7890',
      },
      reservedAt: '2026-08-13T10:00:00.000Z',
      completedAt: '2026-08-14T10:00:00.000Z',
      externalReference: 'EXT-PAY-000123',
      createdAt: '2026-08-13T10:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member WithdrawalsListPage', () => {
  it('renders withdrawals with status and masked payout identifiers', async () => {
    mockFetchRoutes({ '/me/withdrawals': WITHDRAWALS });
    renderMember(<WithdrawalsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('₱75,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('Reserved').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/•••• 7890/)).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Request a withdrawal' })).toHaveAttribute(
      'href',
      '/member/withdrawals/new',
    );
  });

  it('shows the full account number when the API provides it', async () => {
    mockFetchRoutes({
      '/me/withdrawals': {
        data: [
          {
            ...WITHDRAWALS.data[0]!,
            payoutAccount: {
              ...WITHDRAWALS.data[0]!.payoutAccount,
              accountIdentifier: '1234567890',
            },
          },
        ],
        meta: {},
      },
    });
    renderMember(<WithdrawalsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText(/1234567890/)).toBeInTheDocument();
    expect(screen.queryByText(/•••• 7890/)).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no withdrawals', async () => {
    mockFetchRoutes({ '/me/withdrawals': { data: [], meta: {} } });
    renderMember(<WithdrawalsListPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No withdrawals yet')).toBeInTheDocument();
  });
});
