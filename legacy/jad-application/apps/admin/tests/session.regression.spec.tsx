import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionProvider, useSession } from './session';
import { normalizeRole } from '@jad/contracts';

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();
const mockMembersSingle = vi.fn();
const mockTryRefreshSession = vi.fn();
const seenTables: string[] = [];

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
        seenTables.push(table);
        if (table === 'Member')
          return {
            select: () => ({
              eq: () => ({ single: mockMembersSingle, maybeSingle: mockMembersSingle }),
            }),
          };
        return { select: () => ({ eq: () => Promise.resolve({ data: null, error: null }) }) };
      },
    }),
  };
});

/**
 * Layer the staff-session endpoint over real fetch: role slugs resolve
 * server-side (Phase 6 - the client never reads Role tables). Always wraps
 * the original fetch so stubs never chain across tests. The stub receives
 * the request init so tests can respond per-token (stale → 401).
 */
const originalFetch = globalThis.fetch;
function stubStaffSession(
  impl: (input?: RequestInfo | URL, init?: RequestInit) => Response = () =>
    Response.json({
      id: 'sup-001',
      email: 'superadmin@gmail.com',
      name: 'Saul Super',
      status: 'ACTIVE',
      slugs: ['super_admin'],
    }),
) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).includes('/admin/session')) return impl(input, init);
    return (originalFetch as typeof fetch)(input, init);
  }) as typeof fetch;
}

function Probe() {
  const { status, role, roleId, user, sessionError, revalidate } = useSession();
  const mustChangePassword =
    (useSession() as unknown as { mustChangePassword?: boolean }).mustChangePassword ?? false;
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="role">{role ?? 'null'}</div>
      <div data-testid="roleId">{roleId ?? 'null'}</div>
      <div data-testid="roleName">{user?.roleName ?? 'none'}</div>
      <div data-testid="roleModules">{(user?.roleModules ?? []).join(',')}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
      <div data-testid="sessionError">{sessionError ? 'yes' : 'no'}</div>
      <div data-testid="mustChange">{mustChangePassword ? 'yes' : 'no'}</div>
      <button type="button" onClick={() => void revalidate()}>
        Re-run session
      </button>
    </div>
  );
}

function sessionWithUser(id: string, email: string, accessToken = 'tok') {
  return { user: { id, email, user_metadata: {} }, access_token: accessToken };
}

