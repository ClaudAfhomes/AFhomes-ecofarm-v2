import { describe, expect, it } from 'vitest';
import { formatCount } from './numbers.js';

describe('formatCount', () => {
  it('groups thousands separators (8000 -> 8,000)', () => {
    expect(formatCount(8000)).toBe('8,000');
    expect(formatCount(1000000)).toBe('1,000,000');
  });

  it('leaves small counts untouched', () => {
    expect(formatCount(0)).toBe('0');
    expect(formatCount(4)).toBe('4');
    expect(formatCount(999)).toBe('999');
  });

  it('throws on non-integer, non-finite, or negative input', () => {
    expect(() => formatCount(8.5)).toThrow();
    expect(() => formatCount(Number.NaN)).toThrow();
    expect(() => formatCount(Number.POSITIVE_INFINITY)).toThrow();
    expect(() => formatCount(-1)).toThrow();
  });
});
