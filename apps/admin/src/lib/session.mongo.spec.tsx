import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ read: vi.fn(), request: vi.fn() }));
vi.mock('./cookie-auth', () => ({
  isMongoAuth: true,
  mongoAuth: { read: mocks.read, signIn: vi.fn(), signOut: vi.fn() },
}));
vi.mock('./supabase', () => ({
  getSupabaseClient: () => {
    throw new Error('Mongo mode must not contact Supabase');
  },
}));
vi.mock('./api/client', () => ({ protectedRequest: mocks.request }));
import { queryClient } from './query';
import { SessionProvider, useSession } from './session';
function Probe() {
  const { user, status } = useSession();
  return (
    <p>
      {status}:{user?.id ?? 'none'}
    </p>
  );
}
const principal = (id: string) => ({
  id,
  fullName: id,
  email: `${id}@example.invalid`,
  roleId: 'role',
  roleSlug: 'sales_manager',
  roleName: 'Manager',
  permissions: [],
  status: 'active',
});
beforeEach(() => {
  vi.clearAllMocks();
  queryClient.clear();
  sessionStorage.clear();
  mocks.read.mockResolvedValue({ user: { id: 'first' } });
  mocks.request.mockResolvedValue(principal('first'));
});
afterEach(() => {
  queryClient.clear();
  sessionStorage.clear();
});
it('clears the previous principal and private cache before resolving another cookie identity', async () => {
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await screen.findByText('authenticated:first');
  queryClient.setQueryData(['customers'], ['first-only-record']);
  mocks.read.mockResolvedValue({ user: { id: 'second' } });
  let finish!: (value: ReturnType<typeof principal>) => void;
  mocks.request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => window.dispatchEvent(new Event('focus')));
  await screen.findByText('loading:none');
  expect(queryClient.getQueryData(['customers'])).toBeUndefined();
  await act(async () => finish(principal('second')));
  await screen.findByText('authenticated:second');
});
it('ignores obsolete MongoDB MFA state and does not request a principal without a session', async () => {
  mocks.read.mockResolvedValue(null);
  sessionStorage.setItem('afhomes-mfa-pending', String(Date.now()));
  render(
    <SessionProvider>
      <Probe />
    </SessionProvider>,
  );
  await screen.findByText('unauthenticated:none');
  expect(mocks.request).not.toHaveBeenCalled();
});
