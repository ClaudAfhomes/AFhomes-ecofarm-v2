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
import type { AfHomesPermission } from '@afhomes/contracts';
import { afHomesSessionSchema } from '@afhomes/contracts';
import { protectedRequest } from './api/client';
import { ApiError } from './api/errors';
import { queryClient } from './query';
import { getSupabaseClient } from './supabase';

export type SessionStatus = 'loading' | 'authenticated' | 'unauthenticated';
/**
 * The staff principal as resolved by `GET /admin/afhomes/session`. Access is
 * decided by `afHomesPermissions` (per-module view/create/update/delete), not by
 * a role enum - the role is descriptive metadata shown in the UI.
 */
export interface SessionUser {
  id: string;
  name: string;
  email: string;
  roleId: string;
  roleSlug?: string;
  roleName: string;
  afHomesPermissions: AfHomesPermission[];
  status: 'active' | 'invited' | 'inactive' | 'suspended';
  /**
   * AFHomes pattern: true while the account still runs on its administrator-set
   * temporary password. Optional (older test fixtures omit it) - only an
   * explicit `true` gates; `undefined` behaves as `false`.
   */
  mustChangePassword?: boolean;
  /**
   * Server environment flag, UX gating only: whether the test-account purge
   * endpoint is enabled. Optional (older test fixtures omit it) - only an
   * explicit `true` shows the purge control; `undefined` behaves as `false`.
   * The server re-checks it authoritatively on every call.
   */
  testPurgeEnabled?: boolean;
  mfaRequired?: boolean;
}
interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  sessionError: boolean;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<void>;
  revalidate: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);
export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error('useSession must be used within SessionProvider');
  return value;
}

function TestSessionProvider({
  user,
  children,
}: {
  user: SessionUser | null;
  children: ReactNode;
}) {
  const value = useMemo<SessionContextValue>(
    () => ({
      status: user ? 'authenticated' : 'unauthenticated',
      user,
      sessionError: false,
      signIn: async () => {},
      revalidate: async () => {},
      logout: async () => {},
    }),
    [user],
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function SessionProvider({
  initialUser,
  children,
}: {
  initialUser?: SessionUser | null;
  children: ReactNode;
}) {
  const client = getSupabaseClient();
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionError, setSessionError] = useState(false);
  const resolvedUserId = useRef<string | null>(null);
  const resolution = useRef(0);

  const resolve = useCallback(async () => {
    const currentResolution = ++resolution.current;
    if (!client) {
      setUser(null);
      setStatus('unauthenticated');
      return;
    }
    const { data } = await client.auth.getSession();
    if (currentResolution !== resolution.current) return;
    if (resolvedUserId.current && resolvedUserId.current !== data.session?.user.id) {
      // Local portals share a cookie; a different tab can replace the account.
      queryClient.clear();
      resolvedUserId.current = null;
      setUser(null);
      setStatus('loading');
    }
    if (!data.session) {
      setUser(null);
      setStatus('unauthenticated');
      setSessionError(false);
      return;
    }
    try {
      const parsed = await protectedRequest('/admin/afhomes/session', afHomesSessionSchema);
      if (currentResolution !== resolution.current) return;
      if (resolvedUserId.current && resolvedUserId.current !== parsed.id) queryClient.clear();
      resolvedUserId.current = parsed.id;
      setUser({
        id: parsed.id,
        name: parsed.fullName,
        email: parsed.email,
        roleId: parsed.roleId,
        roleSlug: parsed.roleSlug,
        roleName: parsed.roleName,
        afHomesPermissions: parsed.permissions,
        status: parsed.status,
        mustChangePassword: parsed.mustChangePassword,
        testPurgeEnabled: parsed.testPurgeEnabled,
        mfaRequired: parsed.mfaRequired,
      });
      setStatus('authenticated');
      setSessionError(false);
    } catch (error) {
      if (currentResolution !== resolution.current) return;
      setUser(null);
      setStatus('unauthenticated');
      setSessionError(!(error instanceof ApiError && error.status === 401));
    }
  }, [client]);

  useEffect(() => {
    const initialResolve = window.setTimeout(() => void resolve(), 0);
    const subscription = client?.auth.onAuthStateChange(() => void resolve()).data.subscription;
    const onFocus = () => void resolve();
    window.addEventListener('focus', onFocus);
    const cookies = import.meta.env.DEV ? window.cookieStore : undefined;
    const onCookieChange = (event: CookieChangeEvent) => {
      if ([...event.changed, ...event.deleted].some(cookie =>
        cookie.name?.startsWith('sb-') && cookie.name.endsWith('-auth-token'),
      )) void resolve();
    };
    cookies?.addEventListener('change', onCookieChange);
    return () => {
      window.clearTimeout(initialResolve);
      subscription?.unsubscribe();
      window.removeEventListener('focus', onFocus);
      cookies?.removeEventListener('change', onCookieChange);
    };
  }, [client, resolve]);

  const logout = useCallback(async () => {
    // Awaited by callers that navigate away afterwards: Supabase revokes
    // server-side before dropping the local session, so leaving early could
    // strand a usable token behind (and the next entry would bounce straight
    // back in). Local state is cleared even if the revoke throws, still
    // inside this call, so a failed sign-out still signs out locally.
    try {
      await client?.auth.signOut();
    } finally {
      resolution.current++;
      resolvedUserId.current = null;
      // Drop every cached row with the session: the next login must never see
      // the previous user's customers, redemptions or reports, and polling
      // queries must not keep firing against a signed-out client.
      queryClient.clear();
      setUser(null);
      setStatus('unauthenticated');
    }
  }, [client]);
  const signIn = useCallback(
    async (email: string, password: string, captchaToken?: string) => {
      if (!client) throw new Error('Supabase is not configured');
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
        ...(captchaToken ? { options: { captchaToken } } : {}),
      });
      if (error) throw new Error(error.message);
      await resolve();
    },
    [client, resolve],
  );
  const value = useMemo<SessionContextValue>(
    () => ({ status, user, sessionError, signIn, revalidate: resolve, logout }),
    [status, user, sessionError, signIn, resolve, logout],
  );

  if (initialUser !== undefined)
    return <TestSessionProvider user={initialUser}>{children}</TestSessionProvider>;
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
