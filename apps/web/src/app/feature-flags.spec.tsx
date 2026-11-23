import { renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { DEFAULT_FEATURE_FLAGS, setFeatureFlags } from '@afhomes/shared';
import App from './App';
import { renderWithProviders } from '../test/utils';
import { usePublishedServices } from '../marketing/lib/services';
import { requestList } from '../lib/api/client';

vi.mock('../lib/api/client', async (original) => ({ ...(await original()), requestList: vi.fn() }));
vi.mock('../lib/portals', () => ({ getAuthPortals: async () => ({ customer: true, staff: null, ost: null }) }));
vi.mock('../features/customer/queries', async (original) => ({
  ...(await original()),
  useCustomerProfileQuery: () => ({ data: { fullName: 'Synthetic customer', status: 'active' }, isLoading: false, isError: false }),
}));

afterEach(() => setFeatureFlags(DEFAULT_FEATURE_FLAGS));

it('does not request the operational service catalog while Services is switched off', () => {
  setFeatureFlags({ services: false });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const { result } = renderHook(() => usePublishedServices(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  expect(result.current.fetchStatus).toBe('idle');
  expect(requestList).not.toHaveBeenCalled();
});

it.each(['/customer/redemptions', '/customer/points'])(
  'refuses direct access to switched-off workflow %s',
  async (route) => {
    setFeatureFlags({ services: false, redemption: false });
    renderWithProviders(<App />, {
      route,
      sessionUser: {
        authUserId: 'aaaaaaaa-0000-4000-8000-000000000001',
        email: 'test@example.invalid',
      },
    });
    expect(await screen.findByText('Page not found')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Redemptions' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Points' })).not.toBeInTheDocument();
  },
);
