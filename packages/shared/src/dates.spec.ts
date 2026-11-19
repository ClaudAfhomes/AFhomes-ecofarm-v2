import { describe, expect, it } from 'vitest';

import { formatUTCDate, formatUTCDateTime } from './dates';

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
