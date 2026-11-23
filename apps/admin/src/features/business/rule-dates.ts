import { manilaToday } from '@afhomes/shared';

/** The same calendar day one year later (`YYYY-MM-DD`); 29 February becomes 28 February. */
export function oneYearAfter(date: string): string {
  const [year, month, day] = date.split('-');
  const next = `${Number(year) + 1}-${month}-${day === '29' && month === '02' ? '28' : day}`;
  return next;
}

/** The default window for a new rule: from today (Manila) for one year, end exclusive. */
export function defaultRuleWindow(now: number = Date.now()): { start: string; end: string } {
  const start = manilaToday(now);
  return { start, end: oneYearAfter(start) };
}

/**
 * Normalizes a typed price to an exact two-decimal string ("2,000" -> "2000.00"),
 * or null when it is not a plain positive amount. Never uses float math.
 */
export function normalizePrice(input: string): string | null {
  const cleaned = input.replace(/[₱,\s]/g, '').replace(/^php/i, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const whole = match[1]!.replace(/^0+(?=\d)/, '');
  return `${whole}.${(match[2] ?? '').padEnd(2, '0')}`;
}