describe('Admin SupabaseSessionProvider - server-side staff session (regression)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenTables.length = 0;
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mockMembersSingle.mockResolvedValue({ data: null });
    mockTryRefreshSession.mockResolvedValue(false);
    stubStaffSession();
  });

  afterEach(() => vi.clearAllMocks());

  it('SUPER_ADMIN via endpoint → admin role, super_admin shell', async () => {
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com') },
    });
    mockMembersSingle.mockResolvedValue({
      data: { firstName: 'Saul', lastName: 'Super', isQualified: true, status: 'APPROVED_ACTIVE' },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');
  });

  it('custom-role session carries the server-resolved display name and modules', async () => {
    stubStaffSession(() =>
      Response.json({
        id: 'cst-1',
        email: 'support@jad.local',
        name: 'Support Staffer',
        status: 'ACTIVE',
        slugs: ['role-admin-support'],
        roleId: 'role-admin-support',
        roleName: 'Admin Support',
        modules: ['dashboard', 'members'],
      }),
    );
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('cst-1', 'support@jad.local') },
    });
    mockMembersSingle.mockResolvedValue({ data: null });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    // Any staff role id (system or custom) is staff at the top-level gate.
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('roleId')).toHaveTextContent('role-admin-support');
    expect(screen.getByTestId('roleName')).toHaveTextContent('Admin Support');
    expect(screen.getByTestId('roleModules')).toHaveTextContent('dashboard,members');
  });

  it('slugs-only session falls back to the derived role id with no display name', async () => {
    // beforeEach stub returns the slugs-only shape - the mock/legacy path.
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com') },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');
    expect(screen.getByTestId('roleName')).toHaveTextContent('none');
    expect(screen.getByTestId('roleModules')).toHaveTextContent('');
  });

  it('surfaces mustChangePassword from the staff session', async () => {
    stubStaffSession(() =>
      Response.json({
        id: 'sup-001',
        email: 'superadmin@gmail.com',
        name: 'Saul Super',
        status: 'ACTIVE',
        slugs: ['super_admin'],
        mustChangePassword: true,
      }),
    );
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com') },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('mustChange')).toHaveTextContent('yes');
  });

  it('endpoint 404 (no staff identity) → user role, null shell', async () => {
    stubStaffSession(
      () => new Response(JSON.stringify({ error: { code: 'NOT_FOUND' } }), { status: 404 }),
    );
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('mem-001', 'juan@example.com', 'tok-x') },
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
    expect(screen.getByTestId('role')).toHaveTextContent('user');
    expect(screen.getByTestId('roleId')).toHaveTextContent('null');
  });

  it('endpoint failure → user (no admin)', async () => {
    stubStaffSession(() => {
      throw new Error('network failure');
    });
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('mem-002', 'maria@example.com', 'tok-y') },
    });
    mockMembersSingle.mockResolvedValue({
      data: {
        firstName: 'Maria',
        lastName: 'Santos',
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
    expect(screen.getByTestId('role')).toHaveTextContent('user');
  });

  it('unknown role slug normalizes safely (no escalation)', async () => {
    expect(normalizeRole('nonsense')).toBe('user');
    expect(normalizeRole('ADMIN')).toBe('admin'); // only SUPER_ADMIN maps
  });

  it('member lookup never touches the non-existent legacy members table (no PGRST205)', async () => {
    // 0 rows on Member must resolve via maybeSingle - never fall back to the
    // phantom lowercase table whose PGRST205 leaks onto the login surface.
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('mem-001', 'juan@example.com') },
    });
    mockMembersSingle.mockRejectedValue({
      code: 'PGRST116',
      message: 'Cannot coerce the result to a single JSON object',
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).not.toHaveTextContent('loading'));
    expect(seenTables).not.toContain('members');
  });

  it('Expired session → unauthenticated', async () => {
    let cb: (e: string, s: unknown) => void = () => {};
    mockOnAuthStateChange.mockImplementation((c) => {
      cb = c as unknown as typeof cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetSession.mockResolvedValue({ data: { session: sessionWithUser('mem-001', 'a@b.com') } });
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
    cb('SIGNED_OUT', { user: null } as never);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
  });

  it('admin slug → roleId admin; stale super_admin row wins on ties', async () => {
    stubStaffSession(() =>
      Response.json({
        id: 'adm-1',
        email: 'admin@jad.local',
        name: 'Admin User',
        status: 'ACTIVE',
        slugs: ['admin', 'super_admin'],
      }),
    );
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('adm-1', 'admin@jad.local') },
    });
    mockMembersSingle.mockResolvedValue({
      data: { firstName: 'Admin', lastName: 'User', isQualified: true, status: 'APPROVED_ACTIVE' },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');
  });

  it('finance slug → roleId finance', async () => {
    stubStaffSession(() =>
      Response.json({
        id: 'fin-1',
        email: 'fina@jad.example',
        name: 'Fina Finance',
        status: 'ACTIVE',
        slugs: ['finance'],
      }),
    );
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('fin-1', 'fina@jad.example') },
    });
    mockMembersSingle.mockResolvedValue({
      data: {
        firstName: 'Fina',
        lastName: 'Finance',
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
    expect(screen.getByTestId('roleId')).toHaveTextContent('finance');
  });

  it('stale-token 401 engages one refresh and recovers without reload', async () => {
    const bearerOf = (init?: RequestInit): string => {
      const headers = init?.headers as Record<string, string> | undefined;
      return String(headers?.['Authorization'] ?? headers?.['authorization'] ?? '');
    };
    stubStaffSession((_input, init) =>
      bearerOf(init).includes('tok-stale')
        ? new Response('unauthorized', { status: 401 })
        : Response.json({
            id: 'sup-001',
            email: 'superadmin@gmail.com',
            name: 'Saul Super',
            status: 'ACTIVE',
            slugs: ['super_admin'],
          }),
    );
    mockGetSession
      .mockResolvedValueOnce({
        data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com', 'tok-stale') },
      })
      .mockResolvedValue({
        data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com', 'tok-fresh') },
      });
    mockTryRefreshSession.mockResolvedValue(true);

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(mockTryRefreshSession).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');
    expect(screen.getByTestId('sessionError')).toHaveTextContent('no');
  });

  it('persistent 401 after a verified staff session preserves it and flags retry (idle-return race)', async () => {
    let cb: (e: string, s: unknown) => void = () => {};
    mockOnAuthStateChange.mockImplementation((c) => {
      cb = c as unknown as typeof cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com', 'tok-good') },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');

    // Idle return with a stale token: endpoint 401s and rotation fails.
    stubStaffSession(() => new Response('unauthorized', { status: 401 }));
    mockTryRefreshSession.mockResolvedValue(false);
    cb('TOKEN_REFRESHED', sessionWithUser('sup-001', 'superadmin@gmail.com', 'tok-stale'));

    await waitFor(() => expect(screen.getByTestId('sessionError')).toHaveTextContent('yes'));
    // Preserved - never demoted to user while the failure is transient.
    expect(screen.getByTestId('status')).toHaveTextContent('authenticated');
    expect(screen.getByTestId('role')).toHaveTextContent('admin');
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');
  });

  it('revalidate recovers the session without a page reload', async () => {
    let cb: (e: string, s: unknown) => void = () => {};
    mockOnAuthStateChange.mockImplementation((c) => {
      cb = c as unknown as typeof cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mockGetSession.mockResolvedValue({
      data: { session: sessionWithUser('sup-001', 'superadmin@gmail.com', 'tok-good') },
    });

    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

    stubStaffSession(() => new Response('unauthorized', { status: 401 }));
    mockTryRefreshSession.mockResolvedValue(false);
    cb('TOKEN_REFRESHED', sessionWithUser('sup-001', 'superadmin@gmail.com', 'tok-stale'));
    await waitFor(() => expect(screen.getByTestId('sessionError')).toHaveTextContent('yes'));

    // Backend healthy again - Retry (revalidate) clears the error in place.
    stubStaffSession();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Re-run session' }));
    await waitFor(() => expect(screen.getByTestId('sessionError')).toHaveTextContent('no'));
    expect(screen.getByTestId('roleId')).toHaveTextContent('super_admin');
  });
});
