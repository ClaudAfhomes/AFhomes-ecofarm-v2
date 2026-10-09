import { ApiError } from '../../lib/api/errors';

/**
 * Status predicates for the portal shell.
 *
 * 401 and 403 are kept strictly apart, matching the API: 401 means "no usable
 * session" (sign in again), 403 means "your session is fine, this sign-in is not
 * a customer" (a different screen entirely). Collapsing them would tell a staff
 * member to sign in again when signing in again cannot possibly help.
 */
export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;

export const isForbidden = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 403;

/** A 404 from the portal means the customer has no active membership, not a bad URL. */
export const isNotFound = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 404;

/** A conflict: the claim is spent, expired, or no longer claimable. */
export const isConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 409;

/**
 * A message for a failed claim, from the server's own code.
 *
 * 404 is deliberately the same branch as everything else unusable. The server
 * returns an identical refusal for "no such claim" and "not your claim" so the
 * endpoint cannot be used to discover who owns a code, and this must not undo
 * that by giving the two different advice.
 */
export function claimErrorMessage(error: unknown): string {
  if (isConflict(error)) {
    return 'That claim code cannot be used any more. It may already have been claimed, or it may have expired. Please ask the branch to reissue it.';
  }
  if (isNotFound(error)) {
    return 'That claim code cannot be used. Please check it with the branch, or ask for a new one.';
  }
  return 'We could not claim those points. Nothing was taken from your card. Please try again in a moment.';
}
