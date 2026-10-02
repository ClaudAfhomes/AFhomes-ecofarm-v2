/**
 * Subscription cleanup on logout: signing out drops the whole server-state
 * cache with the session, so the next login can never see the previous
 * user's customers, redemptions or reports, and polling queries stop firing
 * against a signed-out client. Component unmount already cancels in-flight
 * fetches through React Query; this covers the session boundary.
 */
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock('./supabase', () => ({
  getSupabaseClient: () => ({
    auth: {
      getSession: auth.getSession,
      onAuthStateChange: auth.onAuthStateChange,
      signOut: auth.signOut,
    },
  }),
  isSupabaseConfigured: () => true,
  tryRefreshSession: vi.fn(),
  clearSession: vi.fn(),
}));

import { queryClient } from './query';
import { SessionProvider, useSession } from './session';

function LogoutProbe({ onReady }: { onReady: (logout: () => void) => void }) {
  const { logout, status } = useSession();
  onReady(logout);
  return <p>status:{status}</p>;
}

describe('logout cache cleanup', () => {
  it('clears the query cache when the staff member signs out', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
    auth.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    auth.signOut.mockResolvedValue({ error: null });
    queryClient.setQueryData(['reports', 'redemptions'], { stale: 'previous-user-rows' });

    const clear = vi.spyOn(queryClient, 'clear');
    let logout!: () => void;
    render(
      <SessionProvider>
        <LogoutProbe onReady={(fn) => (logout = fn)} />
      </SessionProvider>,
    );
    expect(await screen.findByText('status:unauthenticated')).toBeInTheDocument();
    expect(queryClient.getQueryData(['reports', 'redemptions'])).toEqual({
      stale: 'previous-user-rows',
    });

    await act(async () => {
      logout();
    });
    expect(auth.signOut).toHaveBeenCalled();
    expect(clear).toHaveBeenCalled();
    expect(queryClient.getQueryData(['reports', 'redemptions'])).toBeUndefined();
    clear.mockRestore();
  });
});
