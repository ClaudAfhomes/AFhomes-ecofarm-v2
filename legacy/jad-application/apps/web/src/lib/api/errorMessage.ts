import { ApiError } from './errors';

/**
 * Human message from a thrown API error. Uses the server message when present
 * (API-SPECIFICATION §3 envelope), otherwise the caller's fallback.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}
