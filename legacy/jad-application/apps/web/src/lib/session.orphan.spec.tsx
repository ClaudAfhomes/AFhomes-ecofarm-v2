import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SupabaseSessionProvider, useSession } from './session';

const mockGetSession = vi.fn();
const mockOnAuthStateChange = vi.fn();
const mockSignOut = vi.fn();
const mockMemberMaybeSingle = vi.fn();
const mockMemberSingle = vi.fn();
const mockStaffUserEq = vi.fn();
const mockTryRefreshSession = vi.fn();
const seenTables: string[] = [];

vi.mock('./supabase', async () => {
  const actual = await vi.importActual<typeof import('./supabase')>('./supabase');
  return {
    ...actual,
    isSupabaseConfigured: () => true,
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
        const lower = table.toLowerCase();
        if (lower === 'staffuser') {
          return { select: () => ({ eq: mockStaffUserEq }) };
        }
        if (lower === 'member' || lower === 'members') {
          return {
            select: () => ({
              eq: () => ({
                single: mockMemberSingle,
                maybeSingle: mockMemberMaybeSingle,
              }),
            }),
          };
        }
        return { select: () => ({ eq: vi.fn(), in: vi.fn() }) };
      },
    }),
  };
});

function Probe() {
  const { status, user } = useSession();
  return (
    <div>
      <div data-testid="status">{status}</div>
      <div data-testid="user">{user?.id ?? 'none'}</div>
    </div>
  );
}

describe('SupabaseSessionProvider - orphaned auth user (Member row deleted)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    seenTables.length = 0;
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: {
            id: 'ad6830c6-orphan',
            email: 'orlandodelacruz.afhomes@gmail.com',
            user_metadata: { full_name: 'Orlando Dela Cruz' },
          },
        },
      },
    });
    mockOnAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
    mockSignOut.mockResolvedValue(undefined);
    // PostgREST 0 rows: .single() throws PGRST116, .maybeSingle() resolves null.
    mockMemberSingle.mockRejectedValue({
      code: 'PGRST116',
      message: 'Cannot coerce the result to a single JSON object',
    });
    mockMemberMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockStaffUserEq.mockResolvedValue({ data: [], error: null });
    mockTryRefreshSession.mockResolvedValue(false);
  });

  it('signs out the orphan instead of granting a member session', async () => {
    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(screen.getByTestId('user')).toHaveTextContent('none');
    expect(mockSignOut).toHaveBeenCalled();
  });

  it('never queries the non-existent legacy members table (no PGRST205)', async () => {
    render(
      <SupabaseSessionProvider>
        <Probe />
      </SupabaseSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
    expect(seenTables).not.toContain('members');
  });
});
