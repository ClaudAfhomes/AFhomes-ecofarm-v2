import type { GoTrueClient } from '@supabase/auth-js';

/**
 * Exact `getUser` member of the public auth client that owns the operation.
 * `SupabaseClient.auth` is a private `SupabaseAuthClient` subclass in
 * supabase-js' bundled declaration. The public `GoTrueClient` class is the
 * stable boundary, and the real `anon.auth` extends it by construction.
 */
export type SupabaseGetUser = GoTrueClient['getUser'];

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
