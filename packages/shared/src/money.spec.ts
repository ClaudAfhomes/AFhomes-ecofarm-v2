import { describe, expect, it } from 'vitest';

import { addMoney, compareMoney, divideMoneyExact, formatMoney, isExactDecimal, subtractMoney } from '../src/index';

describe('isExactDecimal', () => {
  it('accepts integers and exact decimals', () => {
    expect(isExactDecimal('0')).toBe(true);
    expect(isExactDecimal('1000000')).toBe(true);
    expect(isExactDecimal('1000000.00')).toBe(true);
    expect(isExactDecimal('1234.5')).toBe(true);
  });

  it('rejects floats, signs, separators, and malformed values', () => {
    expect(isExactDecimal('1.5e3')).toBe(false);
    expect(isExactDecimal('1.234')).toBe(false);
    expect(isExactDecimal('-5')).toBe(false);
    expect(isExactDecimal('1,000')).toBe(false);
    expect(isExactDecimal('abc')).toBe(false);
    expect(isExactDecimal('')).toBe(false);
    expect(isExactDecimal('1.')).toBe(false);
  });
});

describe('formatMoney', () => {
  it('formats an exact decimal as PHP with ₱ symbol', () => {
    expect(formatMoney('1000000.00')).toBe('₱1,000,000.00');
    expect(formatMoney('0.00')).toBe('₱0.00');
    expect(formatMoney('1234.5')).toBe('₱1,234.50');
  });

  it('throws on non-exact-decimal input rather than silently coercing', () => {
    expect(() => formatMoney('1.234')).toThrow();
    expect(() => formatMoney('abc')).toThrow();
    expect(() => formatMoney(1 as unknown as string)).toThrow();
  });
});

describe('compareMoney', () => {
  it('compares exact-decimal strings without float error', () => {
    expect(compareMoney('1000000.00', '1000000.00')).toBe(0);
    expect(compareMoney('1000000.00', '999999.99')).toBe(1);
    expect(compareMoney('0.01', '0.02')).toBe(-1);
    expect(compareMoney('0.1', '0.10')).toBe(0);
  });

  it('rejects non-exact-decimal input', () => {
    expect(() => compareMoney('1.234', '1')).toThrow();
    expect(() => compareMoney('1', 'x')).toThrow();
  });
});

describe('addMoney / subtractMoney', () => {
  it('adds and subtracts exact decimals via integer cents', () => {
    expect(addMoney('0.10', '0.20')).toBe('0.30');
    expect(addMoney('1000000.00', '1.01')).toBe('1000001.01');
    expect(subtractMoney('1000000.00', '0.01')).toBe('999999.99');
  });

  it('never produces float artifacts', () => {
    expect(addMoney('0.1', '0.2')).toBe('0.30');
    expect(subtractMoney('0.3', '0.1')).toBe('0.20');
  });

  it('throws on invalid input', () => {
    expect(() => addMoney('abc', '1.00')).toThrow();
    expect(() => subtractMoney('1.00', '1.234')).toThrow();
  });
});

describe('divideMoneyExact', () => {
  it('splits every approved VIP schedule exactly', () => {
    expect(divideMoneyExact('44000.00', 4)).toBe('11000.00');
    expect(divideMoneyExact('182000.00', 4)).toBe('45500.00');
    expect(divideMoneyExact('302000.00', 4)).toBe('75500.00');
    expect(divideMoneyExact('62000.00', 4)).toBe('15500.00');
    expect(divideMoneyExact('230000.00', 4)).toBe('57500.00');
    expect(divideMoneyExact('380000.00', 4)).toBe('95000.00');
    expect(divideMoneyExact('144000.00', 12)).toBe('12000.00');
    expect(divideMoneyExact('234000.00', 12)).toBe('19500.00');
    expect(divideMoneyExact('180000.00', 12)).toBe('15000.00');
    expect(divideMoneyExact('292500.00', 12)).toBe('24375.00');
  });

  it('throws rather than rounding an inexact split', () => {
    expect(() => divideMoneyExact('100.00', 3)).toThrow();
    expect(() => divideMoneyExact('10.00', 0)).toThrow();
    expect(() => divideMoneyExact('abc', 4)).toThrow();
  });
});
