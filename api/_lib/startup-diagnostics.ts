/**
 * Safe startup diagnostics for the local MongoDB launcher.
 *
 * Configuration validators deliberately name the offending variable and never
 * its value. The launcher surfaces those messages so a missing key is
 * actionable, but it must not print arbitrary errors: connection and storage
 * failures can contain topology hostnames, paths, or other environment data.
 *
 * Only messages that match a known-safe configuration diagnostic are returned.
 * A bare variable prefix is not enough: a future error that appends a value
 * (for example `MONGODB_URI ...`) must stay hidden. The message is normalized
 * to one line and length-capped before it reaches the console.
 */
const SAFE_CONFIGURATION_MESSAGES = [
  /^Development URLs must be explicit localhost ports\.?$/,
  /^Development runtime requires afhomes_dev\.?$/,
  /^Production database scope requires explicit hosted production configuration\.?$/,
  /^Login requires (?:VITE_TURNSTILE_SITE_KEY|server-only AFHOMES_AUTH_TURNSTILE_SECRET)\.?$/,
  /^(?:VITE_TURNSTILE_SITE_KEY|AFHOMES_AUTH_TURNSTILE_SECRET) must not have surrounding whitespace\.?$/,
  /^AFHOMES_AUTH_TURNSTILE_SECRET must be at least 16 characters\.?$/,
  /^(?:AFHOMES|BETTER_AUTH|MONGODB)_[A-Z0-9_]+ must /,
  /^Turnstile test keys are permitted only /,
] as const;

const MAX_DETAIL_LENGTH = 240;

export function safeStartupDetail(stage: string, error: unknown): string {
  if (stage !== 'configuration' || !(error instanceof Error)) return '';
  const message = error.message.replace(/\s+/g, ' ').trim();
  if (!message || message.length > MAX_DETAIL_LENGTH) return '';
  if (!SAFE_CONFIGURATION_MESSAGES.some((pattern) => pattern.test(message))) return '';
  return ` ${message}`;
}
