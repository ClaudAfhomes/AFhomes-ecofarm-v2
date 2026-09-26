import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MOCK_MEMBER } from '@jad/mock';

import { LedgerPage } from './LedgerPage';
import { renderMember } from '../test/utils';
import { mockFetchRoutes } from '../../../test/utils';

const PAGE1 = {
  data: [
    {
      id: 'led-001',
      entryType: 'DIRECT_COMMISSION',
      direction: 'CREDIT',
      amount: '160000.00',
      createdAt: '2026-08-14T10:00:00.000Z',
      balanceAfter: '160000.00',
    },
    {
      id: 'led-002',
      entryType: 'WITHDRAWAL_RESERVATION',
      direction: 'DEBIT',
      amount: '50000.00',
      createdAt: '2026-08-13T10:00:00.000Z',
      balanceAfter: '110000.00',
    },
  ],
  meta: { pagination: { nextCursor: 'led-002' } },
};

const PAGE2 = {
  data: [
    {
      id: 'led-003',
      entryType: 'FINANCIAL_ADJUSTMENT',
      direction: 'CREDIT',
      amount: '25000.00',
      createdAt: '2026-08-12T10:00:00.000Z',
      balanceAfter: '135000.00',
    },
  ],
  meta: { pagination: {} },
};

describe('member LedgerPage', () => {
  it('renders entries with the server-computed running balance (SCR-MEM-009)', async () => {
    mockFetchRoutes({ '/me/ledger': PAGE1 });
    renderMember(<LedgerPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('Balance ₱160,000.00')).toBeInTheDocument();
    expect(screen.getAllByText('Direct Commission').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Balance ₱110,000.00')).toBeInTheDocument();
    expect(screen.getByText('−₱50,000.00')).toBeInTheDocument();
  });

  it('loads the next cursor page on demand (API-SPECIFICATION §4)', async () => {
    const fetchFn = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes('cursor=led-002') ? PAGE2 : PAGE1;
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
    vi.stubGlobal('fetch', fetchFn);

    const user = userEvent.setup();
    renderMember(<LedgerPage />, { user: MOCK_MEMBER });

    const loadMore = await screen.findByRole('button', { name: 'Load more' });
    await user.click(loadMore);

    expect(await screen.findByText('Balance ₱135,000.00')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more' })).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no entries', async () => {
    mockFetchRoutes({ '/me/ledger': { data: [], meta: { pagination: {} } } });
    renderMember(<LedgerPage />, { user: MOCK_MEMBER });

    expect(await screen.findByText('No ledger entries')).toBeInTheDocument();
  });
});
