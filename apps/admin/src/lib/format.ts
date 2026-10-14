/**
 * Staff-console date display (browser-zone, en-PH).
 *
 * Staff consoles run on Philippine time alongside the servers, so these
 * helpers intentionally render in the browser's zone. Anything shown to a
 * MEMBER (portal, QR receipts, onboarding) must use the UTC-pinned helpers in
 * `@afhomes/shared` instead, so the date never shifts with the member's zone.
 */

/** Format an ISO-8601 date string to a human-readable short date. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/** Format an ISO-8601 date string to a human-readable datetime. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const date = new Date(iso);
  return date.toLocaleDateString('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

/** Relative time for chat timestamps ("just now", "5m ago", "Yesterday", …). */
export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const diff = Math.max(0, now.getTime() - date.getTime());
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS && isSameDay(date, now)) return `${Math.floor(diff / HOUR_MS)}h ago`;
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) return `${dayDiff}d ago`;
  return formatDate(iso);
}

/** Day separator label for a thread ("Today", "Yesterday", "Sep 12, 2026"). */
export function formatDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (isSameDay(date, now)) return 'Today';
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / DAY_MS);
  if (dayDiff === 1) return 'Yesterday';
  return formatDate(iso);
}

/**
 * Turn a machine token into a readable label: `STAFF_ROLE_CHANGED` and
 * `staffRoleChanged` both become `Staff role changed`. Presentation only -
 * the caller keeps the raw token wherever it is still the identity.
 */
export function humanizeToken(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^./, (character) => character.toUpperCase());
}
