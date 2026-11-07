import { describe, expect, it } from 'vitest';
import { formatCompactMoney, formatCount, formatCountOrDash } from './numbers.js';

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

describe('formatCountOrDash', () => {
  it('renders nullish as a placeholder', () => {
    expect(formatCountOrDash(null)).toBe('—');
    expect(formatCountOrDash(undefined)).toBe('—');
  });

  it('delegates present values to the fail-loud formatter', () => {
    expect(formatCountOrDash(8000)).toBe('8,000');
    expect(() => formatCountOrDash(1.5)).toThrow();
    expect(() => formatCountOrDash(-1)).toThrow();
  });
});

describe('formatCompactMoney', () => {
  it('abbreviates thousands and millions for axes', () => {
    expect(formatCompactMoney(60000)).toBe('₱60K');
    expect(formatCompactMoney(2500000)).toBe('₱2.5M');
    expect(formatCompactMoney(500)).toBe('₱500');
  });

  it('throws on non-finite input', () => {
    expect(() => formatCompactMoney(Number.NaN)).toThrow();
    expect(() => formatCompactMoney('60000' as unknown as number)).toThrow();
  });
});
