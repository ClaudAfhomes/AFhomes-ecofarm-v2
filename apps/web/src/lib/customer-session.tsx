import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { getSupabaseClient } from './supabase';
import { queryClient } from './query';

export type CustomerSessionStatus = 'loading' | 'authenticated' | 'unauthenticated';

export interface CustomerSessionUser {
  /** Supabase Auth user id. NOT a customer id - never used for authorization in the UI. */
  authUserId: string;
  email: string;
}

interface CustomerSessionContextValue {
  status: CustomerSessionStatus;
  user: CustomerSessionUser | null;
  /** True when the session lookup itself failed, as opposed to a clean sign-out. */
  sessionError: boolean;
  signIn: (email: string, password: string, captchaToken?: string) => Promise<void>;
  signOut: () => Promise<void>;
  /** Re-run the session lookup, e.g. after a suspension changes server-side. */
  revalidate: () => Promise<void>;
}

const CustomerSessionContext = createContext<CustomerSessionContextValue | null>(null);

export function useCustomerSession(): CustomerSessionContextValue {
  const value = useContext(CustomerSessionContext);
  if (!value) throw new Error('useCustomerSession must be used within CustomerSessionProvider');
  return value;
}

/**
 * The customer's browser session.
 *
 * This resolves the AUTH session only. It deliberately holds no permissions and
 * no role: customer authorization is ownership-based and lives entirely on the
 * server (`customers.auth_user_id` + RLS). A value cached here can therefore
 * never authorize anything - it only decides which screens are worth rendering.
 */
export function CustomerSessionProvider({
  initialUser,
  children,
}: {
  initialUser?: CustomerSessionUser | null;
  children: ReactNode;
}) {
  const client = getSupabaseClient();
  // `initialUser` seeds the session for tests. It is an INITIAL value, not a
  // permanent override: sign-in and sign-out still move the state, so a test can
  // assert that signing out actually leaves the portal.
  const seeded = initialUser !== undefined;
  const [status, setStatus] = useState<CustomerSessionStatus>(
    seeded ? (initialUser ? 'authenticated' : 'unauthenticated') : 'loading',
  );
  const [user, setUser] = useState<CustomerSessionUser | null>(seeded ? initialUser : null);
  const [sessionError, setSessionError] = useState(false);

  const resolve = useCallback(async () => {
    if (!client) {
      setUser(null);
      setStatus('unauthenticated');
      return;
    }
    const { data } = await client.auth.getSession();
    if (!data.session) {
      setUser(null);
      setStatus('unauthenticated');
      setSessionError(false);
      return;
    }
    setUser({ authUserId: data.session.user.id, email: data.session.user.email ?? '' });
    setStatus('authenticated');
    setSessionError(false);
  }, [client]);

  useEffect(() => {
    if (seeded) return;
    const initialResolve = window.setTimeout(() => void resolve(), 0);
    const subscription = client?.auth.onAuthStateChange(() => void resolve()).data.subscription;
    return () => {
      window.clearTimeout(initialResolve);
      subscription?.unsubscribe();
    };
  }, [client, resolve, seeded]);

  const signIn = useCallback(
    async (email: string, password: string, captchaToken?: string) => {
      if (!client) throw new Error('Supabase is not configured');
      // The normal Supabase Auth password flow. The server never proxies a
      // sign-in and never mints a token of its own.
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

  const signOut = useCallback(async () => {
    await client?.auth.signOut();
    // Drop cached member data with the session so the next sign-in starts clean.
    queryClient.clear();
    setUser(null);
    setStatus('unauthenticated');
  }, [client]);

  const value = useMemo<CustomerSessionContextValue>(
    () => ({ status, user, sessionError, signIn, signOut, revalidate: resolve }),
    [status, user, sessionError, signIn, signOut, resolve],
  );

  return (
    <CustomerSessionContext.Provider value={value}>{children}</CustomerSessionContext.Provider>
  );
}
