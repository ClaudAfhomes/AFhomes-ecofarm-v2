/**
 * Server-side session verification seam.
 *
 * GoTrue's `auth.getUser(jwt)` validates a bearer token against the Auth
 * server and returns the user - the runtime client supports it, and this
 * narrow structural interface (rather than the inferred `SupabaseAuthClient`
 * type) is the compile-time contract for it. It names exactly what
 * authorization consumes: the user id, the email, and the confirmation
 * timestamp. Both the real client and the test fake satisfy it, so no cast
 * is needed at any call site.
 *
 * If a supabase-js release ever changes the auth surface, `tsc` fails where
 * the concrete client is passed to `verifySessionToken` (it stops satisfying
 * this interface) instead of deep inside authorization logic.
 */
export type VerifiedAuthUser = {
  id: string;
  email?: string;
  email_confirmed_at?: string | null;
};

export type SessionVerification = {
  data: { user: VerifiedAuthUser | null };
  error: { message: string } | null;
};

export type AuthSessionVerifier = {
  getUser(jwt: string): Promise<SessionVerification>;
};

/**
 * Verify a bearer token against GoTrue. Returns the raw `{ data, error }`
 * response unchanged, so callers keep their exact success/denial mapping.
 */
export function verifySessionToken(
  auth: AuthSessionVerifier,
  jwt: string,
): Promise<SessionVerification> {
  return auth.getUser(jwt);
}
