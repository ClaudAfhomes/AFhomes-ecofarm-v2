import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionProvider, useSession } from './session';
import { normalizeRole } from '@jad/contracts';

// Mock supabase
const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();
const mockMembersSingle = vi.fn();
const mockStaffUserEq = vi.fn();
const mockTryRefreshSession = vi.fn();

vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
    // Lazily bound: the factory is hoisted above these consts, so the
    // reference must resolve at call time, not at factory evaluation.
    tryRefreshSession: (...args: unknown[]) =>
      (mockTryRefreshSession as (...a: unknown[]) => Promise<boolean>)(...args),
    getSupabaseClient: () => ({
      auth: {
        getSession: mockGetSession,
        onAuthStateChange: mockOnAuthStateChange,
        signOut: mockSignOut,
      },
      from: (table: string) => {
        const lower = table.toLowerCase();
        if (lower === 'staffuser') {
          return { select: () => ({ eq: mockStaffUserEq }) };
        }
        if (lower === 'member' || lower === 'members') {
          return {
            select: () => ({
              eq: () => ({ single: mockMembersSingle, maybeSingle: mockMembersSingle }),
            }),
          };
        }
        return { select: () => ({ eq: vi.fn(), in: vi.fn() }) };
      },
    }),
  };
});

function Probe() {
  const { status, role, user, sessionError } = useSession();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="role">{role ?? 'null'}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
      <div data-testid="name">{user?.name ?? 'none'}</div>
      <div data-testid="sessionError">{sessionError ? 'yes' : 'no'}</div>
    </div>
  );
}

describe('SupabaseSessionProvider - authoritative role via StaffUser (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mockSignOut.mockResolvedValue(undefined);
    mockMembersSingle.mockResolvedValue({ data: null });
    mockStaffUserEq.mockResolvedValue({ data: [], error: null });
    mockTryRefreshSession.mockResolvedValue(false);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('StaffUser row → admin (no Role reads)', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'adm-001', email: 'admin@jad.local', user_metadata: { full_name: 'Admin' } },
        },
      },
    });
    mockMembersSingle.mockResolvedValue({
      data: { firstName: 'Admin', lastName: 'User', isQualified: true, status: 'APPROVED_ACTIVE' },
    });
    mockStaffUserEq.mockResolvedValue({ data: [{ id: 'adm-001' }], error: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('user')).toHaveTextContent('adm-001');
  });

  it('No StaffUser row → member role (admin comes from staff identity only)', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'mem-001', email: 'juan@example.com', user_metadata: { full_name: 'Juan' } },
        },
      },
    });
    mockMembersSingle.mockResolvedValue({
      data: {
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        isQualified: true,
        status: 'APPROVED_ACTIVE',
      },
    });
    mockStaffUserEq.mockResolvedValue({ data: [], error: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('user');
  });

  it('Unknown role slug → safe user normalization (no escalation)', async () => {
    expect(normalizeRole('unknown_role')).toBe('user');
    expect(normalizeRole('admin')).toBe('admin');
    expect(normalizeRole('finance')).toBe('user');
    expect(normalizeRole('super_admin')).toBe('admin');
    expect(normalizeRole('SUPER-ADMIN')).toBe('admin');
    expect(normalizeRole('member')).toBe('user');
    expect(normalizeRole('MEMBER')).toBe('user');
    expect(normalizeRole('')).toBe('user');
    expect(normalizeRole(null)).toBe('user');
  });

  it('Missing profile (members null) → orphan sign-out, never a member session', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'unknown-1', email: 'a@b.com', user_metadata: { full_name: 'Ghost' } },
        },
      },
    });
    // 0 rows: .maybeSingle() resolves null (deleted/purged Member, no staff identity).
    mockMembersSingle.mockResolvedValue({ data: null, error: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('StaffUser lookup failure → safe user, no accidental admin', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'mem-002', email: 'maria@example.com', user_metadata: {} } } },
    });
    mockMembersSingle.mockResolvedValue({
      data: {
        firstName: 'Maria',
        lastName: 'Santos',
        isQualified: true,
        status: 'APPROVED_ACTIVE',
      },
    });
    mockStaffUserEq.mockRejectedValue(new Error('network failure'));

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('user');
  });

  it('Expired / signed-out session → unauthenticated', async () => {
    let authCb: (e: string, s: unknown) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb) => {
      authCb = cb as unknown as typeof authCb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'mem-001', email: 'a@b.com', user_metadata: { full_name: 'Juan' } },
        },
      },
    });
    mockMembersSingle.mockResolvedValue({
      data: {
        firstName: 'Juan',
        lastName: 'Dela Cruz',
        isQualified: true,
        status: 'APPROVED_ACTIVE',
      },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    authCb('SIGNED_OUT', { user: null } as unknown as never);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('null');
  });

  it('StaffUser row resolves admin without Role reads (Phase 1 staff domain)', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'adm-9', email: 'admin@jad.local', user_metadata: {} } } },
    });
    mockMembersSingle.mockResolvedValue({
      data: { firstName: 'Admin', lastName: 'User', isQualified: true, status: 'APPROVED_ACTIVE' },
    });
    mockStaffUserEq.mockResolvedValue({ data: [{ id: 'adm-9' }], error: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
  });

  it('Reload (getSession) restores admin via StaffUser', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'adm-001', email: 'admin@jad.local', user_metadata: {} } } },
    });
    mockMembersSingle.mockResolvedValue({
      data: { firstName: 'Admin', lastName: 'User', isQualified: true, status: 'APPROVED_ACTIVE' },
    });
    mockStaffUserEq.mockResolvedValue({ data: [{ id: 'adm-001' }], error: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
  });

  it('transient StaffUser read failure preserves the verified session and flags retry', async () => {
    let authCb: (e: string, s: unknown) => void = () => {};
    mockOnAuthStateChange.mockImplementation((cb) => {
      authCb = cb as unknown as typeof authCb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const supaUser = (id: string, email: string) => ({ id, email, user_metadata: {} });
    mockGetSession.mockResolvedValue({
      data: { session: { user: supaUser('adm-001', 'admin@jad.local') } },
    });
    mockMembersSingle.mockResolvedValue({
      data: { firstName: 'Admin', lastName: 'User', isQualified: true, status: 'APPROVED_ACTIVE' },
    });
    mockStaffUserEq.mockResolvedValue({ data: [{ id: 'adm-001' }], error: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');

    // Idle return with a stale token: the StaffUser read fails and rotation fails.
    mockStaffUserEq.mockRejectedValue(new Error('stale token'));
    mockTryRefreshSession.mockResolvedValue(false);
    authCb('TOKEN_REFRESHED', { user: supaUser('adm-001', 'admin@jad.local') } as unknown as never);

    await waitFor(() => expect(screen.getByTestId('sessionError')).toHaveTextContent('yes'));
    // Preserved - never silently swapped to a member session.
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('user')).toHaveTextContent('adm-001');
  });
});
