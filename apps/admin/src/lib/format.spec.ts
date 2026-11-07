import { describe, expect, it } from 'vitest';

import { formatTin } from './format';

describe('formatTin', () => {
  it('groups a TIN as 123-456-789', () => {
    expect(formatTin('123456789')).toBe('123-456-789');
    expect(formatTin('123-456-789')).toBe('123-456-789');
  });

  it('keeps an optional branch suffix', () => {
    expect(formatTin('123456789000')).toBe('123-456-789-000');
  });

  it('returns an empty string when there are no digits', () => {
    expect(formatTin(null)).toBe('');
    expect(formatTin(undefined)).toBe('');
    expect(formatTin('')).toBe('');
    expect(formatTin('abc')).toBe('');
  });
});
