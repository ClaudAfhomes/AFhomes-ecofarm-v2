import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  client: { auth: { getSession: vi.fn(), onAuthStateChange: vi.fn() } },
  request: vi.fn(),
}));
vi.mock('./supabase', () => ({ getSupabaseClient: () => mocks.client }));
vi.mock('./api/client', () => ({ protectedRequest: mocks.request }));
import { queryClient } from './query';
import { SessionProvider, useSession } from './session';

const principal = (id: string) => ({
  id, fullName: id, email: `${id}@afhomes-local.test`, roleId: 'role', roleSlug: 'sales_manager',
  roleName: 'Sales Manager', permissions: [], status: 'active',
});
function Probe() {
  const { user, status } = useSession();
  return <p>{status}:{user?.id ?? 'none'}</p>;
}
beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'manager' } } } });
  mocks.client.auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe() {} } } });
  mocks.request.mockResolvedValue(principal('manager'));
  vi.stubGlobal('cookieStore', new EventTarget());
});
afterEach(() => vi.unstubAllGlobals());
it('drops the previous principal and cache when a shared-cookie account changes in another portal', async () => {
  render(<SessionProvider><Probe /></SessionProvider>);
  await screen.findByText('authenticated:manager');
  queryClient.setQueryData(['genealogy'], ['manager-only-record']);
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'ost' } } } });
  let finish!: (value: ReturnType<typeof principal>) => void;
  mocks.request.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText('loading:none');
  expect(queryClient.getQueryData(['genealogy'])).toBeUndefined();
  await act(async () => finish(principal('ost')));
  await screen.findByText('authenticated:ost');
});
it('preserves the cache when focus returns with the same identity', async () => {
  render(<SessionProvider><Probe /></SessionProvider>);
  await screen.findByText('authenticated:manager');
  queryClient.setQueryData(['genealogy'], ['manager-only-record']);
  act(() => window.dispatchEvent(new Event('focus')));
  await waitFor(() => expect(mocks.request).toHaveBeenCalledTimes(2));
  expect(queryClient.getQueryData(['genealogy'])).toEqual(['manager-only-record']);
});
it('detects a cross-port sign-in cookie change without waiting for a focus event', async () => {
  render(<SessionProvider><Probe /></SessionProvider>);
  await screen.findByText('authenticated:manager');
  queryClient.setQueryData(['genealogy'], ['manager-only-record']);
  mocks.client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'ost' } } } });
  mocks.request.mockResolvedValue(principal('ost'));
  act(() => window.cookieStore.dispatchEvent(Object.assign(new Event('change'), {
    changed: [{ name: 'sb-local-auth-token' }], deleted: [],
  })));
  await screen.findByText('authenticated:ost');
  expect(queryClient.getQueryData(['genealogy'])).toBeUndefined();
});
