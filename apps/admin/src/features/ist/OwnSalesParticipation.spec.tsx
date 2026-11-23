import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { OwnSalesParticipation } from './OwnSalesParticipation';
import { requestList } from '../../lib/api/client';
vi.mock('../../lib/cookie-auth', () => ({ isMongoAuth: true }));
vi.mock('../../lib/session', () => ({ useSession: () => ({ user: { id: 'synthetic-staff' } }) }));
vi.mock('../../lib/api/client', () => ({ requestList: vi.fn() }));
it('loads the current salesperson participation and displays application status and recorded role', async () => {
  vi.mocked(requestList).mockResolvedValue([
    {
      id: 'participation',
      customerName: 'Synthetic Customer',
      reference: 'APP-PENDING',
      tier: 'GOLD',
      roles: ['VD'],
      status: 'submitted',
      createdAt: '2026-10-28T00:00:00.000Z',
    },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <OwnSalesParticipation />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Synthetic Customer')).toBeInTheDocument();
  expect(screen.getByText(/VD · submitted/)).toBeInTheDocument();
  expect(requestList).toHaveBeenCalledWith(
    '/sales-involvement?limit=25&offset=0',
    expect.anything(),
  );
  view.unmount();
  client.clear();
});
