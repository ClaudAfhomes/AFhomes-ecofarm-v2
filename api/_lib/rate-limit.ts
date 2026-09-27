/**
 * A minimal fixed-window rate limiter for identifier resolution.
 *
 * WHAT THIS ACTUALLY PROTECTS AGAINST - stated plainly, because an overstated
 * control is worse than none:
 *
 * The real protection against guessing a member's code is that the codes are
 * high-entropy. The QR token is 32 random bytes base64-encoded (~256 bits) and
 * the fallback code is 8 random hex digits (~32 bits, checked in constant time
 * against a unique index). Enumeration is not a practical attack, and an
 * unauthorized caller is refused with 403 by `authorizeAfHomes` BEFORE any lookup
 * runs at all.
 *
 * So this limiter is defence in depth against one specific thing: an authorized
 * employee hammering the resolve endpoint from one session. It is deliberately
 * small and in-process, with these honest limitations:
 *
 *  - state is per instance, so on serverless it resets on a cold start and is not
 *    shared between concurrent instances;
 *  - it bounds one bad session, not a coordinated distributed attack.
 *
 * A genuinely distributed limit needs shared state (Redis, or a database-backed
 * counter), which this codebase does not have. Rather than pretend otherwise,
 * the limit is modest, the failure mode is a 429, and the identifier entropy does
 * the real work.
 */

/** A caller key -> window start -> count. */
type Window = { startedAt: number; count: number };

const windows = new Map<string, Window>();

/** How long one window lasts. */
const WINDOW_MS = 60_000;
/** Attempts allowed per window, per key. */
const MAX_ATTEMPTS = 30;
/** Stop growing the map so a long-lived instance cannot leak memory. */
const MAX_KEYS = 10_000;

export type RateVerdict = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const keyOf = (req: {
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
}): string => {
  const forwarded = req.headers?.['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = (raw?.split(',')[0] ?? req.socket?.remoteAddress ?? 'unknown').trim();
  return ip || 'unknown';
};

/**
 * Record one identifier-resolution attempt.
 *
 * The caller-supplied identity is part of the key, so one employee cannot exhaust
 * another's budget and lock a colleague out of a busy till.
 */
export function consumeIdentifierAttempt(
  req: { headers?: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string } },
  principalId: string,
): RateVerdict {
  const now = Date.now();
  const key = `${principalId}|${keyOf(req)}`;

  if (windows.size > MAX_KEYS) {
    // Cheap sweep: drop everything whose window has certainly expired.
    for (const [k, w] of windows) if (now - w.startedAt > WINDOW_MS) windows.delete(k);
    if (windows.size > MAX_KEYS) windows.clear();
  }

  const existing = windows.get(key);
  if (!existing || now - existing.startedAt > WINDOW_MS) {
    windows.set(key, { startedAt: now, count: 1 });
    return { allowed: true };
  }
  existing.count += 1;
  if (existing.count > MAX_ATTEMPTS) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((WINDOW_MS - (now - existing.startedAt)) / 1000)) };
  }
  return { allowed: true };
}

/** Test seam. */
export function resetIdentifierRateLimit(): void {
  windows.clear();
}
