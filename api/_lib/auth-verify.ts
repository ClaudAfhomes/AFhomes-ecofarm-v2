import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Exact `getUser` member of the pinned Supabase client's auth surface: the
 * source of truth for this seam. Deriving (not hand-duplicating) means the
 * parameter accepts the real `anon.auth` by construction in every
 * environment — both sides resolve through the same declaration, so a
 * structural mismatch between two copies of the type is impossible. If
 * Supabase ever removes `getUser`, compilation fails at the call below
 * instead of misattributing the error to the caller.
 */
export type SupabaseGetUser = SupabaseClient['auth']['getUser'];

/** Anything exposing the real `getUser` — the concrete client or a test double. */
export type AuthSessionVerifier = {
  getUser: SupabaseGetUser;
};

/** Exactly what authorization consumes from a verified session. */
export type VerifiedAuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
};

export type SessionVerification = {
  data: { user: VerifiedAuthUser | null };
  error: { message: string } | null;
};

/**
 * Verify a bearer token against GoTrue, then normalize to exactly what
 * authorization consumes. Normalization happens AFTER the real call, so the
 * input side never forces the concrete client into a hand-written shape.
 */
export async function verifySessionToken(
  auth: AuthSessionVerifier,
  jwt: string,
): Promise<SessionVerification> {
  const { data, error } = await auth.getUser(jwt);
  if (error || !data?.user) {
    return { data: { user: null }, error: { message: error?.message ?? 'Invalid session' } };
  }
  const { id, email, email_confirmed_at } = data.user;
  return { data: { user: { id, email, email_confirmed_at } }, error: null };
}
