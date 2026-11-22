import { describe, expect, it } from 'vitest';

import { formatUTCDate, formatUTCDateTime, manilaMonthOf, manilaToday } from './dates';

describe('formatUTCDate', () => {
  it('renders the UTC calendar date regardless of browser zone', () => {
    expect(formatUTCDate('2026-03-01T00:00:00Z')).toBe('Mar 1, 2026');
  });

  it('returns the placeholder for missing or unparseable input', () => {
    expect(formatUTCDate(null)).toBe('—');
    expect(formatUTCDate(undefined)).toBe('—');
    expect(formatUTCDate('not-a-date')).toBe('—');
  });
});

describe('formatUTCDateTime', () => {
  it('renders the UTC date and time', () => {
    expect(formatUTCDateTime('2026-03-01T00:00:00Z')).toContain('Mar 1, 2026');
  });

  it('returns the placeholder for missing or unparseable input', () => {
    expect(formatUTCDateTime(null)).toBe('—');
    expect(formatUTCDateTime('not-a-date')).toBe('—');
  });
});

describe('Manila helpers', () => {
  it('rolls the date and month at 16:00 UTC (midnight in Manila)', () => {
    expect(manilaToday(Date.parse('2026-11-30T15:59:59Z'))).toBe('2026-11-30');
    expect(manilaToday(Date.parse('2026-11-30T16:00:00Z'))).toBe('2026-12-01');
    expect(manilaMonthOf('2026-11-30T15:59:59Z')).toBe('2026-11');
    expect(manilaMonthOf('2026-11-30T16:00:00Z')).toBe('2026-12');
  });

  it('returns null for missing or unparseable input', () => {
    expect(manilaMonthOf(null)).toBeNull();
    expect(manilaMonthOf('nope')).toBeNull();
  });
});
