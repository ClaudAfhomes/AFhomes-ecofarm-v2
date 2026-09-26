import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { MemberStatus, Role } from '@jad/contracts';
import { MockSessionProvider, setMockSessionUser, useMockSession } from '@jad/mock';

import { getSupabaseClient, isSupabaseConfigured, tryRefreshSession } from './supabase';
import { getMemberAccessBlock } from './api/orphan';

/**
 * App-owned session context - Supabase Auth (JWT + RLS) is the SSOT when
 * VITE_SUPABASE_URL is set (fixes cross-origin localStorage bug 5173 vs 5174
 * via cookie storage in supabase.ts). Mock remains fallback when env missing
 * (tests, offline dev).
 */
export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isQualified?: boolean;
  status?: MemberStatus;
}

export interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  role: Role | null;
  isQualified: boolean;
  /**
   * True when the last role resolution failed transiently (see the admin
   * provider for the idle-return race this guards against). The last
   * verified session is preserved while set.
   */
  sessionError: boolean;
  /** Re-run session resolution (used by retry affordances). */
  revalidate: () => Promise<void>;
  loginAs: (user: SessionUser) => void;
  logout: () => void;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error('useSession must be used within <SessionProvider>');
  return ctx;
}

function UnauthenticatedSessionProvider({ children }: { children: ReactNode }) {
  const value = useMemo<SessionContextValue>(
    () => ({
      status: 'unauthenticated',
      user: null,
      role: null,
      isQualified: false,
      sessionError: false,
      revalidate: async () => {},
      loginAs: () => {},
      logout: () => {},
    }),
    [],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

function MockSessionBridge({ children }: { children: ReactNode }) {
  const mock = useMockSession();
  const value = useMemo<SessionContextValue>(
    () => ({
      status: mock.status,
      user: mock.user,
      role: mock.role,
      isQualified: mock.isQualified,
      sessionError: false,
      revalidate: async () => {},
      loginAs: (user) => mock.loginAs(user),
      logout: mock.logout,
    }),
    [mock],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SupabaseSessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionError, setSessionError] = useState(false);
  // Last verified session - restored on transient resolution failures so a
  // stale-token race (idle tab return) never silently swaps the identity.
  const lastGoodUser = useRef<SessionUser | null>(null);
  const revalidateRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    // Use 'any' for Supabase client queries to keep DB column names explicit (memberId, roleId, slug).
    const client = getSupabaseClient() as unknown as {
      auth: {
        getSession: () => Promise<{
          data: {
            session: {
              user: { id: string; email: string; user_metadata: Record<string, unknown> };
            } | null;
          };
        }>;
        onAuthStateChange: (
          cb: (
            e: string,
            s: {
              user: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
            },
          ) => void,
        ) => { data: { subscription: { unsubscribe: () => void } } };
        signOut: () => Promise<void>;
      };
      from: (t: string) => { select: (...args: unknown[]) => unknown; single?: unknown };
    } | null;
    if (!client) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- initialize session status when Supabase is not configured
      setStatus('unauthenticated');
      setMockSessionUser(null);
      return;
    }

    // Authoritative role resolution: own StaffUser row → admin (Phase 5 staff
    // separation - no Role/MemberRole table reads on the member path).
    // Discriminates a verified answer from transient failures (expired token,
    // network) so an unverifiable read never demotes a known identity.
    const resolveRole = async (
      c: unknown,
      memberId: string,
    ): Promise<{ role: Role | null; verified: boolean }> => {
      const attempt = async (): Promise<{ role: Role | null; verified: boolean }> => {
        try {
          const supa = c as {
            from: (t: string) => {
              select: (c: string) => {
                eq: (k: string, v: string) => Promise<{ data: unknown[] | null; error: unknown }>;
              };
            };
          };
          const { data: staff, error: staffErr } = await supa
            .from('StaffUser')
            .select('id')
            .eq('id', memberId);
          if (staffErr) return { role: null, verified: false };
          if (Array.isArray(staff) && staff.length > 0)
            return { role: 'admin' as Role, verified: true };
          return { role: null, verified: true };
        } catch {
          return { role: null, verified: false };
        }
      };
      const first = await attempt();
      if (first.verified) return first;
      // Transient failure: one token rotation, then a single retry.
      try {
        const healed = await tryRefreshSession();
        if (healed) return await attempt();
      } catch {
        // fall through to unverified
      }
      return { role: null, verified: false };
    };

    const buildSessionUser = async (supaUser: {
      id: string;
      email: string;
      user_metadata: Record<string, unknown>;
    }): Promise<{ user: SessionUser | null; verified: boolean }> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const supaAny = client as any;
      let member: {
        firstName: string;
        lastName: string;
        isQualified: boolean;
        status: string;
        archivedAt: string | null;
        accountStatus: string;
      } | null = null;
      let memberFound = false;
      try {
        // maybeSingle on the real "Member" table: 0 rows (deleted/purged
        // Member) resolves null instead of throwing PGRST116 like .single()
        // did. No legacy-table fallback: only quoted PascalCase tables exist
        // in the schema (auth foundation migration), so probing "members"
        // can only ever produce PGRST205 noise.
        const r = (await supaAny
          .from('Member')
          .select('*')
          .eq('id', supaUser.id)
          .maybeSingle()) as {
          data: Record<string, unknown> | null;
          error: unknown;
        };
        if (!r.error && r.data) {
          memberFound = true;
          const d = r.data as Record<string, unknown>;
          const name = (d['name'] as string) ?? '';
          const firstName = (d['firstName'] as string) ?? name.split(' ')[0] ?? '';
          const lastName = (d['lastName'] as string) ?? name.split(' ').slice(1).join(' ') ?? '';
          const isQualified =
            (d['isQualified'] as boolean) ?? (d['is_qualified'] as boolean) ?? false;
          const status = (d['status'] as string) ?? 'PENDING';
          member = {
            firstName,
            lastName,
            isQualified,
            status,
            archivedAt: (d['archivedAt'] as string | null) ?? null,
            accountStatus: (d['accountStatus'] as string) ?? 'ACTIVE',
          };
        }
      } catch {
        member = null;
      }
      const { role: resolvedRole, verified } = await resolveRole(client, supaUser.id);
      let role = resolvedRole;
      // Orphaned auth user: valid Supabase login but the Member row was
      // deleted/purged (and no StaffUser identity). Never grant a member
      // session - sign out so the user lands on login with a clear message
      // instead of a broken panel of 404s. Staff-only identities (no Member
      // row by design) keep their admin session.
      if (!memberFound && role !== 'admin') {
        try {
          await client.auth.signOut();
        } catch {
          // best effort - local sign-out below still clears the session
        }
        return { user: null, verified: true };
      }
      // Archived or deactivated members keep their Member row but must not
      // hold a member session - sign out so RequireRole lands them on login.
      // Staff-only identities are unaffected (no Member row by design).
      if (memberFound && role !== 'admin' && getMemberAccessBlock(member)) {
        try {
          await client.auth.signOut();
        } catch {
          // best effort - local sign-out below still clears the session
        }
        return { user: null, verified: true };
      }
      // No staff identity: member-tier session. user_metadata is
      // client-writable and must never confer privilege.
      if (role === null) {
        role = 'user';
      }
      return {
        user: {
          id: supaUser.id,
          name:
            member?.firstName && member?.lastName
              ? `${member.firstName} ${member.lastName}`
              : ((supaUser.user_metadata['full_name'] as string) ?? supaUser.email ?? ''),
          email: supaUser.email ?? '',
          role,
          isQualified: (member?.isQualified as boolean) ?? false,
          status: (member?.status as MemberStatus) ?? 'PENDING',
        },
        verified,
      };
    };

    /**
     * Apply a resolved session. A null user is always a real sign-out. An
     * unverified resolution never swaps the identity: the last verified
     * session is kept and the error flag is raised for retry affordances.
     */
    const applySessionUser = (next: SessionUser | null, verified: boolean) => {
      if (!next) {
        lastGoodUser.current = null;
        setUser(null);
        setStatus('unauthenticated');
        setSessionError(false);
        setMockSessionUser(null);
        return;
      }
      if (verified) {
        lastGoodUser.current = next;
        setUser(next);
        setStatus('authenticated');
        setSessionError(false);
        setMockSessionUser(next as unknown as import('@jad/mock').MockUser);
        return;
      }
      const preserved = lastGoodUser.current ?? next;
      setUser(preserved);
      setStatus('authenticated');
      setSessionError(true);
      setMockSessionUser(preserved as unknown as import('@jad/mock').MockUser);
    };

    const revalidate = async () => {
      const { data } = await client.auth.getSession();
      const supaUser = data.session?.user ?? null;
      if (!supaUser) {
        applySessionUser(null, true);
        return;
      }
      const { user: next, verified } = await buildSessionUser(supaUser);
      applySessionUser(next, verified);
    };
    revalidateRef.current = revalidate;

    revalidate().catch(() => {
      // getSession itself failed - stay loading rather than guessing.
    });
    const { data: sub } = client.auth.onAuthStateChange(async (event, session) => {
      // A password-recovery flow lands on the public /auth/reset-password
      // page, which manages its own session. Never resolve or force-sign-out
      // here: a not-yet-approved applicant (no Member row) would otherwise be
      // orphaned and signed out, destroying the recovery session before the
      // new password can be saved.
      if (event === 'PASSWORD_RECOVERY') return;
      const supaUser =
        (
          session as {
            user: { id: string; email: string; user_metadata: Record<string, unknown> } | null;
          } | null
        )?.user ?? null;
      if (!supaUser) {
        applySessionUser(null, true);
        return;
      }
      const { user: next, verified } = await buildSessionUser(supaUser);
      applySessionUser(next, verified);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const loginAs = (next: SessionUser) => {
    setUser(next);
    setStatus('authenticated');
    setMockSessionUser(next as unknown as import('@jad/mock').MockUser);
  };
  const logout = async () => {
    const client = getSupabaseClient() as { auth: { signOut: () => Promise<void> } } | null;
    if (client) await client.auth.signOut();
    lastGoodUser.current = null;
    setUser(null);
    setStatus('unauthenticated');
    setSessionError(false);
    setMockSessionUser(null);
  };
  const revalidate = useCallback(() => revalidateRef.current(), []);

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      user,
      role: user?.role ?? null,
      isQualified: user?.isQualified ?? false,
      sessionError,
      revalidate,
      loginAs,
      logout,
    }),
    [status, user, sessionError, revalidate],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export interface SessionProviderProps {
  initialUser?: SessionUser | null;
  restoreDelayMs?: number;
  children: ReactNode;
}

function TestSessionProvider({
  initialUser,
  children,
}: {
  initialUser?: SessionUser | null;
  children: ReactNode;
}) {
  const value = useMemo<SessionContextValue>(() => {
    if (initialUser) {
      return {
        status: 'authenticated' as const,
        user: initialUser,
        role: initialUser.role,
        isQualified: initialUser.isQualified ?? false,
        sessionError: false,
        revalidate: async () => {},
        loginAs: () => {},
        logout: () => {},
      };
    }
    return {
      status: 'unauthenticated' as const,
      user: null,
      role: null,
      isQualified: false,
      sessionError: false,
      revalidate: async () => {},
      loginAs: () => {},
      logout: () => {},
    };
  }, [initialUser]);
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({ initialUser, restoreDelayMs, children }: SessionProviderProps) {
  if (initialUser !== undefined) {
    return <TestSessionProvider initialUser={initialUser}>{children}</TestSessionProvider>;
  }
  // Vitest: keep mock path to avoid real Supabase network in tests (LoginPage also
  // guards with MODE==='test'). Supabase remains SSOT in DEV/PROD when configured.
  if ((import.meta.env as Record<string, string | undefined>).MODE === 'test') {
    return (
      <MockSessionProvider initialUser={initialUser} restoreDelayMs={restoreDelayMs}>
        <MockSessionBridge>{children}</MockSessionBridge>
      </MockSessionProvider>
    );
  }
  // Supabase SSOT when configured - fixes cross-origin localStorage bug (5173 vs 5174)
  // via cookie storage in supabase.ts (docs/database/DATABASE-DESIGN.md §4.7).
  // Mock remains fallback for offline dev when VITE_SUPABASE_URL missing.
  if (isSupabaseConfigured()) {
    return <SupabaseSessionProvider>{children}</SupabaseSessionProvider>;
  }
  if (import.meta.env.DEV) {
    return (
      <MockSessionProvider initialUser={initialUser} restoreDelayMs={restoreDelayMs}>
        <MockSessionBridge>{children}</MockSessionBridge>
      </MockSessionProvider>
    );
  }
  return <UnauthenticatedSessionProvider>{children}</UnauthenticatedSessionProvider>;
}
