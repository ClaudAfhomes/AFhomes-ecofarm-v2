/**
 * Phase 16 authentication-recovery helpers (framework-free).
 *
 * Shared by the staff (`apps/admin`) and customer (`apps/web`) recovery
 * screens so the two flows cannot drift apart on policy, wording, or
 * redirect safety. Nothing here touches the network or the DOM: callers pass
 * values in and render the results.
 *
 * Password policy mirrors the account-activation contract
 * (`customerActivationRequestSchema`: minimum 10 characters with a lowercase
 * letter, an uppercase letter and a digit). Supabase Auth enforces its own
 * rule server-side as well; this is the client-side pre-check so a trivially
 * weak password never leaves the browser.
 */

export const RECOVERY_PASSWORD_MIN_LENGTH = 10;

/** Client-side password pre-check. Returns an error message, or null when OK. */
export function validateRecoveryPassword(password: string): string | null {
  if (password.length < RECOVERY_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${RECOVERY_PASSWORD_MIN_LENGTH} characters.`;
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return 'Password must contain a lowercase letter, an uppercase letter and a digit.';
  }
  return null;
}

export type PasswordRuleId = 'length' | 'lowercase' | 'uppercase' | 'digit';

export interface PasswordRuleState {
  id: PasswordRuleId;
  /** Short, stable label for live checklists (not a validation message). */
  label: string;
  met: boolean;
}

/**
 * Live per-rule view of the same policy `validateRecoveryPassword` enforces.
 * The checklist is presentation only: submit paths keep calling the
 * validator, so the two can never disagree (pinned: every rule met ⟺ null).
 */
export function passwordRuleStates(password: string): PasswordRuleState[] {
  return [
    {
      id: 'length',
      label: `At least ${RECOVERY_PASSWORD_MIN_LENGTH} characters`,
      met: password.length >= RECOVERY_PASSWORD_MIN_LENGTH,
    },
    { id: 'lowercase', label: 'One lowercase letter', met: /[a-z]/.test(password) },
    { id: 'uppercase', label: 'One uppercase letter', met: /[A-Z]/.test(password) },
    { id: 'digit', label: 'One digit', met: /[0-9]/.test(password) },
  ];
}

/** Minimal email shape check for the forgot-password form (UX only). */
export function isValidRecoveryEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * The one forgot-password success sentence. Shown verbatim whether or not the
 * address exists: distinguishing the two would let anyone enumerate
 * registered staff and customers.
 */
export const RECOVERY_SENT_MESSAGE =
  'If an account exists for that email, a password reset link has been sent.';

export type RecoveryRequestOutcome = 'sent' | 'rate-limited' | 'unavailable' | 'failed';

/**
 * Map a `resetPasswordForEmail` failure onto safe UI. Only the rate-limit and
 * transport cases get their own wording (neither reveals account state); an
 * "unknown user" refusal is deliberately folded into `sent`, and anything
 * else becomes a generic failure that names no account.
 */
export function classifyRecoveryRequestError(error: unknown): RecoveryRequestOutcome {
  const status =
    typeof error === 'object' && error !== null
      ? (error as { status?: unknown }).status
      : undefined;
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '');
  if (status === 429 || /rate.?limit|too many requests|over_.*rate_limit|429/.test(message)) {
    return 'rate-limited';
  }
  if (/failed to fetch|network ?error|load failed|timed out|timeout/i.test(message)) {
    return 'unavailable';
  }
  if (/user not found|usernotfound|identity not found|no user|not registered/i.test(message)) {
    return 'sent';
  }
  return 'failed';
}

const stripTrailingSlash = (value: string): string => value.replace(/\/+$/, '');

const isLocalhostName = (hostname: string): boolean =>
  hostname === 'localhost' ||
  hostname === '127.0.0.1' ||
  hostname === '[::1]' ||
  hostname === '::1' ||
  /^127\./.test(hostname);

/**
 * Build the `redirectTo` for a recovery (or any Auth) email from a configured
 * application origin plus an app path (e.g. `/admin/reset-password`).
 *
 * Safety rules, in order:
 *  1. The configured base must parse as http(s); anything else (custom
 *     schemes, credentials, garbage) falls back to the current origin.
 *  2. A localhost base is rejected unless the page itself runs on localhost,
 *     so a stale dev default can never become a production redirect.
 *  3. When the configured base is absent or rejected, the current origin is
 *     used: same-origin is always safe, and in production both apps share one
 *     origin (`VITE_ADMIN_URL` is the web origin plus `/admin`).
 *
 * The builder takes NO user input, so there is no query value to inject: the
 * output is always exactly `<origin><appPath>`.
 */
export function buildRecoveryRedirect(
  configuredBase: string | undefined,
  appPath: string,
  currentOrigin: string,
): string {
  const fallback = `${stripTrailingSlash(currentOrigin)}${appPath}`;
  const base = (configuredBase ?? '').trim();
  if (!base || !appPath.startsWith('/')) return fallback;
  let candidate: URL;
  try {
    candidate = new URL(stripTrailingSlash(base) + appPath);
  } catch {
    return fallback;
  }
  if (candidate.protocol !== 'http:' && candidate.protocol !== 'https:') return fallback;
  if (candidate.username || candidate.password) return fallback;
  try {
    // A localhost base is rejected unless the page itself runs on localhost,
    // so a stale dev default can never become a production redirect.
    if (isLocalhostName(candidate.hostname) && !isLocalhostName(new URL(currentOrigin).hostname)) {
      return fallback;
    }
  } catch {
    return fallback;
  }
  return `${stripTrailingSlash(base)}${appPath}`;
}

/**
 * Allowlist check for a recovery redirect: same origin AND the allowed path
 * (or deeper). Lookalike origins (`app.example.evil.com`) fail the origin
 * comparison; cross-origin URLs fail outright.
 */
export function isAllowedRecoveryRedirect(url: string, allowed: string[]): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return allowed.some((entry) => {
    let scope: URL;
    try {
      scope = new URL(entry);
    } catch {
      return false;
    }
    if (parsed.origin !== scope.origin) return false;
    const scopePath = scope.pathname.replace(/\/$/, '');
    const urlPath = parsed.pathname;
    return urlPath === scopePath || urlPath.startsWith(`${scopePath}/`);
  });
}
