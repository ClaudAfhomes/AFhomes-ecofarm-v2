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
