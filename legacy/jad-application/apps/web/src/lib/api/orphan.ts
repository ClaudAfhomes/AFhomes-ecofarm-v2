import { ApiError } from './errors';

/** Friendly message for a valid Auth session whose Member row is gone (deleted/purged). */
export const ORPHAN_ACCOUNT_MESSAGE =
  'Your account no longer exists. It may have been removed by an administrator. Please contact support if you believe this is a mistake.';

/** Friendly message for an archived member attempting to sign in. */
export const ARCHIVED_ACCOUNT_MESSAGE =
  'Your account has been archived by an administrator, so you cannot sign in. Please contact support if you believe this is a mistake.';

/** Friendly message for a deactivated (non-ACTIVE) member attempting to sign in. */
export const INACTIVE_ACCOUNT_MESSAGE =
  'Your account is currently inactive, so you cannot sign in. Please contact support to reactivate it.';

export type MemberAccessBlock = 'ARCHIVED' | 'INACTIVE';

/**
 * Pure member-lifecycle gate shared by login and session refresh: archived
 * members and non-ACTIVE members must not hold a member session. Returns the
 * block reason, or null when the row may proceed. Staff identities bypass at
 * the call site (they have no Member row by design).
 */
export function getMemberAccessBlock(
  row: {
    archivedAt?: string | null;
    accountStatus?: string | null;
  } | null,
): MemberAccessBlock | null {
  if (!row) return null;
  if (row.archivedAt) return 'ARCHIVED';
  if ((row.accountStatus ?? 'ACTIVE') !== 'ACTIVE') return 'INACTIVE';
  return null;
}

type MaybeError = {
  code?: unknown;
  message?: unknown;
  status?: unknown;
};

/** True when the error means "authenticated but the Member row has 0 rows". */
export function isOrphanMemberError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const rec = error as MaybeError;
  const code = typeof rec.code === 'string' ? rec.code : '';
  const message = typeof rec.message === 'string' ? rec.message : '';
  if (code === 'PGRST116') return true;
  if (/cannot coerce the result to a single json object/i.test(message)) return true;
  if (error instanceof ApiError && error.status === 404) {
    return code === 'NOT_FOUND' && /member not found|not found/i.test(message);
  }
  if (code === 'NOT_FOUND' && /member not found/i.test(message)) return true;
  return false;
}

/**
 * Friendly `ErrorState` message override for orphaned accounts. Returns
 * `undefined` for all other errors so callers fall back to the server message.
 */
export function orphanMessageFor(error: unknown): string | undefined {
  return isOrphanMemberError(error) ? ORPHAN_ACCOUNT_MESSAGE : undefined;
}
