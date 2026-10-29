import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import { RecordPointsDialog } from './RecordPointsDialog';
import { getMemberships } from './services';
import { adjustPoints } from './points-services';
import { membershipKeys } from './queryKeys';

vi.mock('./services', () => ({ getMemberships: vi.fn() }));
vi.mock('./points-services', () => ({ adjustPoints: vi.fn() }));
vi.mock('@afhomes/ui', async () => ({
  ...(await vi.importActual<typeof import('@afhomes/ui')>('@afhomes/ui')),
  notifySuccess: vi.fn(),
}));
it('previews the new adjustment with server rounding and refreshes cached customer lookup after recording', async () => {
  const client = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    }),
    close = vi.fn();
  const key = membershipKeys.customerLookup('SYNTHETIC');
  client.setQueryData(key, []);
  vi.mocked(getMemberships).mockResolvedValue([
    { id: 'member', customerId: 'customer', pointsBalance: 70 },
  ] as Awaited<ReturnType<typeof getMemberships>>);
  vi.mocked(adjustPoints).mockResolvedValue({
    membershipId: 'member',
    amount: 5,
    balanceAfter: 75,
    reversalDebt: 0,
  });
  const view = render(
    <QueryClientProvider client={client}>
      <RecordPointsDialog
        open
        customer={{ id: 'customer', fullName: 'Synthetic Customer', tier: 'BRONZE' }}
        onClose={close}
      />
    </QueryClientProvider>,
  );
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText('Points to record'), '5');
  expect(screen.getByText('Weekday points added (70%)').nextElementSibling).toHaveTextContent('3');
  expect(screen.getByText('Weekend points added (30%)').nextElementSibling).toHaveTextContent('2');
  await user.click(screen.getByRole('button', { name: 'Record' }));
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(client.getQueryState(key)?.isInvalidated).toBe(true);
  view.unmount();
  client.clear();
});
