/**
 * Server-instant display helpers.
 *
 * Time-zone rule: a member reading a server-recorded instant must see the
 * same calendar date the server recorded, not a value shifted by the
 * browser's zone. These helpers pin the zone to UTC. The staff console's
 * local `lib/format` helpers stay browser-zone on purpose (staff consoles run
 * on Philippine time alongside the servers), so do not mix the two systems
 * for the same instant.
 */

const utcDateFormatter = new Intl.DateTimeFormat('en-PH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const utcDateTimeFormatter = new Intl.DateTimeFormat('en-PH', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'UTC',
});

/**
 * Format a server-recorded instant as its UTC calendar date
 * (`2026-03-01T00:00:00Z` renders the same date in every browser zone).
 * Returns the placeholder for missing or unparseable input, never a shifted
 * date.
 */
export function formatUTCDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return utcDateFormatter.format(date);
}

/**
 * Format a server-recorded instant as its UTC calendar date and time.
 * Returns the placeholder for missing or unparseable input.
 */
export function formatUTCDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return '—';
  return utcDateTimeFormatter.format(date);
}

/** Asia/Manila is UTC+8 with no daylight saving. */
const MANILA_OFFSET_MS = 8 * 3_600_000;

/** Today's calendar date (`YYYY-MM-DD`) in Asia/Manila. `now` is injectable for tests. */
export function manilaToday(now: number = Date.now()): string {
  return new Date(now + MANILA_OFFSET_MS).toISOString().slice(0, 10);
}

/** The Asia/Manila month (`YYYY-MM`) of an instant, or null when missing or unparseable. */
export function manilaMonthOf(value: string | null | undefined): string | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  if (Number.isNaN(t)) return null;
  return new Date(t + MANILA_OFFSET_MS).toISOString().slice(0, 7);
}
