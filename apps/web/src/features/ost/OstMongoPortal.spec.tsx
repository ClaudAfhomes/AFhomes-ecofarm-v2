import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router';
import { expect, it, vi, beforeEach } from 'vitest';
import { OstSalesParticipation } from './OstSalesParticipation';
import { OstResetPasswordPage } from './OstResetPasswordPage';
import { request, requestList } from '../../lib/api/client';
import { getAuthPortals } from '../../lib/portals';
import { getSupabaseClient } from '../../lib/supabase';
const signOut = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('../../lib/cookie-auth', () => ({ isMongoAuth: true }));
vi.mock('../../lib/customer-session', () => ({
  useCustomerSession: () => ({ user: { authUserId: 'synthetic-ost' }, signOut }),
}));
vi.mock('../../lib/api/client', () => ({ request: vi.fn(), requestList: vi.fn() }));
vi.mock('../../lib/portals', () => ({ getAuthPortals: vi.fn() }));
vi.mock('../../lib/supabase', () => ({ getSupabaseClient: vi.fn(() => null) }));
beforeEach(() => vi.clearAllMocks());
it('shows the OST recorded participation status', async () => {
  vi.mocked(requestList).mockResolvedValue([
    {
      id: 'participation',
      customerName: 'Synthetic VIP',
      reference: 'SALE-FINAL',
      tier: 'GOLD',
      roles: ['Referrer'],
      status: 'payment_verified',
      createdAt: '2026-10-28T00:00:00.000Z',
    },
  ]);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <OstSalesParticipation />
    </QueryClientProvider>,
  );
  expect(await screen.findByText('Synthetic VIP')).toBeInTheDocument();
  expect(screen.getByText(/Referrer · payment verified/)).toBeInTheDocument();
  view.unmount();
  client.clear();
});
it('changes an OST temporary password using MongoDB and signs out to OST login without Supabase', async () => {
  vi.mocked(getAuthPortals).mockResolvedValue({
    staff: { roleSlug: 'ost', roleName: 'OST', status: 'active', mustChangePassword: true },
    ost: { status: 'active', ostNumber: 'OST-SYNTHETIC' },
    customer: null,
  });
  vi.mocked(request).mockResolvedValue({ changed: true });
  render(
    <MemoryRouter initialEntries={['/ost/change-password']}>
      <Routes>
        <Route path="/ost/change-password" element={<OstResetPasswordPage firstLogin />} />
        <Route path="/ost/login" element={<h1>OST Login</h1>} />
      </Routes>
    </MemoryRouter>,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Temporary password'), 'SyntheticTemp123!');
  await user.type(screen.getByLabelText('New password'), 'SyntheticOwnPassword123!');
  await user.type(screen.getByLabelText('Confirm new password'), 'SyntheticOwnPassword123!');
  await user.click(screen.getByRole('button', { name: 'Save password' }));
  expect(await screen.findByRole('heading', { name: 'OST Login' })).toBeInTheDocument();
  expect(signOut).toHaveBeenCalledOnce();
  expect(getSupabaseClient).not.toHaveBeenCalled();
});
