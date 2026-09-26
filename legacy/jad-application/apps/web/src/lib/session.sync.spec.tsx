import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { mockSessionRef, setMockSessionUser } from '@jad/mock';

import { SupabaseSessionProvider, useSession } from './session';

// Mock supabase module to return a fake client with controllable session
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();

vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    getSupabaseClient: () => ({
      auth: {
        getSession: mockGetSession,
        onAuthStateChange: mockOnAuthStateChange,
        signOut: mockSignOut,
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            single: () => Promise.resolve({ data: null }),
            // A Member row exists for restored sessions (deleted-member
            // orphans are covered by session.orphan.spec.tsx).
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  firstName: 'Test',
                  lastName: 'User',
                  isQualified: true,
                  status: 'APPROVED_ACTIVE',
                },
                error: null,
              }),
          }),
        }),
      }),
    }),
  };
});

function SessionProbe() {
  const { loginAs, logout, status, user } = useSession();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
      <div data-testid="mock-ref">{mockSessionRef.current?.id ?? 'null'}</div>
      <button
        onClick={() =>
          loginAs({
            id: 'mem-001',
            name: 'Juan Dela Cruz',
            email: 'juan.delacruz@example.com',
            role: 'user',
            isQualified: true,
            status: 'APPROVED_ACTIVE',
          })
        }
      >
        login
      </button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe('SupabaseSessionProvider → mockSessionRef sync (Fix 1)', () => {
  beforeEach(() => {
    setMockSessionUser(null);
    mockSessionRef.current = null;
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mockSignOut.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    setMockSessionUser(null);
  });

  it('loginAs synchronizes mockSessionRef (UI auth → mock API auth)', async () => {
    const user = userEvent.setup();
    render(
      <SupabaseSessionProvider>
        <SessionProbe />
      </SupabaseSessionProvider>,
    );

    // initially unauthenticated after getSession null
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('mock-ref')).toHaveTextContent('null');

    await user.click(screen.getByText('login'));

    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('mem-001'));
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    // Fix 1: mockSessionRef must be set so /me/* handlers see authenticated
    expect(mockSessionRef.current?.id).toBe('mem-001');
    expect(screen.getByTestId('mock-ref')).toHaveTextContent('mem-001');
  });

  it('logout clears mockSessionRef (session expiration / sign-out)', async () => {
    const user = userEvent.setup();
    render(
      <SupabaseSessionProvider>
        <SessionProbe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

    await user.click(screen.getByText('login'));
    await waitFor(() => expect(screen.getByTestId('user')).toHaveTextContent('mem-001'));
    expect(mockSessionRef.current?.id).toBe('mem-001');

    await user.click(screen.getByText('logout'));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(mockSessionRef.current).toBeNull();
    expect(screen.getByTestId('mock-ref')).toHaveTextContent('null');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('getSession restoration synchronizes mockSessionRef', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'sup-001',
            email: 'superadmin@gmail.com',
            user_metadata: { role: 'admin', full_name: 'Admin' },
          },
        },
      },
    });

    render(
      <SupabaseSessionProvider>
        <SessionProbe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('sup-001');
    expect(mockSessionRef.current?.id).toBe('sup-001');
  });

  it('onAuthStateChange null (expiration) clears mockSessionRef', async () => {
    let authCb: (event: string, session: unknown) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb) => {
      authCb = cb as unknown as typeof authCb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: { user: { id: 'mem-001', email: 'a@b.com', user_metadata: {} } },
      },
    });

    render(
      <SupabaseSessionProvider>
        <SessionProbe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(mockSessionRef.current?.id).toBe('mem-001'));

    // simulate expiration → session null
    authCb('SIGNED_OUT', { user: null } as unknown as never);
    await waitFor(() => expect(mockSessionRef.current).toBeNull());
    expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated');
  });
});
