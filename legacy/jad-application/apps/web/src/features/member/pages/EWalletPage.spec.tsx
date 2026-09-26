import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MOCK_MEMBER } from '@jad/mock';

import { EWalletPage } from './EWalletPage';
import { renderMember } from '../test/utils';
import { mockFetchNetworkError, mockFetchRoutes } from '../../../test/utils';

const WALLET = {
  availableBalance: '140000.00',
  pendingAmount: '636000.00',
  pendingCommission: '424000.00',
};
const PAYOUT_ACCOUNTS = {
  data: [
    {
      id: 'pa-001',
      method: 'TRADITIONAL_BANK',
      accountName: 'Juan Dela Cruz',
      accountIdentifierMasked: '•••• 1234',
      status: 'CONFIRMED',
      isPrimary: true,
      createdAt: '2026-08-01T10:00:00.000Z',
    },
  ],
  meta: {},
};

const COMMISSIONS = {
  data: [
    {
      id: 'com-001',
      commissionType: 'DIRECT_COMMISSION',
      saleId: 'sal-004',
      salePropertyName: 'Titled Hotspring Lots',
      baseValue: '2000000.00',
      rate: '0.0800',
      amount: '160000.00',
      status: 'AVAILABLE',
      createdAt: '2026-08-16T00:00:00.000Z',
    },
  ],
  meta: {},
};

describe('member EWalletPage', () => {
  it('shows the server-computed wallet summary (SCR-MEM-001, BI-002)', async () => {
    mockFetchRoutes({
      '/me/wallet': WALLET,
      '/me/payout-accounts': PAYOUT_ACCOUNTS,
      '/me/commissions': COMMISSIONS,
    });
    renderMember(<EWalletPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('₱140,000.00')).toBeInTheDocument();
    // Pending card = wallet.pendingCommission (pipeline), not commissions.
    expect(screen.getByText('₱424,000.00')).toBeInTheDocument();
    expect(screen.queryByText('₱636,000.00')).not.toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Ready to withdraw (BI-001).')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Withdraw' })).toHaveAttribute(
      'href',
      '/member/withdrawals/new',
    );
    expect(screen.getByRole('link', { name: 'View ledger' })).toHaveAttribute(
      'href',
      '/member/ewallet/ledger',
    );
  });

  it('surfaces an error state when the wallet endpoint fails', async () => {
    mockFetchNetworkError();
    renderMember(<EWalletPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Could not load your wallet')).toBeInTheDocument();
  });
});
