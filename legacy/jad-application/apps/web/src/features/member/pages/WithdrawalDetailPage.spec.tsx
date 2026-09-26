import { describe, expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { MOCK_MEMBER } from '@jad/mock';

import { WithdrawalDetailPage } from './WithdrawalDetailPage';
import { mockFetchRoutes } from '../../../test/utils';
import { SessionProvider } from '../../../lib/session';

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <SessionProvider initialUser={MOCK_MEMBER} restoreDelayMs={0}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/member/withdrawals/:withdrawalId" element={<WithdrawalDetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </SessionProvider>,
  );
}

const REJECTED = {
  id: 'wdr-002',
  amount: '40000.00',
  status: 'REJECTED',
  payoutAccount: {
    id: 'pa-002',
    method: 'DIGITAL_BANK',
    accountName: 'Juan Dela Cruz',
    accountIdentifierMasked: '•••• 3210',
  },
  reservedAt: '2026-08-16T10:00:00.000Z',
  rejectedAt: '2026-08-17T10:00:00.000Z',
  rejectionReason:
    'The payout account name did not match the bank record. Please verify your account details and submit a new request.',
  createdAt: '2026-08-16T10:00:00.000Z',
};

const COMPLETED = {
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
};

describe('member WithdrawalDetailPage', () => {
  it('renders a rejected withdrawal with the reason and a new-request action (BR-WDR-005)', async () => {
    mockFetchRoutes({ '/me/withdrawals/wdr-002': REJECTED });
    renderAt('/member/withdrawals/wdr-002');

    expect(await screen.findByText('₱40,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
    expect(screen.getByText(/did not match the bank record/)).toBeInTheDocument();
    const action = screen.getByRole('link', { name: 'Request a new withdrawal' });
    expect(action).toHaveAttribute('href', '/member/withdrawals/new');
    expect(screen.getByText(/cannot be edited or resubmitted/)).toBeInTheDocument();
  });

  it('renders a completed withdrawal with the external reference (BR-BND-001)', async () => {
    mockFetchRoutes({ '/me/withdrawals/wdr-001': COMPLETED });
    renderAt('/member/withdrawals/wdr-001');

    expect(await screen.findByText(/EXT-PAY-000123/)).toBeInTheDocument();
    expect(screen.getAllByText('EXT-PAY-000123')).toHaveLength(1);
    expect(
      screen.queryByRole('link', { name: 'Request a new withdrawal' }),
    ).not.toBeInTheDocument();
  });

  it('shows the full account number on detail when the API provides it', async () => {
    mockFetchRoutes({
      '/me/withdrawals/wdr-001': {
        ...COMPLETED,
        payoutAccount: {
          ...COMPLETED.payoutAccount,
          accountIdentifier: '1234567890',
        },
      },
    });
    renderAt('/member/withdrawals/wdr-001');

    expect(await screen.findByText(/1234567890/)).toBeInTheDocument();
  });
});
