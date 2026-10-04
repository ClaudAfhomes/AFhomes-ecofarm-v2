import type { GoTrueClient } from '@supabase/auth-js';

/**
 * Exact `getUser` member of the public auth client that owns the operation.
 * `SupabaseClient.auth` is a private `SupabaseAuthClient` subclass in
 * supabase-js' bundled declaration. The public `GoTrueClient` class is the
 * stable boundary, and the real `anon.auth` extends it by construction.
 */
export type SupabaseGetUser = GoTrueClient['getUser'];
export type SupabaseGetClaims = GoTrueClient['getClaims'];

/** Anything exposing the real `getUser` — the concrete client or a test double. */
export type AuthSessionVerifier = {
  getUser: SupabaseGetUser;
};

export type AuthClaimsVerifier = AuthSessionVerifier & {
  getClaims: SupabaseGetClaims;
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

export type VerifiedAuthenticationMethod = 'invite' | 'password' | 'recovery' | string;
export async function verifiedAssuranceLevel(
  auth: AuthClaimsVerifier,
  jwt: string,
  expectedSubject?: string,
): Promise<'aal1' | 'aal2' | null> {
  try {
    const { data, error } = await auth.getClaims(jwt);
    if (error || !data?.claims?.sub || (expectedSubject && data.claims.sub !== expectedSubject))
      return null;
    return data.claims.aal === 'aal2' ? 'aal2' : data.claims.aal === 'aal1' ? 'aal1' : null;
  } catch {
    return null;
  }
}

/**
 * Read the authentication methods from a separately verified JWT. Supabase
 * may encode AMR as strings or `{ method, timestamp }` records; normalize both
 * representations and fail closed on a missing/invalid claim.
 */
export async function verifiedAuthenticationMethods(
  auth: AuthClaimsVerifier,
  jwt: string,
): Promise<VerifiedAuthenticationMethod[]> {
  const { data, error } = await auth.getClaims(jwt);
  if (error || !data?.claims || data.claims.sub === undefined) return [];
  const methods = data.claims.amr;
  if (!Array.isArray(methods)) return [];
  return methods.flatMap((entry) => {
    if (typeof entry === 'string') return [entry];
    if (entry && typeof entry === 'object' && typeof entry.method === 'string') {
      return [entry.method];
    }
    return [];
  });
}
